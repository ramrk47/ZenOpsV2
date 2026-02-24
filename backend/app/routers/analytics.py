from __future__ import annotations

from collections import defaultdict
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from statistics import mean, pstdev
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import and_, inspect, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.analytics import AnalyticsSettings, FollowUpTask, RelationshipLog
from app.models.assignment import Assignment
from app.models.calendar import CalendarEvent
from app.models.enums import CalendarEventType, CaseType, CommissionRequestStatus, NotificationType, Role, ServiceLine
from app.models.invoice import Invoice
from app.models.master import Bank, Branch, CalendarEventLabel
from app.models.partner import ExternalPartner, CommissionRequest
from app.models.user import User
from app.schemas.analytics import (
    AnalyticsBankResponse,
    AnalyticsEntityRow,
    AnalyticsOverview,
    AnalyticsOverviewV2,
    AnalyticsResponse,
    AnalyticsSegmentResponse,
    AnalyticsSettingsBase,
    AnalyticsSettingsRead,
    AnalyticsSettingsResponse,
    AnalyticsSettingsUpdate,
    AnalyticsSignal,
    AnalyticsSourceRow,
    AnalyticsTrendPoint,
    FollowUpTaskRead,
    FollowUpTaskUpdate,
    ForecastSummary,
    ForecastV2Response,
    RelationshipLogCreate,
    RelationshipLogRead,
    VisitReminderRequest,
    VisitReminderResponse,
    WeeklyDigestItem,
    WeeklyDigestResponse,
)
from app.schemas.partner import PartnerBankBreakdown, PartnerSummaryRead
from app.services.notifications import create_notification, create_notification_if_absent

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)


def _require_access(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view analytics")


def _normalize_range(start: datetime | None, end: datetime | None) -> Tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    end_at = end or now
    if end_at.tzinfo is None:
        end_at = end_at.replace(tzinfo=timezone.utc)
    if start:
        start_at = start
        if start_at.tzinfo is None:
            start_at = start_at.replace(tzinfo=timezone.utc)
    else:
        start_at = datetime(end_at.year, end_at.month, 1, tzinfo=timezone.utc)
    if start_at > end_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be before end")
    return start_at, end_at


def _coerce_datetime(value) -> datetime | None:
    return value if isinstance(value, datetime) else None


def _shift_month_start(value: datetime, delta_months: int) -> datetime:
    month_index = (value.year * 12 + (value.month - 1)) + delta_months
    year = month_index // 12
    month = (month_index % 12) + 1
    return datetime(year, month, 1, tzinfo=value.tzinfo or timezone.utc)


def _ensure_aware(value: datetime | None) -> datetime | None:
    if not value:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _previous_range(start: datetime, end: datetime) -> Tuple[datetime, datetime]:
    delta = end - start
    prev_end = start - timedelta(seconds=1)
    prev_start = prev_end - delta
    return prev_start, prev_end


def _pct_change(current: Decimal | int, previous: Decimal | int) -> float | None:
    prev = Decimal(previous)
    cur = Decimal(current)
    if prev == 0:
        return None if cur == 0 else 1.0
    return float((cur - prev) / prev)


def _source_label(case_type: CaseType | None) -> str:
    if case_type == CaseType.BANK:
        return "BANK"
    if case_type == CaseType.DIRECT_CLIENT:
        return "DIRECT_CLIENT"
    if case_type == CaseType.EXTERNAL_VALUER:
        return "EXTERNAL_CLIENT"
    return "UNKNOWN"


def _resolve_source(assignment: Assignment) -> Tuple[str, Dict]:
    service_line = assignment.service_line or ServiceLine.VALUATION
    case_type = assignment.case_type

    bank_name = assignment.bank_name or (assignment.bank.name if assignment.bank else None)
    branch_name = assignment.branch_name or (assignment.branch.name if assignment.branch else None)
    client_name = assignment.valuer_client_name or (assignment.client.name if assignment.client else None)

    source_name = bank_name if case_type == CaseType.BANK else (client_name or "Client")
    source_detail = branch_name if case_type == CaseType.BANK else None

    if service_line in {ServiceLine.DPR, ServiceLine.CMA, ServiceLine.INDUSTRIAL}:
        source_type = service_line.value
    else:
        source_type = _source_label(case_type)

    client_key = assignment.client_id if assignment.client_id else (client_name or "unknown")
    key = f"{source_type}|{service_line.value}|{assignment.bank_id or 0}|{assignment.branch_id or 0}|{client_key}"

    return key, {
        "source_type": source_type,
        "source_name": source_name or "Unknown",
        "source_detail": source_detail,
        "case_type": str(case_type) if case_type else None,
        "service_line": service_line,
        "bank_id": assignment.bank_id,
        "branch_id": assignment.branch_id,
        "client_id": assignment.client_id,
        "client_label": client_name,
    }


def _month_key(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m")


def _range_months(start: datetime, end: datetime) -> list[str]:
    cursor = datetime(start.year, start.month, 1, tzinfo=timezone.utc)
    last = datetime(end.year, end.month, 1, tzinfo=timezone.utc)
    months = []
    while cursor <= last:
        months.append(cursor.strftime("%Y-%m"))
        if cursor.month == 12:
            cursor = datetime(cursor.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            cursor = datetime(cursor.year, cursor.month + 1, 1, tzinfo=timezone.utc)
    return months


def _format_decimal(value: Decimal | int | float | None) -> str:
    if value is None:
        return "-"
    try:
        return f"{Decimal(value):,.2f}"
    except Exception:
        return str(value)


def _format_datetime(value: datetime | None) -> str:
    if not value:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d")


@dataclass
class _Metric:
    assignments: int = 0
    billed: Decimal = Decimal("0.00")
    collected: Decimal = Decimal("0.00")
    outstanding: Decimal = Decimal("0.00")
    monthly_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    monthly_billed: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: Decimal("0.00")))
    last_assignment_at: datetime | None = None


def _get_settings(db: Session) -> AnalyticsSettings:
    settings = db.query(AnalyticsSettings).order_by(AnalyticsSettings.id.asc()).first()
    if settings:
        return settings
    settings = AnalyticsSettings()
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def _safe_pct_change(current: Decimal | int, previous: Decimal | int) -> float | None:
    try:
        return _pct_change(current, previous)
    except Exception:
        return None


def _compute_health(row: AnalyticsEntityRow, inactivity_days: int) -> Tuple[int, str, list[str]]:
    score = 100.0
    reasons: list[str] = []

    if row.assignments_change_pct is not None and row.assignments_change_pct < 0:
        drop = abs(row.assignments_change_pct)
        penalty = min(drop * 100 * 0.4, 35)
        score -= penalty
        reasons.append(f"Assignments down {int(drop * 100)}%")

    if row.billed_change_pct is not None and row.billed_change_pct < 0:
        drop = abs(row.billed_change_pct)
        penalty = min(drop * 100 * 0.4, 35)
        score -= penalty
        reasons.append(f"Revenue down {int(drop * 100)}%")

    if row.billed > 0:
        ratio = float(row.outstanding / row.billed)
        if ratio > 0.35:
            score -= min(ratio * 30, 20)
            reasons.append("Outstanding elevated")

    if row.last_assignment_at:
        days_idle = (datetime.now(timezone.utc) - _ensure_aware(row.last_assignment_at)).days
        if days_idle >= inactivity_days:
            score -= 25
            reasons.append(f"Inactive {days_idle}d")

    score = max(0, round(score))
    if score >= 70:
        label = "Healthy"
    elif score >= 40:
        label = "Watch"
    else:
        label = "At Risk"
    return score, label, reasons


def _forecast_from_series(values: list[float]) -> Tuple[float, float, float]:
    if not values:
        return 0.0, 0.0, 0.0
    window = min(3, len(values))
    recent = values[-window:]
    avg = mean(recent)
    # Simple slope based on last window
    if len(recent) >= 2:
        slope = (recent[-1] - recent[0]) / (len(recent) - 1)
    else:
        slope = 0.0
    expected = max(0.0, avg + slope)
    volatility = pstdev(recent) if len(recent) > 1 else 0.0
    low = max(0.0, expected - volatility)
    high = max(low, expected + volatility)
    return expected, low, high


def _recommend_thresholds(monthly_counts: list[int], monthly_revenue: list[Decimal]) -> Tuple[AnalyticsSettingsBase, str]:
    def coeff_var(values: list[float]) -> float:
        if not values:
            return 0.0
        avg = mean(values)
        if avg == 0:
            return 0.0
        return pstdev(values) / avg

    count_cv = coeff_var([float(v) for v in monthly_counts if v is not None])
    revenue_cv = coeff_var([float(v) for v in monthly_revenue if v is not None])

    def map_threshold(cv: float, tight: float, loose: float) -> Decimal:
        if cv <= 0.25:
            return Decimal(str(tight))
        if cv >= 0.6:
            return Decimal(str(loose))
        # Linear interpolation
        ratio = (cv - 0.25) / (0.6 - 0.25)
        return Decimal(str(tight + (loose - tight) * ratio))

    rec_count = map_threshold(count_cv, 0.15, 0.35)
    rec_revenue = map_threshold(revenue_cv, 0.15, 0.4)

    baseline_count = 3 if mean(monthly_counts or [0]) < 6 else 5
    baseline_revenue = Decimal("50000.00") if mean([float(v) for v in monthly_revenue] or [0]) < 150000 else Decimal("100000.00")

    recommended = AnalyticsSettingsBase(
        time_window_days=90,
        decline_threshold_count=rec_count,
        decline_threshold_revenue=rec_revenue,
        inactivity_days=21,
        baseline_min_count=baseline_count,
        baseline_min_revenue=baseline_revenue,
        followup_cooldown_days=21,
        outstanding_threshold=Decimal("0.00"),
    )
    note = "Recommendations adjust for volatility in recent monthly activity."
    return recommended, note


def _build_trend(months: list[str], metrics: _Metric) -> list[AnalyticsTrendPoint]:
    return [
        AnalyticsTrendPoint(
            period=month,
            assignments=metrics.monthly_counts.get(month, 0),
            revenue=metrics.monthly_billed.get(month, Decimal("0.00")),
        )
        for month in months
    ]


def _build_forecast(months: list[str], metrics: _Metric) -> ForecastSummary:
    counts_series = [metrics.monthly_counts.get(month, 0) for month in months]
    revenue_series = [metrics.monthly_billed.get(month, Decimal("0.00")) for month in months]
    expected_count, low_count, high_count = _forecast_from_series([float(v) for v in counts_series])
    expected_rev, low_rev, high_rev = _forecast_from_series([float(v) for v in revenue_series])
    next_period = (datetime.now(timezone.utc).replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return ForecastSummary(
        period=next_period,
        expected_assignments=int(round(expected_count)),
        expected_assignments_low=int(round(low_count)),
        expected_assignments_high=int(round(high_count)),
        expected_billed=Decimal(str(round(expected_rev, 2))),
        expected_billed_low=Decimal(str(round(low_rev, 2))),
        expected_billed_high=Decimal(str(round(high_rev, 2))),
        observed_assignments=int(metrics.monthly_counts.get(current_month, 0)),
        observed_billed=metrics.monthly_billed.get(current_month, Decimal("0.00")),
    )


def _build_quarterly(months: list[str], metrics: _Metric) -> list[AnalyticsTrendPoint]:
    quarterly: dict[str, dict[str, Decimal | int]] = {}
    for month in months:
        year, mon = month.split("-")
        quarter = (int(mon) - 1) // 3 + 1
        label = f"{year}-Q{quarter}"
        if label not in quarterly:
            quarterly[label] = {"assignments": 0, "revenue": Decimal("0.00")}
        quarterly[label]["assignments"] = int(quarterly[label]["assignments"]) + metrics.monthly_counts.get(month, 0)
        quarterly[label]["revenue"] = Decimal(quarterly[label]["revenue"]) + metrics.monthly_billed.get(month, Decimal("0.00"))
    return [
        AnalyticsTrendPoint(
            period=label,
            assignments=int(values["assignments"]),
            revenue=Decimal(values["revenue"]),
        )
        for label, values in sorted(quarterly.items())
    ]


def _build_seasonality(months: list[str], metrics: _Metric) -> list[AnalyticsTrendPoint]:
    buckets: dict[int, list[int]] = {m: [] for m in range(1, 13)}
    revenue_buckets: dict[int, list[Decimal]] = {m: [] for m in range(1, 13)}
    for month in months:
        year, mon = month.split("-")
        month_num = int(mon)
        buckets[month_num].append(metrics.monthly_counts.get(month, 0))
        revenue_buckets[month_num].append(metrics.monthly_billed.get(month, Decimal("0.00")))

    month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    seasonality: list[AnalyticsTrendPoint] = []
    for idx, label in enumerate(month_labels, start=1):
        counts = buckets.get(idx, [])
        revenue = revenue_buckets.get(idx, [])
        avg_count = int(round(mean(counts))) if counts else 0
        avg_revenue = Decimal("0.00")
        if revenue:
            avg_revenue = Decimal(str(round(float(sum(revenue, start=Decimal("0.00"))) / len(revenue), 2)))
        seasonality.append(AnalyticsTrendPoint(period=label, assignments=avg_count, revenue=avg_revenue))
    return seasonality


def _metric_to_row(
    entity_type: str,
    entity_key: str,
    entity_label: str,
    current: _Metric,
    previous: _Metric | None,
    months: list[str],
    parent_id: int | None = None,
    entity_id: int | None = None,
    inactivity_days: int = 21,
) -> AnalyticsEntityRow:
    prev = previous or _Metric()
    row = AnalyticsEntityRow(
        entity_type=entity_type,
        entity_key=entity_key,
        entity_label=entity_label,
        entity_id=entity_id,
        parent_id=parent_id,
        assignments=current.assignments,
        assignments_change_pct=_safe_pct_change(current.assignments, prev.assignments),
        billed=current.billed,
        billed_change_pct=_safe_pct_change(current.billed, prev.billed),
        collected=current.collected,
        collected_change_pct=_safe_pct_change(current.collected, prev.collected),
        outstanding=current.outstanding,
        avg_per_assignment=(current.billed / current.assignments) if current.assignments else Decimal("0.00"),
        last_assignment_at=current.last_assignment_at,
        monthly=_build_trend(months, current),
        forecast=_build_forecast(months, current),
    )
    score, label, reasons = _compute_health(row, inactivity_days=inactivity_days)
    row.health_score = score
    row.health_label = label
    row.health_reasons = reasons
    return row


def _fetch_assignment_rows(
    db: Session,
    start_at: datetime,
    end_at: datetime,
    case_type: CaseType | None = None,
) -> list[tuple]:
    query = (
        db.query(
            Assignment.created_at,
            Assignment.bank_id,
            Assignment.branch_id,
            Assignment.service_line,
            Assignment.case_type,
            Assignment.bank_name,
            Assignment.branch_name,
            Assignment.client_id,
            Assignment.valuer_client_name,
        )
        .filter(
            Assignment.is_deleted.is_(False),
            Assignment.created_at >= start_at,
            Assignment.created_at <= end_at,
        )
    )
    if case_type:
        query = query.filter(Assignment.case_type == case_type)
    return query.all()


def _fetch_invoice_rows(
    db: Session,
    start_at: datetime,
    end_at: datetime,
    case_type: CaseType | None = None,
) -> list[tuple]:
    query = (
        db.query(
            Invoice,
            Assignment.bank_id,
            Assignment.branch_id,
            Assignment.service_line,
            Assignment.case_type,
            Assignment.client_id,
        )
        .join(Assignment, Invoice.assignment_id == Assignment.id)
        .filter(
            Assignment.is_deleted.is_(False),
            Invoice.issued_date >= start_at.date(),
            Invoice.issued_date <= end_at.date(),
        )
    )
    if case_type:
        query = query.filter(Assignment.case_type == case_type)
    return query.all()


def _accumulate_assignments(metrics: dict[str, _Metric], rows: Iterable[tuple], key_fn) -> None:
    for (created_at, bank_id, branch_id, service_line, case_type, bank_name, branch_name, client_id, client_label) in rows:
        key = key_fn(
            bank_id=bank_id,
            branch_id=branch_id,
            service_line=service_line,
            case_type=case_type,
            client_id=client_id,
            client_label=client_label,
        )
        if not key:
            continue
        metric = metrics.setdefault(key, _Metric())
        metric.assignments += 1
        created_at = _ensure_aware(created_at)
        if created_at:
            month = _month_key(created_at)
            metric.monthly_counts[month] += 1
            if not metric.last_assignment_at or created_at > metric.last_assignment_at:
                metric.last_assignment_at = created_at


def _accumulate_invoices(metrics: dict[str, _Metric], rows: Iterable[tuple], key_fn) -> None:
    for invoice, bank_id, branch_id, service_line, case_type, client_id in rows:
        key = key_fn(
            bank_id=bank_id,
            branch_id=branch_id,
            service_line=service_line,
            case_type=case_type,
            client_id=client_id,
            client_label=None,
        )
        if not key:
            continue
        metric = metrics.setdefault(key, _Metric())
        total = Decimal(invoice.total_amount or Decimal("0.00"))
        metric.billed += total
        if invoice.is_paid:
            metric.collected += total
        else:
            metric.outstanding += total
        if invoice.issued_date:
            month = invoice.issued_date.strftime("%Y-%m")
            metric.monthly_billed[month] += total


@router.get("/source-intel", response_model=AnalyticsResponse)
def source_intel(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    compare_start: datetime | None = Query(None),
    compare_end: datetime | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsResponse:
    _require_access(current_user)

    start_at, end_at = _normalize_range(_coerce_datetime(start), _coerce_datetime(end))
    compare_start_dt = _coerce_datetime(compare_start)
    compare_end_dt = _coerce_datetime(compare_end)
    if compare_start_dt and compare_end_dt:
        prev_start, prev_end = _normalize_range(compare_start_dt, compare_end_dt)
    else:
        prev_start, prev_end = _previous_range(start_at, end_at)

    assignment_opts = [
        selectinload(Assignment.bank),
        selectinload(Assignment.branch),
        selectinload(Assignment.client),
    ]

    current_assignments = (
        db.query(Assignment)
        .options(*assignment_opts)
        .filter(
            Assignment.is_deleted.is_(False),
            Assignment.created_at >= start_at,
            Assignment.created_at <= end_at,
        )
        .all()
    )
    prev_assignments = (
        db.query(Assignment)
        .options(*assignment_opts)
        .filter(
            Assignment.is_deleted.is_(False),
            Assignment.created_at >= prev_start,
            Assignment.created_at <= prev_end,
        )
        .all()
    )

    current_invoices = (
        db.query(Invoice)
        .options(selectinload(Invoice.assignment).selectinload(Assignment.bank),
                 selectinload(Invoice.assignment).selectinload(Assignment.branch),
                 selectinload(Invoice.assignment).selectinload(Assignment.client))
        .filter(
            Invoice.issued_date >= start_at.date(),
            Invoice.issued_date <= end_at.date(),
        )
        .all()
    )
    prev_invoices = (
        db.query(Invoice)
        .options(selectinload(Invoice.assignment).selectinload(Assignment.bank),
                 selectinload(Invoice.assignment).selectinload(Assignment.branch),
                 selectinload(Invoice.assignment).selectinload(Assignment.client))
        .filter(
            Invoice.issued_date >= prev_start.date(),
            Invoice.issued_date <= prev_end.date(),
        )
        .all()
    )

    metrics: Dict[str, AnalyticsSourceRow] = {}
    prev_assignment_counts: Dict[str, int] = defaultdict(int)
    prev_revenue: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))

    for assignment in prev_assignments:
        key, _meta = _resolve_source(assignment)
        prev_assignment_counts[key] += 1

    for invoice in prev_invoices:
        assignment = invoice.assignment
        if not assignment:
            continue
        key, _meta = _resolve_source(assignment)
        prev_revenue[key] += Decimal(invoice.total_amount or Decimal("0.00"))

    for assignment in current_assignments:
        key, meta = _resolve_source(assignment)
        row = metrics.get(key)
        if not row:
            row = AnalyticsSourceRow(source_key=key, **meta)
            metrics[key] = row
        row.assignments += 1
        created_at = _ensure_aware(assignment.created_at)
        last_seen = _ensure_aware(row.last_assignment_at)
        if created_at and (not last_seen or created_at > last_seen):
            row.last_assignment_at = created_at

    for invoice in current_invoices:
        assignment = invoice.assignment
        if not assignment:
            continue
        key, meta = _resolve_source(assignment)
        row = metrics.get(key)
        if not row:
            row = AnalyticsSourceRow(source_key=key, **meta)
            metrics[key] = row
        total = Decimal(invoice.total_amount or Decimal("0.00"))
        row.revenue += total
        if invoice.is_paid:
            row.collected += total
        else:
            row.outstanding += total

    for key, row in metrics.items():
        prev_assignments = prev_assignment_counts.get(key, 0)
        prev_billed = prev_revenue.get(key, Decimal("0.00"))
        row.assignments_change_pct = _pct_change(row.assignments, prev_assignments)
        row.revenue_change_pct = _pct_change(row.revenue, prev_billed)
        row.avg_per_assignment = (
            (row.revenue / row.assignments) if row.assignments > 0 else Decimal("0.00")
        )
        if prev_assignments == 0 and row.assignments > 0:
            row.status = "NEW"
        elif (row.assignments_change_pct is not None and row.assignments_change_pct <= -0.2) or (
            row.revenue_change_pct is not None and row.revenue_change_pct <= -0.2
        ):
            row.status = "DECLINING"
        elif (row.assignments_change_pct is not None and row.assignments_change_pct >= 0.2) or (
            row.revenue_change_pct is not None and row.revenue_change_pct >= 0.2
        ):
            row.status = "GROWING"
        else:
            row.status = "STABLE"

    sources = sorted(metrics.values(), key=lambda r: (r.revenue, r.assignments), reverse=True)[:limit]

    overview = AnalyticsOverview(
        period_start=start_at,
        period_end=end_at,
        assignments=len(current_assignments),
        billed=sum((row.revenue for row in metrics.values()), start=Decimal("0.00")),
        collected=sum((row.collected for row in metrics.values()), start=Decimal("0.00")),
        outstanding=sum((row.outstanding for row in metrics.values()), start=Decimal("0.00")),
    )

    signals: list[AnalyticsSignal] = []
    now = datetime.now(timezone.utc)
    for row in sources:
        if row.assignments_change_pct is not None and row.assignments_change_pct <= -0.3 and row.assignments >= 3:
            signals.append(
                AnalyticsSignal(
                    level="warning",
                    message=f"{row.source_name} down {abs(int(row.assignments_change_pct * 100))}% vs previous period",
                    source_key=row.source_key,
                    source_type=row.source_type,
                    source_name=row.source_name,
                )
            )
        if row.revenue_change_pct is not None and row.revenue_change_pct <= -0.3 and row.revenue > 0:
            signals.append(
                AnalyticsSignal(
                    level="warning",
                    message=f"{row.source_name} revenue down {abs(int(row.revenue_change_pct * 100))}%",
                    source_key=row.source_key,
                    source_type=row.source_type,
                    source_name=row.source_name,
                )
            )
        last_seen = _ensure_aware(row.last_assignment_at)
        if last_seen and (now - last_seen).days >= 45:
            signals.append(
                AnalyticsSignal(
                    level="danger",
                    message=f"{row.source_name} inactive for {(now - last_seen).days} days",
                    source_key=row.source_key,
                    source_type=row.source_type,
                    source_name=row.source_name,
                )
            )

    signals = signals[:8]

    months = _range_months(start_at, end_at)
    assignment_trend = defaultdict(int)
    revenue_trend = defaultdict(lambda: Decimal("0.00"))
    for assignment in current_assignments:
        if assignment.created_at:
            assignment_trend[_month_key(assignment.created_at)] += 1
    for invoice in current_invoices:
        if invoice.issued_date:
            month = invoice.issued_date.strftime("%Y-%m")
            revenue_trend[month] += Decimal(invoice.total_amount or Decimal("0.00"))

    trends = [
        AnalyticsTrendPoint(
            period=month,
            assignments=assignment_trend.get(month, 0),
            revenue=revenue_trend.get(month, Decimal("0.00")),
        )
        for month in months
    ]

    return AnalyticsResponse(overview=overview, sources=sources, signals=signals, trends=trends)


def _overview_from_metrics(metrics: Iterable[_Metric], start_at: datetime, end_at: datetime) -> AnalyticsOverviewV2:
    billed = sum((m.billed for m in metrics), start=Decimal("0.00"))
    collected = sum((m.collected for m in metrics), start=Decimal("0.00"))
    outstanding = sum((m.outstanding for m in metrics), start=Decimal("0.00"))
    assignments = sum((m.assignments for m in metrics), start=0)
    return AnalyticsOverviewV2(
        period_start=start_at,
        period_end=end_at,
        assignments=assignments,
        billed=billed,
        collected=collected,
        outstanding=outstanding,
    )


def _require_admin(user: User) -> None:
    if not rbac.user_has_role(user, Role.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


@router.get("/settings", response_model=AnalyticsSettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsSettingsResponse:
    _require_access(current_user)
    settings = _get_settings(db)

    end_at = datetime.now(timezone.utc)
    start_at = end_at - timedelta(days=180)
    months = _range_months(start_at, end_at)

    assignment_rows = _fetch_assignment_rows(db, start_at, end_at, case_type=CaseType.BANK)
    invoice_rows = _fetch_invoice_rows(db, start_at, end_at, case_type=CaseType.BANK)

    metrics: dict[str, _Metric] = {}

    def bank_key_fn(**kwargs):
        bank_id = kwargs.get("bank_id")
        return f"BANK:{bank_id}" if bank_id else None

    _accumulate_assignments(metrics, assignment_rows, bank_key_fn)
    _accumulate_invoices(metrics, invoice_rows, bank_key_fn)

    total_counts = [0 for _ in months]
    total_revenue = [Decimal("0.00") for _ in months]
    for metric in metrics.values():
        for idx, month in enumerate(months):
            total_counts[idx] += metric.monthly_counts.get(month, 0)
            total_revenue[idx] += metric.monthly_billed.get(month, Decimal("0.00"))

    recommended, note = _recommend_thresholds(total_counts, total_revenue)

    return AnalyticsSettingsResponse(
        settings=AnalyticsSettingsRead.model_validate(settings),
        recommended=recommended,
        recommended_note=note,
    )


@router.patch("/settings", response_model=AnalyticsSettingsRead)
def update_settings(
    settings_update: AnalyticsSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsSettingsRead:
    _require_admin(current_user)
    settings = _get_settings(db)
    update_data = settings_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return AnalyticsSettingsRead.model_validate(settings)


@router.get("/banks", response_model=AnalyticsBankResponse)
def bank_analytics(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    compare_start: datetime | None = Query(None),
    compare_end: datetime | None = Query(None),
    include_non_bank: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsBankResponse:
    _require_access(current_user)
    settings = _get_settings(db)

    start_at, end_at = _normalize_range(_coerce_datetime(start), _coerce_datetime(end))
    compare_start_dt = _coerce_datetime(compare_start)
    compare_end_dt = _coerce_datetime(compare_end)
    if compare_start_dt and compare_end_dt:
        prev_start, prev_end = _normalize_range(compare_start_dt, compare_end_dt)
    else:
        prev_start, prev_end = _previous_range(start_at, end_at)

    months = _range_months(start_at, end_at)

    bank_map = {b.id: b.name for b in db.query(Bank).all()}
    branch_map = {b.id: (b.name, b.bank_id) for b in db.query(Branch).all()}

    def bank_key_fn(**kwargs):
        bank_id = kwargs.get("bank_id")
        return f"BANK:{bank_id}" if bank_id else None

    def branch_key_fn(**kwargs):
        branch_id = kwargs.get("branch_id")
        return f"BRANCH:{branch_id}" if branch_id else None

    assignment_rows = _fetch_assignment_rows(db, start_at, end_at, case_type=CaseType.BANK)
    prev_assignment_rows = _fetch_assignment_rows(db, prev_start, prev_end, case_type=CaseType.BANK)
    invoice_rows = _fetch_invoice_rows(db, start_at, end_at, case_type=CaseType.BANK)
    prev_invoice_rows = _fetch_invoice_rows(db, prev_start, prev_end, case_type=CaseType.BANK)

    current_bank_metrics: dict[str, _Metric] = {}
    current_branch_metrics: dict[str, _Metric] = {}
    prev_bank_metrics: dict[str, _Metric] = {}
    prev_branch_metrics: dict[str, _Metric] = {}

    _accumulate_assignments(current_bank_metrics, assignment_rows, bank_key_fn)
    _accumulate_assignments(current_branch_metrics, assignment_rows, branch_key_fn)
    _accumulate_assignments(prev_bank_metrics, prev_assignment_rows, bank_key_fn)
    _accumulate_assignments(prev_branch_metrics, prev_assignment_rows, branch_key_fn)

    _accumulate_invoices(current_bank_metrics, invoice_rows, bank_key_fn)
    _accumulate_invoices(current_branch_metrics, invoice_rows, branch_key_fn)
    _accumulate_invoices(prev_bank_metrics, prev_invoice_rows, bank_key_fn)
    _accumulate_invoices(prev_branch_metrics, prev_invoice_rows, branch_key_fn)

    branch_bank_lookup: dict[int, int | None] = {}
    branch_name_lookup: dict[int, str] = {}
    for (created_at, bank_id, branch_id, _service_line, _case_type, _bank_name, branch_name, _client_id, _client_label) in assignment_rows:
        if branch_id:
            branch_bank_lookup.setdefault(branch_id, bank_id)
            if branch_name:
                branch_name_lookup[branch_id] = branch_name

    bank_rows: list[AnalyticsEntityRow] = []
    all_bank_keys = set(current_bank_metrics.keys()) | set(prev_bank_metrics.keys())
    for key in all_bank_keys:
        bank_id = int(key.split(":")[1]) if ":" in key else None
        label = bank_map.get(bank_id) or (f"Bank {bank_id}" if bank_id else "Unknown Bank")
        current = current_bank_metrics.get(key, _Metric())
        prev = prev_bank_metrics.get(key, _Metric())
        row = _metric_to_row(
            entity_type="BANK",
            entity_key=key,
            entity_label=label,
            entity_id=bank_id,
            current=current,
            previous=prev,
            months=months,
            inactivity_days=settings.inactivity_days,
        )

        branch_children: list[AnalyticsEntityRow] = []
        branch_keys = set(current_branch_metrics.keys()) | set(prev_branch_metrics.keys())
        for branch_key in branch_keys:
            branch_id = int(branch_key.split(":")[1]) if ":" in branch_key else None
            if not branch_id:
                continue
            branch_name, branch_bank_id = branch_map.get(branch_id, (None, None))
            if branch_bank_id is None:
                branch_bank_id = branch_bank_lookup.get(branch_id)
            if branch_name is None:
                branch_name = branch_name_lookup.get(branch_id)
            if branch_bank_id != bank_id:
                continue
            metric = current_branch_metrics.get(branch_key, _Metric())
            prev_branch = prev_branch_metrics.get(branch_key, _Metric())
            branch_row = _metric_to_row(
                entity_type="BRANCH",
                entity_key=branch_key,
                entity_label=branch_name or f"Branch {branch_id}",
                entity_id=branch_id,
                parent_id=bank_id,
                current=metric,
                previous=prev_branch,
                months=months,
                inactivity_days=settings.inactivity_days,
            )
            branch_children.append(branch_row)

        row.children = sorted(branch_children, key=lambda r: (r.billed, r.assignments), reverse=True)
        bank_rows.append(row)

    bank_rows.sort(key=lambda r: (r.billed, r.assignments), reverse=True)

    non_bank_rows: list[AnalyticsEntityRow] = []
    if include_non_bank:
        def client_key_fn(**kwargs):
            case_type = kwargs.get("case_type")
            if case_type == CaseType.BANK:
                return None
            client_id = kwargs.get("client_id")
            client_label = kwargs.get("client_label") or "Client"
            return f"CLIENT:{client_id or client_label}"

        non_bank_assignments = _fetch_assignment_rows(db, start_at, end_at)
        prev_non_bank_assignments = _fetch_assignment_rows(db, prev_start, prev_end)
        non_bank_invoices = _fetch_invoice_rows(db, start_at, end_at)
        prev_non_bank_invoices = _fetch_invoice_rows(db, prev_start, prev_end)

        current_clients: dict[str, _Metric] = {}
        prev_clients: dict[str, _Metric] = {}

        _accumulate_assignments(current_clients, non_bank_assignments, client_key_fn)
        _accumulate_assignments(prev_clients, prev_non_bank_assignments, client_key_fn)
        _accumulate_invoices(current_clients, non_bank_invoices, client_key_fn)
        _accumulate_invoices(prev_clients, prev_non_bank_invoices, client_key_fn)

        for key, metric in current_clients.items():
            if key.startswith("CLIENT:"):
                label = key.split(":", 1)[1]
                prev_metric = prev_clients.get(key, _Metric())
                row = _metric_to_row(
                    entity_type="CLIENT",
                    entity_key=key,
                    entity_label=label,
                    current=metric,
                    previous=prev_metric,
                    months=months,
                    inactivity_days=settings.inactivity_days,
                )
                non_bank_rows.append(row)

        non_bank_rows.sort(key=lambda r: (r.billed, r.assignments), reverse=True)

    overview = _overview_from_metrics(list(current_bank_metrics.values()), start_at, end_at)
    return AnalyticsBankResponse(overview=overview, banks=bank_rows, non_bank_sources=non_bank_rows)


@router.get("/service-lines", response_model=AnalyticsSegmentResponse)
def service_line_analytics(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    compare_start: datetime | None = Query(None),
    compare_end: datetime | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsSegmentResponse:
    _require_access(current_user)
    settings = _get_settings(db)
    start_at, end_at = _normalize_range(_coerce_datetime(start), _coerce_datetime(end))
    compare_start_dt = _coerce_datetime(compare_start)
    compare_end_dt = _coerce_datetime(compare_end)
    if compare_start_dt and compare_end_dt:
        prev_start, prev_end = _normalize_range(compare_start_dt, compare_end_dt)
    else:
        prev_start, prev_end = _previous_range(start_at, end_at)
    months = _range_months(start_at, end_at)

    def service_key_fn(**kwargs):
        service_line = kwargs.get("service_line") or ServiceLine.VALUATION
        return f"SERVICE_LINE:{service_line.value}"

    assignment_rows = _fetch_assignment_rows(db, start_at, end_at)
    prev_assignment_rows = _fetch_assignment_rows(db, prev_start, prev_end)
    invoice_rows = _fetch_invoice_rows(db, start_at, end_at)
    prev_invoice_rows = _fetch_invoice_rows(db, prev_start, prev_end)

    current_metrics: dict[str, _Metric] = {}
    prev_metrics: dict[str, _Metric] = {}

    _accumulate_assignments(current_metrics, assignment_rows, service_key_fn)
    _accumulate_assignments(prev_metrics, prev_assignment_rows, service_key_fn)
    _accumulate_invoices(current_metrics, invoice_rows, service_key_fn)
    _accumulate_invoices(prev_metrics, prev_invoice_rows, service_key_fn)

    rows: list[AnalyticsEntityRow] = []
    for key, metric in current_metrics.items():
        label = key.split(":", 1)[1]
        prev_metric = prev_metrics.get(key, _Metric())
        rows.append(
            _metric_to_row(
                entity_type="SERVICE_LINE",
                entity_key=key,
                entity_label=label,
                current=metric,
                previous=prev_metric,
                months=months,
                inactivity_days=settings.inactivity_days,
            )
        )

    rows.sort(key=lambda r: (r.billed, r.assignments), reverse=True)
    overview = _overview_from_metrics(list(current_metrics.values()), start_at, end_at)
    return AnalyticsSegmentResponse(overview=overview, rows=rows)


@router.get("/case-types", response_model=AnalyticsSegmentResponse)
def case_type_analytics(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    compare_start: datetime | None = Query(None),
    compare_end: datetime | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsSegmentResponse:
    _require_access(current_user)
    settings = _get_settings(db)
    start_at, end_at = _normalize_range(start, end)
    if compare_start and compare_end:
        prev_start, prev_end = _normalize_range(compare_start, compare_end)
    else:
        prev_start, prev_end = _previous_range(start_at, end_at)
    months = _range_months(start_at, end_at)

    def case_key_fn(**kwargs):
        case_type = kwargs.get("case_type") or CaseType.BANK
        return f"CASE_TYPE:{case_type.value}"

    assignment_rows = _fetch_assignment_rows(db, start_at, end_at)
    prev_assignment_rows = _fetch_assignment_rows(db, prev_start, prev_end)
    invoice_rows = _fetch_invoice_rows(db, start_at, end_at)
    prev_invoice_rows = _fetch_invoice_rows(db, prev_start, prev_end)

    current_metrics: dict[str, _Metric] = {}
    prev_metrics: dict[str, _Metric] = {}

    _accumulate_assignments(current_metrics, assignment_rows, case_key_fn)
    _accumulate_assignments(prev_metrics, prev_assignment_rows, case_key_fn)
    _accumulate_invoices(current_metrics, invoice_rows, case_key_fn)
    _accumulate_invoices(prev_metrics, prev_invoice_rows, case_key_fn)

    rows: list[AnalyticsEntityRow] = []
    for key, metric in current_metrics.items():
        label = key.split(":", 1)[1]
        prev_metric = prev_metrics.get(key, _Metric())
        rows.append(
            _metric_to_row(
                entity_type="CASE_TYPE",
                entity_key=key,
                entity_label=label,
                current=metric,
                previous=prev_metric,
                months=months,
                inactivity_days=settings.inactivity_days,
            )
        )

    rows.sort(key=lambda r: (r.billed, r.assignments), reverse=True)
    overview = _overview_from_metrics(list(current_metrics.values()), start_at, end_at)
    return AnalyticsSegmentResponse(overview=overview, rows=rows)


def _export_rows_for_view(view_mode: str, data, include_non_bank: bool) -> list[dict]:
    rows: list[dict] = []
    if view_mode == "banks":
        for bank in data.banks:
            rows.append({"entity": bank.entity_label, "type": bank.entity_type, "parent": "" , "row": bank})
            for branch in bank.children or []:
                rows.append({"entity": f"  - {branch.entity_label}", "type": branch.entity_type, "parent": bank.entity_label, "row": branch})
        if include_non_bank:
            for client in data.non_bank_sources or []:
                rows.append({"entity": client.entity_label, "type": client.entity_type, "parent": "Non Bank", "row": client})
        return rows
    for row in data.rows:
        rows.append({"entity": row.entity_label, "type": row.entity_type, "parent": "", "row": row})
    return rows


@router.get("/export.pdf")
def export_analytics_pdf(
    view_mode: str = Query("banks"),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    include_non_bank: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_access(current_user)
    view_mode = view_mode.lower()
    if view_mode not in {"banks", "service-lines", "case-types"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid view_mode")

    if view_mode == "banks":
        data = bank_analytics(start=start, end=end, include_non_bank=include_non_bank, db=db, current_user=current_user)
    elif view_mode == "service-lines":
        data = service_line_analytics(start=start, end=end, db=db, current_user=current_user)
    else:
        data = case_type_analytics(start=start, end=end, db=db, current_user=current_user)

    overview = data.overview
    rows = _export_rows_for_view(view_mode, data, include_non_bank)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        leftMargin=24,
        rightMargin=24,
        topMargin=24,
        bottomMargin=24,
        title="Analytics Export",
    )
    styles = getSampleStyleSheet()
    elements: list = []
    title = f"Analytics Export — {view_mode.replace('-', ' ').title()}"
    elements.append(Paragraph(title, styles["Title"]))

    range_start, range_end = _normalize_range(start, end)
    elements.append(Paragraph(f"Range: {_format_datetime(range_start)} to {_format_datetime(range_end)}", styles["Normal"]))
    elements.append(
        Paragraph(
            f"Assignments: {overview.assignments} · Billed: {_format_decimal(overview.billed)} · "
            f"Collected: {_format_decimal(overview.collected)} · Outstanding: {_format_decimal(overview.outstanding)}",
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 12))

    headers = [
        "Entity",
        "Type",
        "Assignments",
        "Chg Assign",
        "Billed",
        "Chg Billed",
        "Collected",
        "Outstanding",
        "Health",
        "Last Assignment",
        "Forecast",
    ]
    table_data = [headers]
    for entry in rows:
        row = entry["row"]
        forecast = row.forecast.expected_assignments if row.forecast else "-"
        table_data.append([
            entry["entity"],
            entry["type"],
            row.assignments,
            "-" if row.assignments_change_pct is None else f"{row.assignments_change_pct:.0%}",
            _format_decimal(row.billed),
            "-" if row.billed_change_pct is None else f"{row.billed_change_pct:.0%}",
            _format_decimal(row.collected),
            _format_decimal(row.outstanding),
            row.health_label,
            _format_datetime(row.last_assignment_at),
            forecast,
        ])

    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b2749")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#253355")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#f4f6fb")]),
            ]
        )
    )
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    filename = f"analytics_{view_mode}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)


@router.get("/forecast", response_model=ForecastSummary)
def forecast_entity(
    entity_type: str = Query(...),
    entity_id: Optional[int] = Query(None),
    service_line: Optional[ServiceLine] = Query(None),
    case_type: Optional[CaseType] = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ForecastSummary:
    _require_access(current_user)
    start_at, end_at = _normalize_range(start, end)
    months = _range_months(start_at, end_at)

    def assignment_query():
        query = (
            db.query(
                Assignment.created_at,
                Assignment.bank_id,
                Assignment.branch_id,
                Assignment.service_line,
                Assignment.case_type,
                Assignment.bank_name,
                Assignment.branch_name,
                Assignment.client_id,
                Assignment.valuer_client_name,
            )
            .filter(
                Assignment.is_deleted.is_(False),
                Assignment.created_at >= start_at,
                Assignment.created_at <= end_at,
            )
        )
        return query

    def invoice_query():
        query = (
            db.query(
                Invoice,
                Assignment.bank_id,
                Assignment.branch_id,
                Assignment.service_line,
                Assignment.case_type,
                Assignment.client_id,
            )
            .join(Assignment, Invoice.assignment_id == Assignment.id)
            .filter(
                Assignment.is_deleted.is_(False),
                Invoice.issued_date >= start_at.date(),
                Invoice.issued_date <= end_at.date(),
            )
        )
        return query

    metrics: dict[str, _Metric] = {}

    if entity_type.upper() == "BANK":
        if not entity_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="entity_id required for BANK forecast")

        def key_fn(**kwargs):
            return "TARGET" if kwargs.get("bank_id") == entity_id else None

        assignment_rows = assignment_query().filter(Assignment.case_type == CaseType.BANK, Assignment.bank_id == entity_id).all()
        invoice_rows = invoice_query().filter(Assignment.case_type == CaseType.BANK, Assignment.bank_id == entity_id).all()
        _accumulate_assignments(metrics, assignment_rows, key_fn)
        _accumulate_invoices(metrics, invoice_rows, key_fn)

    elif entity_type.upper() == "BRANCH":
        if not entity_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="entity_id required for BRANCH forecast")

        def key_fn(**kwargs):
            return "TARGET" if kwargs.get("branch_id") == entity_id else None

        assignment_rows = assignment_query().filter(Assignment.branch_id == entity_id).all()
        invoice_rows = invoice_query().filter(Assignment.branch_id == entity_id).all()
        _accumulate_assignments(metrics, assignment_rows, key_fn)
        _accumulate_invoices(metrics, invoice_rows, key_fn)

    elif entity_type.upper() == "SERVICE_LINE":
        if not service_line:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="service_line required for SERVICE_LINE forecast")

        def key_fn(**kwargs):
            return "TARGET" if kwargs.get("service_line") == service_line else None

        assignment_rows = assignment_query().filter(Assignment.service_line == service_line).all()
        invoice_rows = invoice_query().filter(Assignment.service_line == service_line).all()
        _accumulate_assignments(metrics, assignment_rows, key_fn)
        _accumulate_invoices(metrics, invoice_rows, key_fn)

    elif entity_type.upper() == "CASE_TYPE":
        if not case_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="case_type required for CASE_TYPE forecast")

        def key_fn(**kwargs):
            return "TARGET" if kwargs.get("case_type") == case_type else None

        assignment_rows = assignment_query().filter(Assignment.case_type == case_type).all()
        invoice_rows = invoice_query().filter(Assignment.case_type == case_type).all()
        _accumulate_assignments(metrics, assignment_rows, key_fn)
        _accumulate_invoices(metrics, invoice_rows, key_fn)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported entity_type")

    metric = metrics.get("TARGET", _Metric())
    return _build_forecast(months, metric)


@router.get("/forecast-v2", response_model=ForecastV2Response)
def forecast_v2(
    entity_type: str = Query(...),
    entity_id: Optional[int] = Query(None),
    service_line: Optional[ServiceLine] = Query(None),
    case_type: Optional[CaseType] = Query(None),
    months_back: int = Query(12, ge=6, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ForecastV2Response:
    _require_access(current_user)
    entity_type_upper = entity_type.upper()
    if entity_type_upper in {"BANK", "BRANCH"} and not entity_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="entity_id required")
    if entity_type_upper == "SERVICE_LINE" and not service_line:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="service_line required")
    if entity_type_upper == "CASE_TYPE" and not case_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="case_type required")

    end_at = datetime.now(timezone.utc)
    start_at = _shift_month_start(datetime(end_at.year, end_at.month, 1, tzinfo=timezone.utc), -(months_back - 1))
    months = _range_months(start_at, end_at)

    case_filter = CaseType.BANK if entity_type_upper in {"BANK", "BRANCH"} else None
    assignment_rows = _fetch_assignment_rows(db, start_at, end_at, case_type=case_filter)
    invoice_rows = _fetch_invoice_rows(db, start_at, end_at, case_type=case_filter)

    def key_fn(**kwargs):
        if entity_type_upper == "BANK":
            return "TARGET" if kwargs.get("bank_id") == entity_id else None
        if entity_type_upper == "BRANCH":
            return "TARGET" if kwargs.get("branch_id") == entity_id else None
        if entity_type_upper == "SERVICE_LINE":
            return "TARGET" if (kwargs.get("service_line") or ServiceLine.VALUATION) == service_line else None
        if entity_type_upper == "CASE_TYPE":
            return "TARGET" if kwargs.get("case_type") == case_type else None
        return None

    metrics: dict[str, _Metric] = {}
    _accumulate_assignments(metrics, assignment_rows, key_fn)
    _accumulate_invoices(metrics, invoice_rows, key_fn)
    metric = metrics.get("TARGET", _Metric())

    entity_label = entity_type_upper
    if entity_type_upper == "BANK":
        bank = db.get(Bank, entity_id)
        entity_label = bank.name if bank else f"Bank {entity_id}"
    elif entity_type_upper == "BRANCH":
        branch = db.get(Branch, entity_id)
        entity_label = branch.name if branch else f"Branch {entity_id}"
    elif entity_type_upper == "SERVICE_LINE":
        entity_label = service_line.value if service_line else "SERVICE_LINE"
    elif entity_type_upper == "CASE_TYPE":
        entity_label = case_type.value if case_type else "CASE_TYPE"

    counts_series = [metric.monthly_counts.get(month, 0) for month in months]
    avg_count = mean(counts_series) if counts_series else 0
    volatility = pstdev(counts_series) if len(counts_series) > 1 else 0
    if avg_count == 0:
        note = "Insufficient history for a strong confidence band."
    elif volatility / avg_count > 0.6:
        note = "Volatile series; wider confidence band applied."
    elif volatility / avg_count > 0.3:
        note = "Moderate volatility; confidence band based on recent spread."
    else:
        note = "Stable recent trend; tighter confidence band."

    return ForecastV2Response(
        entity_type=entity_type_upper,
        entity_id=entity_id,
        entity_label=entity_label,
        period_start=start_at,
        period_end=end_at,
        monthly=_build_trend(months, metric),
        quarterly=_build_quarterly(months, metric),
        seasonality=_build_seasonality(months, metric),
        forecast=_build_forecast(months, metric),
        confidence_note=note,
    )


@router.get("/signals", response_model=List[AnalyticsSignal])
def analytics_signals(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    create_tasks: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[AnalyticsSignal]:
    _require_access(current_user)
    try:
        settings = _get_settings(db)
    except SQLAlchemyError:
        logger.exception("Analytics settings unavailable; returning empty signals.")
        return []
    if not start and not end:
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=settings.time_window_days)

    try:
        bank_response = bank_analytics(start=start, end=end, include_non_bank=False, db=db, current_user=current_user)
    except SQLAlchemyError:
        logger.exception("Failed to compute analytics signals; returning empty list.")
        return []

    signals: list[AnalyticsSignal] = []
    now = datetime.now(timezone.utc)

    def baseline_ok(row: AnalyticsEntityRow) -> bool:
        return row.assignments >= settings.baseline_min_count or row.billed >= settings.baseline_min_revenue

    def add_signal(row: AnalyticsEntityRow, reason: str, level: str, observed: str, expected: str, action: str) -> None:
        signals.append(
            AnalyticsSignal(
                level=level,
                message=f"{row.entity_label} {reason.replace('_', ' ').title()}",
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                source_name=row.entity_label,
                reason_code=reason,
                observed_value=observed,
                expected_value=expected,
                recommended_action=action,
            )
        )

    def evaluate_row(row: AnalyticsEntityRow) -> None:
        if baseline_ok(row) and row.assignments_change_pct is not None:
            if row.assignments_change_pct <= float(settings.decline_threshold_count) * -1:
                add_signal(
                    row,
                    "FREQ_DROP",
                    "warning",
                    f"{row.assignments} assignments",
                    "Previous period",
                    "Visit branch / check pipeline",
                )
        if baseline_ok(row) and row.billed_change_pct is not None:
            if row.billed_change_pct <= float(settings.decline_threshold_revenue) * -1:
                add_signal(
                    row,
                    "REV_DROP",
                    "warning",
                    f"{row.billed}",
                    "Previous period",
                    "Review fee pressure and pipeline",
                )
        if row.last_assignment_at:
            days_idle = (now - _ensure_aware(row.last_assignment_at)).days
            if days_idle >= settings.inactivity_days:
                add_signal(
                    row,
                    "INACTIVE",
                    "danger",
                    f"{days_idle} days",
                    f"{settings.inactivity_days} days",
                    "Call branch, check empanelment status",
                )
        if settings.outstanding_threshold > 0 and row.outstanding >= settings.outstanding_threshold:
            add_signal(
                row,
                "OUTSTANDING",
                "warning",
                f"{row.outstanding}",
                f"{settings.outstanding_threshold}",
                "Payment follow-up",
            )

        if row.forecast and row.forecast.expected_assignments > 0:
            threshold = 1 - float(settings.decline_threshold_count)
            if row.forecast.observed_assignments < row.forecast.expected_assignments * threshold:
                add_signal(
                    row,
                    "FREQ_DROP",
                    "warning",
                    f"{row.forecast.observed_assignments} observed",
                    f"{row.forecast.expected_assignments} expected",
                    "Investigate pipeline shortfall",
                )

    for bank in bank_response.banks:
        evaluate_row(bank)
        for branch in bank.children:
            evaluate_row(branch)

    if create_tasks and signals:
        try:
            inspector = inspect(db.get_bind())
            if "follow_up_tasks" not in inspector.get_table_names():
                return signals[:50]

            admin_users = db.query(User).filter(User.has_role(Role.ADMIN)).all()
            ops_users = db.query(User).filter(User.has_role(Role.OPS_MANAGER)).all()
            admin_ids = [u.id for u in admin_users]
            notify_ids = list({*admin_ids, *[u.id for u in ops_users]})
            assigned_admin_id = admin_ids[0] if admin_ids else (notify_ids[0] if notify_ids else current_user.id)

            for signal in signals:
                if not signal.entity_type or not signal.reason_code:
                    continue
                dedupe_key = f"{signal.entity_type}:{signal.entity_id or signal.source_name}:{signal.reason_code}"[:120]
                window_start = datetime.now(timezone.utc) - timedelta(days=settings.followup_cooldown_days)
                existing = (
                    db.query(FollowUpTask)
                    .filter(
                        FollowUpTask.dedupe_key == dedupe_key,
                        FollowUpTask.created_at >= window_start,
                    )
                    .first()
                )
                if existing:
                    signal.follow_up_task_id = existing.id
                    continue

                title = f"Follow up: {signal.source_name} ({signal.reason_code})"
                description = (
                    f"Observed: {signal.observed_value}\nExpected: {signal.expected_value}\n"
                    f"Recommended action: {signal.recommended_action}"
                )
                task = FollowUpTask(
                    entity_type=signal.entity_type,
                    entity_id=signal.entity_id,
                    entity_label=signal.source_name or "Unknown",
                    reason_code=signal.reason_code,
                    status="OPEN",
                    severity="HIGH" if signal.level == "danger" else "MEDIUM",
                    title=title,
                    description=description,
                    assigned_to_user_id=assigned_admin_id,
                    created_by_user_id=current_user.id,
                    due_at=now + timedelta(days=7),
                    payload={
                        "observed": signal.observed_value,
                        "expected": signal.expected_value,
                        "recommended_action": signal.recommended_action,
                    },
                    dedupe_key=dedupe_key,
                )
                db.add(task)
                db.flush()
                signal.follow_up_task_id = task.id

                for admin_id in notify_ids:
                    create_notification(
                        db,
                        user_id=admin_id,
                        notif_type=NotificationType.RELATIONSHIP_ALERT,
                        message=task.title,
                        payload={
                            "follow_up_task_id": task.id,
                            "entity_type": signal.entity_type,
                            "entity_id": signal.entity_id,
                        },
                    )
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            logger.exception("Failed to create analytics follow-up tasks or notifications.")

    return signals[:50]


@router.get("/weekly-digest", response_model=WeeklyDigestResponse)
def weekly_digest(
    days: int = Query(7, ge=1, le=31),
    create_notification: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WeeklyDigestResponse:
    _require_access(current_user)
    settings = _get_settings(db)

    end_at = datetime.now(timezone.utc)
    start_at = end_at - timedelta(days=days)
    analytics_start = end_at - timedelta(days=settings.time_window_days)

    bank_response = bank_analytics(
        start=analytics_start,
        end=end_at,
        include_non_bank=False,
        db=db,
        current_user=current_user,
    )

    items: list[WeeklyDigestItem] = []
    at_risk = 0
    watch = 0

    def consider_row(row: AnalyticsEntityRow) -> None:
        nonlocal at_risk, watch
        if row.health_label == "At Risk":
            at_risk += 1
        elif row.health_label == "Watch":
            watch += 1
        else:
            return
        items.append(
            WeeklyDigestItem(
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                entity_label=row.entity_label,
                health_label=row.health_label,
                health_score=row.health_score,
                assignments_change_pct=row.assignments_change_pct,
                billed_change_pct=row.billed_change_pct,
                last_assignment_at=row.last_assignment_at,
                health_reasons=row.health_reasons,
            )
        )

    for bank in bank_response.banks:
        consider_row(bank)
        for branch in bank.children:
            consider_row(branch)

    items.sort(key=lambda item: item.health_score)
    summary = f"{at_risk} at-risk and {watch} watch entities in the last {days} days."

    if create_notification and (at_risk > 0 or watch > 0):
        payload = {"weekly_digest": True, "period_end": end_at.date().isoformat()}
        admin_users = db.query(User).filter(User.has_role(Role.ADMIN)).all()
        for admin in admin_users:
            create_notification_if_absent(
                db,
                user_id=admin.id,
                notif_type=NotificationType.RELATIONSHIP_ALERT,
                message=f"Weekly digest: {at_risk} at-risk, {watch} watch.",
                payload=payload,
                payload_match=payload,
                within_minutes=60 * 24 * 7,
            )
        db.commit()

    return WeeklyDigestResponse(
        period_start=start_at,
        period_end=end_at,
        total_at_risk=at_risk,
        total_watch=watch,
        summary=summary,
        items=items,
    )


@router.post("/visit-reminders", response_model=VisitReminderResponse, status_code=status.HTTP_201_CREATED)
def create_visit_reminder(
    reminder: VisitReminderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VisitReminderResponse:
    _require_access(current_user)
    entity_type = reminder.entity_type.upper()
    if entity_type not in {"BANK", "BRANCH"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Visit reminders support BANK or BRANCH only")

    settings = _get_settings(db)
    end_at = datetime.now(timezone.utc)
    analytics_start = end_at - timedelta(days=settings.time_window_days)
    bank_response = bank_analytics(
        start=analytics_start,
        end=end_at,
        include_non_bank=False,
        db=db,
        current_user=current_user,
    )

    target_row: Optional[AnalyticsEntityRow] = None
    for bank in bank_response.banks:
        if entity_type == "BANK" and bank.entity_id == reminder.entity_id:
            target_row = bank
            break
        for branch in bank.children:
            if entity_type == "BRANCH" and branch.entity_id == reminder.entity_id:
                target_row = branch
                break
        if target_row:
            break

    if not target_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found in analytics range")
    if target_row.health_label != "At Risk":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Visit reminders are limited to At Risk entities")

    schedule_date = reminder.scheduled_for or (end_at + timedelta(days=3)).date()
    start_at = datetime(schedule_date.year, schedule_date.month, schedule_date.day, 10, 0, tzinfo=timezone.utc)
    end_at = start_at + timedelta(hours=1)

    title = f"Visit reminder: {target_row.entity_label}"
    description = reminder.note or "Follow up based on analytics risk signals."
    payload = {
        "entity_type": entity_type,
        "entity_id": reminder.entity_id,
        "entity_label": target_row.entity_label,
        "reason": "AT_RISK",
    }

    existing = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.title == title, CalendarEvent.start_at >= (datetime.now(timezone.utc) - timedelta(days=14)))
        .first()
    )
    if existing:
        return VisitReminderResponse(event_id=existing.id, title=existing.title, start_at=existing.start_at, end_at=existing.end_at)

    event_label = (
        db.query(CalendarEventLabel)
        .filter(CalendarEventLabel.default_event_type == CalendarEventType.INTERNAL_MEETING)
        .first()
    )

    assigned_user_ids = [int(uid) for uid in (reminder.assigned_user_ids or []) if uid]
    assigned_to_user_id = reminder.assigned_to_user_id
    if not assigned_to_user_id and assigned_user_ids:
        assigned_to_user_id = sorted(assigned_user_ids)[0]
    if not assigned_to_user_id and not assigned_user_ids:
        admin = db.query(User).filter(User.has_role(Role.ADMIN)).first()
        if admin:
            assigned_to_user_id = admin.id
            assigned_user_ids = [admin.id]
        else:
            assigned_to_user_id = current_user.id
            assigned_user_ids = [current_user.id]

    event = CalendarEvent(
        event_type=CalendarEventType.INTERNAL_MEETING,
        event_label_id=event_label.id if event_label else None,
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
        all_day=False,
        assignment_id=None,
        created_by_user_id=current_user.id,
        assigned_to_user_id=assigned_to_user_id,
        assigned_to_all=False,
        assigned_user_ids=sorted(set(assigned_user_ids)),
        payload_json=payload,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    if reminder.notify:
        if assigned_to_user_id:
            create_notification_if_absent(
                db,
                user_id=assigned_to_user_id,
                notif_type=NotificationType.RELATIONSHIP_ALERT,
                message=title,
                payload={"calendar_event_id": event.id, **payload},
                payload_match={"calendar_event_id": event.id},
                within_minutes=60 * 24,
            )

    return VisitReminderResponse(event_id=event.id, title=event.title, start_at=event.start_at, end_at=event.end_at)


@router.get("/follow-ups", response_model=List[FollowUpTaskRead])
def list_followups(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[FollowUpTaskRead]:
    _require_access(current_user)
    query = db.query(FollowUpTask).order_by(FollowUpTask.created_at.desc())
    if status_filter:
        query = query.filter(FollowUpTask.status == status_filter)
    tasks = query.limit(limit).all()
    return [FollowUpTaskRead.model_validate(t) for t in tasks]


@router.patch("/follow-ups/{task_id}", response_model=FollowUpTaskRead)
def update_followup(
    task_id: int,
    task_update: FollowUpTaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FollowUpTaskRead:
    _require_access(current_user)
    task = db.get(FollowUpTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Follow-up task not found")
    update_data = task_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)
    db.add(task)
    db.commit()
    db.refresh(task)
    return FollowUpTaskRead.model_validate(task)


@router.get("/relationship-logs", response_model=List[RelationshipLogRead])
def list_relationship_logs(
    entity_type: str = Query(...),
    entity_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[RelationshipLogRead]:
    _require_access(current_user)
    query = db.query(RelationshipLog).filter(RelationshipLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(RelationshipLog.entity_id == entity_id)
    logs = query.order_by(RelationshipLog.created_at.desc()).limit(limit).all()
    return [RelationshipLogRead.model_validate(log) for log in logs]


@router.post("/relationship-logs", response_model=RelationshipLogRead, status_code=status.HTTP_201_CREATED)
def create_relationship_log(
    log_in: RelationshipLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RelationshipLogRead:
    _require_access(current_user)
    log = RelationshipLog(
        entity_type=log_in.entity_type,
        entity_id=log_in.entity_id,
        entity_label=log_in.entity_label,
        note=log_in.note,
        next_follow_up_date=log_in.next_follow_up_date,
        created_by_user_id=current_user.id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return RelationshipLogRead.model_validate(log)


@router.get("/partners/summary", response_model=List[PartnerSummaryRead])
def partner_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[PartnerSummaryRead]:
    _require_access(current_user)
    partners = db.query(ExternalPartner).order_by(ExternalPartner.display_name.asc()).all()
    summaries: List[PartnerSummaryRead] = []
    for partner in partners:
        commission_count = db.query(CommissionRequest).filter(CommissionRequest.partner_id == partner.id).count()
        converted_count = (
            db.query(CommissionRequest)
            .filter(
                CommissionRequest.partner_id == partner.id,
                CommissionRequest.status == CommissionRequestStatus.CONVERTED,
            )
            .count()
        )
        invoices = db.query(Invoice).filter(Invoice.partner_id == partner.id).all()
        unpaid_total = sum((inv.amount_due or Decimal("0.00") for inv in invoices), Decimal("0.00"))
        last_commission = (
            db.query(CommissionRequest)
            .filter(CommissionRequest.partner_id == partner.id)
            .order_by(CommissionRequest.updated_at.desc())
            .first()
        )
        last_invoice = (
            db.query(Invoice)
            .filter(Invoice.partner_id == partner.id)
            .order_by(Invoice.updated_at.desc())
            .first()
        )
        last_activity_at = None
        if last_commission and last_invoice:
            last_activity_at = max(last_commission.updated_at, last_invoice.updated_at)
        elif last_commission:
            last_activity_at = last_commission.updated_at
        elif last_invoice:
            last_activity_at = last_invoice.updated_at

        summary = PartnerSummaryRead.model_validate(partner)
        summary.commission_count = commission_count
        summary.converted_count = converted_count
        summary.unpaid_total = unpaid_total
        summary.last_activity_at = last_activity_at
        summaries.append(summary)
    return summaries


@router.get("/partners/{partner_id}/bank-branch", response_model=List[PartnerBankBreakdown])
def partner_bank_breakdown(
    partner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[PartnerBankBreakdown]:
    _require_access(current_user)
    partner = db.get(ExternalPartner, partner_id)
    if not partner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner not found")

    assignments = (
        db.query(Assignment, Bank, Branch)
        .outerjoin(Bank, Assignment.bank_id == Bank.id)
        .outerjoin(Branch, Assignment.branch_id == Branch.id)
        .filter(Assignment.partner_id == partner_id, Assignment.is_deleted.is_(False))
        .all()
    )
    assignment_map: Dict[int, tuple[int | None, int | None, str | None, str | None]] = {}
    counters: Dict[tuple[int | None, int | None], PartnerBankBreakdown] = {}

    for assignment, bank, branch in assignments:
        bank_id = assignment.bank_id
        branch_id = assignment.branch_id
        bank_name = assignment.bank_name or (bank.name if bank else None)
        branch_name = assignment.branch_name or (branch.name if branch else None)
        assignment_map[assignment.id] = (bank_id, branch_id, bank_name, branch_name)
        key = (bank_id, branch_id)
        if key not in counters:
            counters[key] = PartnerBankBreakdown(
                bank_id=bank_id,
                bank_name=bank_name,
                branch_id=branch_id,
                branch_name=branch_name,
                assignment_count=0,
                invoice_total=Decimal("0.00"),
                invoice_paid=Decimal("0.00"),
                invoice_unpaid=Decimal("0.00"),
            )
        counters[key].assignment_count += 1

    invoices = db.query(Invoice).filter(Invoice.partner_id == partner_id).all()
    for invoice in invoices:
        assignment_info = assignment_map.get(invoice.assignment_id)
        if assignment_info:
            bank_id, branch_id, bank_name, branch_name = assignment_info
        else:
            bank_id, branch_id, bank_name, branch_name = None, None, None, None
        key = (bank_id, branch_id)
        if key not in counters:
            counters[key] = PartnerBankBreakdown(
                bank_id=bank_id,
                bank_name=bank_name,
                branch_id=branch_id,
                branch_name=branch_name,
                assignment_count=0,
                invoice_total=Decimal("0.00"),
                invoice_paid=Decimal("0.00"),
                invoice_unpaid=Decimal("0.00"),
            )
        total = Decimal(invoice.total_amount or Decimal("0.00"))
        due = Decimal(invoice.amount_due or Decimal("0.00"))
        counters[key].invoice_total += total
        counters[key].invoice_unpaid += due
        counters[key].invoice_paid += total - due

    return list(counters.values())
