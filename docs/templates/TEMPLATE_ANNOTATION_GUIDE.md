# Template Annotation Guide

> **Convention:** ZenOps uses `docxtemplater` with **single-brace** delimiters: `{tag}` (NOT `{{tag}}`).

---

## 1. Placeholder types

### Scalar
Replace a single value:
```
{meta.bankName}
{parties.borrowerName}
{valuation.fmv}
{valuer.rvoNumber}
```

### Loop
Iterate over a list. The enclosing run must be on its own paragraph or table row:
```
{#evidence.photos}
  {type} — {filename}
{/evidence.photos}

{#evidence.annexures}
  {title}
{/evidence.annexures}

{#valuation.amenities}
  {label}   {value}
{/valuation.amenities}
```

### Conditional
Show/hide a block based on a boolean flag:
```
{#flags.isSarfaesiCompliant}Yes{/flags.isSarfaesiCompliant}
{#flags.justificationRequired}Justification Required (operator to fill){/flags.justificationRequired}
{#isCoop}Co-operative Bank Format{/isCoop}
```

---

## 2. Canonical placeholder names

Derived from `packages/common/src/repogen/renderContext.ts`. These are the **only** approved names.

| Category | Placeholders |
|---|---|
| **Meta** | `meta.bankName`, `meta.branchName`, `meta.reportDate`, `meta.inspectionDate`, `meta.refNumber`, `meta.loanProduct`, `meta.valuerSignatory` |
| **Parties** | `parties.borrowerName`, `parties.ownerName`, `parties.ownerNamesFull` |
| **Property** | `property.propertyType`, `property.addressFull`, `property.villageTown`, `property.surveyNumber`, `property.eSwattinNumber`, `property.rtcNumber`, `property.plotNumber`, `property.landAreaSqm`, `property.builtUpAreaSqm`, `property.carpetAreaSqm`, `property.nearbyLandmark`, `property.accessToProperty`, `property.adjoiningEast/West/North/South` |
| **Construction** | `construction.stage`, `construction.numFloors`, `construction.floorLocation`, `construction.numBedrooms`, `construction.numToilets`, `construction.otherRooms`, `construction.ageYears` |
| **Rates** | `rates.guidelineRateSqm`, `rates.guidelineValueTotal`, `rates.marketRateSqm`, `rates.adoptedRateSqm` |
| **Valuation** | `valuation.fmv`, `valuation.realizableValue`, `valuation.distressValue`, `valuation.guidanceValue`, `valuation.bookValue`, `valuation.valueInWords`, `valuation.landValue`, `valuation.buildingValue` |
| **Depreciation** | `depreciation.depreciationPct`, `depreciation.ageYears` |
| **Valuer** | `valuer.name`, `valuer.qualifications`, `valuer.rvoNumber`, `valuer.email`, `valuer.phone`, `valuer.address`, `valuer.dateOfValuation` |
| **Flags** | `flags.isSarfaesiCompliant`, `flags.isSocialInfra`, `flags.justificationRequired`, `flags.isBoundaryMatching`, `flags.isPlotDemarcated` |
| **Evidence** | `evidence.photos` (loop), `evidence.annexures` (loop), `evidence.guidelineScreenshot` |
| **Geo** | `geo.latitude`, `geo.longitude` |
| **Manual** | `manual.justificationValuationVariance`, `manual.operatorNotes`, `manual.lastTwoTransactions`, `manual.otherRemarks` |
| **Conditionals** | `isCoop`, `isSbi`, `isBoi` |

---

## 3. Manual fields policy

Fields with the `manual.*` prefix and a small explicit list are **allowed to render empty** without failing the coverage gate. These are fields the operator fills by hand:

- `manual.justificationValuationVariance` — Long paragraph explaining rate vs guideline variance
- `manual.operatorNotes` — Any additional operator remarks
- `manual.lastTwoTransactions` — "Not available" for most cases
- `construction.ageYears` — Display string (e.g. "Less than 1 Year")

**All other tags that render empty in an annotated template = coverage gate failure.**

---

## 4. How to annotate a DOCX

### Recommended: Use the annotator script

```bash
python3 scripts/annotate_docx.py \
  --input docs/templates/samples/<family>/report.docx \
  --mapping scripts/<family>_mapping.json \
  --output docs/templates/samples/<family>/report.docx
```

The mapping JSON is `{ "Real Value": "{placeholder.key}" }`. Order matters: put longer/more specific strings first.

### Manual annotation in Word

If the annotator misses a field (common in formatted tables):
1. Open the `.docx` in Word
2. Find the real value (e.g. `Rs. 46,81,000`)
3. Select it, type `{valuation.fmv}` directly — do not paste
4. **Retype the tag if Word splits it** — press `F5 → Find` to verify `{valuation.fmv}` appears as one contiguous run

> [!CAUTION]
> Never use autocorrect or smart quotes. Word sometimes replaces `{` with a special character. Type the tag manually.

---

## 5. Rules

1. **Never put a tag inside a Word field code** (e.g. `TOC`, `HYPERLINK` field) — use a plain paragraph instead.
2. **Never split a tag across Word runs.** If Word auto-formats and breaks `{valuer` and `.name}` into separate runs, retype the whole tag as a single text selection.
3. **Headers/footers work** in docxtemplater — test after rendering.
4. **Mark as annotated:** After annotating all target parts, add `"is_annotated": true` and `"annotated_parts": ["report"]` to `manifest.json`.
5. **Run coverage check** after annotation: `pnpm exec tsx scripts/template-coverage.ts`

---

## 6. Coverage gate behaviour

| Template | `is_annotated` | Behavior |
|---|---|---|
| Any | `false` (default) | Report-only, no failure |
| Annotated | `true` | ❌ Fails CI if tags not in RenderContext (except `manual.*` allowlist) |

Run the gate: `pnpm exec tsx scripts/template-coverage.ts`
