from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

LAND_BLOCKS = {"NORMAL_LAND", "SURVEY_ROWS", "BUILT_UP"}

LEGACY_SERVICE_LINE_TO_KEY = {
    "VALUATION": "VALUATION_LB",
    "INDUSTRIAL": "VALUATION_LB",
    "DPR": "PROJECT_REPORT",
    "CMA": "PROJECT_REPORT",
}


def _seed_candidates(filename: str, env_var: str) -> list[Path]:
    candidates: list[Path] = []
    override = os.getenv(env_var)
    if override:
        candidates.append(Path(override).expanduser())

    here = Path(__file__).resolve()
    # Repository mode: legacy/v1/backend/app/services/checklist_rules.py
    repo_v1_root = here.parents[3] if len(here.parents) > 3 else None
    if repo_v1_root is not None:
        candidates.append(repo_v1_root / "docs" / "seed" / filename)

    # Container/runtime mode: /app/app/services/checklist_rules.py
    app_root = here.parents[1] if len(here.parents) > 1 else None
    if app_root is not None:
        candidates.append(app_root / "seed" / filename)

    cwd = Path.cwd()
    candidates.append(cwd / "docs" / "seed" / filename)
    candidates.append(cwd / "app" / "seed" / filename)

    # Keep first occurrence only.
    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _load_seed_json(filename: str, env_var: str, fallback: dict[str, Any]) -> dict[str, Any]:
    for path in _seed_candidates(filename, env_var):
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return fallback


def _dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw or "").strip().upper()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


@lru_cache(maxsize=1)
def load_document_categories() -> dict[str, Any]:
    return _load_seed_json(
        "document_categories.seed.json",
        env_var="DOCUMENT_CATEGORIES_SEED_PATH",
        fallback={"schema_version": "v1", "categories": []},
    )


@lru_cache(maxsize=1)
def load_checklist_rules() -> dict[str, Any]:
    return _load_seed_json(
        "checklist_rules.seed.json",
        env_var="CHECKLIST_RULES_SEED_PATH",
        fallback={"schema_version": "v1", "land_blocks": ["NORMAL_LAND", "SURVEY_ROWS", "BUILT_UP"], "service_lines": []},
    )


@lru_cache(maxsize=1)
def load_document_template_slots() -> dict[str, Any]:
    return _load_seed_json(
        "document_templates.seed.json",
        env_var="DOCUMENT_TEMPLATE_SLOTS_SEED_PATH",
        fallback={"schema_version": "v1", "template_groups": []},
    )


def refresh_seed_cache() -> None:
    load_document_categories.cache_clear()
    load_checklist_rules.cache_clear()
    load_document_template_slots.cache_clear()


def category_label_map() -> dict[str, str]:
    categories = load_document_categories().get("categories") or []
    labels: dict[str, str] = {}
    for row in categories:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip().upper()
        label = str(row.get("label") or "").strip()
        if key:
            labels[key] = label or key
    return labels


def resolve_service_line_key(service_line_key: str | None, legacy_service_line: str | None) -> str | None:
    key = str(service_line_key or "").strip().upper()
    if key:
        return key
    legacy = str(legacy_service_line or "").strip().upper()
    if not legacy:
        return None
    return LEGACY_SERVICE_LINE_TO_KEY.get(legacy, legacy)


def active_land_blocks(policy: dict[str, Any] | None) -> list[str]:
    policy_payload = policy or {}
    requires = _dedupe(list(policy_payload.get("requires") or []))
    optional = [value for value in _dedupe(list(policy_payload.get("optional") or [])) if value not in requires]
    return [value for value in requires + optional if value in LAND_BLOCKS]


def _find_service_line_rule(service_line_key: str | None) -> dict[str, Any] | None:
    rules = load_checklist_rules()
    service_lines = rules.get("service_lines") or []
    normalized_key = str(service_line_key or "").strip().upper()
    if not normalized_key:
        return None
    for rule in service_lines:
        if not isinstance(rule, dict):
            continue
        rule_key = str(rule.get("service_line_key") or "").strip().upper()
        if rule_key == normalized_key:
            return rule
    return None


def build_checklist_for_service_line(service_line_key: str | None, blocks: list[str]) -> dict[str, list[str]]:
    rule = _find_service_line_rule(service_line_key)
    if not rule:
        return {"required": [], "optional": []}

    required = _dedupe(list(rule.get("base_required") or []))
    optional = _dedupe(list(rule.get("base_optional") or []))

    block_rules = rule.get("block_rules") or {}
    for block in _dedupe(blocks):
        if block not in LAND_BLOCKS:
            continue
        entry = block_rules.get(block)
        if not isinstance(entry, dict):
            continue
        for category in _dedupe(list(entry.get("required") or [])):
            if category not in required:
                required.append(category)
        for category in _dedupe(list(entry.get("optional") or [])):
            if category in required or category in optional:
                continue
            optional.append(category)

    optional = [category for category in optional if category not in required]
    return {"required": required, "optional": optional}


def get_checklist_rules_snapshot() -> dict[str, Any]:
    return {
        "rules": load_checklist_rules(),
        "categories": load_document_categories(),
    }


def get_document_template_slots(service_line_key: str | None, blocks: list[str]) -> list[dict[str, Any]]:
    payload = load_document_template_slots()
    template_groups = payload.get("template_groups") or []
    normalized_key = str(service_line_key or "").strip().upper()
    active_blocks_set = set(_dedupe(blocks))

    merged: list[dict[str, Any]] = []
    index_by_category: dict[str, int] = {}

    for group in template_groups:
        if not isinstance(group, dict):
            continue
        applies = [str(v).strip().upper() for v in (group.get("applies_to_service_lines") or []) if str(v).strip()]
        required_blocks = [str(v).strip().upper() for v in (group.get("requires_land_blocks") or []) if str(v).strip()]

        if applies and normalized_key not in applies:
            continue
        if required_blocks and not set(required_blocks).issubset(active_blocks_set):
            continue

        for slot in group.get("slots") or []:
            if not isinstance(slot, dict):
                continue
            category = str(slot.get("category") or "").strip().upper()
            if not category:
                continue
            item = {
                "category": category,
                "label": str(slot.get("label") or category).strip(),
                "required": bool(slot.get("required", False)),
                "max_files": int(slot.get("max_files") or 1),
            }
            if category in index_by_category:
                existing = merged[index_by_category[category]]
                existing["required"] = bool(existing.get("required") or item["required"])
                existing["max_files"] = max(int(existing.get("max_files") or 1), item["max_files"])
                if not existing.get("label") and item["label"]:
                    existing["label"] = item["label"]
                continue
            index_by_category[category] = len(merged)
            merged.append(item)

    return merged
