# ZenOps V2 — Report Generation Requirements (Valuation / DPR / Stage Progress / TEV)
_Last updated: 2026-02-24 (Asia/Kolkata)_

> This document is a **comprehensive, detailed** requirements log and build specification distilled from the entire chat.
>
> Primary objective: Build an **in-house report generator** inside **ZenOps V2** that can generate bank-specific valuation/DPR/report formats (Word/PDF packs with annexures), while maintaining audit trails and enabling frontend editing.

---

## 0) What we are building (clarity statement)

We are building the **ZenOps V2 Report Generation Framework**, which consists of four integrated components:

1. **Universal Data Model (Forms / Fields)**
   - A single, bank-agnostic dataset per assignment that can produce reports for SBI/BOI/PSU/co-op banks.
2. **Rules Layer**
   - Calculation formulas (FMV/Realizable/Distress/Book), unit conversions, rounding rules, triggers (e.g., “Justification required”).
3. **Template Engine**
   - Bank-wise Word templates that must match exactly (“non-negotiable”).
   - Handles tables, section ordering, clause blocks, loops (photos/tables), conditional blocks, and versioning.
4. **Evidence System**
   - Upload-first workflow with OCR-assisted auto-fill.
   - Evidence links (photos/docs/screenshots) tied to specific report sections/fields.
   - Audit trail: who entered what, when, and what evidence supported it.

**Output goal:** ZenOps generates the **same Word file** you submit to the bank — including annexures and images — as a **single report pack**.

---

## 1) ZenOps V2 concept in simple terms

### 1.1 Assignments (core unit)
- An **assignment** is one job folder (valuation/DPR/stage progress/revaluation).
- All data entry, documents, photos, calculations, generated reports, and audit logs are linked to the assignment.

### 1.2 People / Roles
- Current users: **you + brother**.
- Future: field valuers get mobile access.
- External partner: can commission assignments but should not see data beyond their own.

### 1.3 Documents & Photos
- Documents are uploaded/captured (mobile camera/gallery) and linked to assignments.
- Photos are critical: exterior/interior/surroundings/GPS/screenshots.
- Evidence is appended into the report pack and also stored with audit links.

### 1.4 Billing & Notifications
- Billing/fees tracked per assignment.
- Notifications for missing evidence, QC steps, report ready, etc. (architected for future scale).

### 1.5 Bank Standards / Templates
- Each bank has mandatory formats/fields.
- ZenOps must never “guess”; if uncertain, either:
  - warn and proceed (as per your chosen policy), or
  - require confirmation.

---

## 2) Reality constraints confirmed by you

### 2.1 Report types you actually produce (today)
- **Valuation report**
- **DPR**
- **Revaluation**
- **Stage progress**
- Output format: **Word (.docx)**

### 2.2 Banks you service
- SBI, BOI (Bank of India), and multiple co-operative banks
- All loan products: HL, LAP, PLAP, MSME, NPA, etc.

### 2.3 Template rules by value slab (critical)
- **For any property valued < ₹5 crore:** Must use **SBI “Format A”** style template (non-negotiable) — **for any kind of property**.
- **For SBI > ₹5 crore:** Use the **Bank of India (BOI) / PSU generic format** you provided.
- **For other PSU/other banks above 5 crore:** Use the same BOI/PSU generic format.
- **Agricultural land valuation format:** same for all banks (later treated as part of unified logic; template still required).

### 2.4 Cover letter + valuation table pages
- For SBI and any PSU bank format, **Page 1 & 2** (cover letter + valuation summary table) remain **constant** (brief idea pages).

### 2.5 Co-operative banks format
- Co-op banks have a **different** format from PSU/SBI.
- You uploaded a co-op sample; you also clarified:
  - **No format changes** between co-op banks — **only bank name changes**.
  - Co-op banks **do not need** the PSU-style cover summary value table.

### 2.6 Manual vs automated fields
- Document checklist table: **manual tick marks by hand**.
- Enclosures list/checklist: **filled manually**.
- “Justification required” when variance exists: ZenOps should **show the flag**, but you will fill text manually (no blocking).

### 2.7 Depreciation display
- No depreciation tables in reports.
- Only show **depreciation percentage**.
- Depreciation formula: **(Age of building / Total life) × 100**.

---

## 3) Core valuation formulas and business rules

### 3.1 Mandatory value outputs (PSU/SBI family)
- **FMV** = Land value + Building value
- **Realisable value** = 95% of FMV
- **Distress value** = 80% of FMV
- **Guideline value** is always calculated per property (input/evidence driven)
- **Book value = Guideline value** (same)

### 3.2 Unit & conversion rules (important)
- Guideline rate must be in **sqm**.
- User may input market/adopted rates in **sqft**.
- The report must show/print **sqm** rates (ZenOps must convert for reporting).

### 3.3 Co-op adopted vs market rate logic
You clarified your “reverse” approach:
- You “consider” an adopted rate (e.g., 800/sqft).
- **Adopted rate** is that considered rate.
- **Market rate shown** is higher (example: 1000/sqft) such that:
  - adopted = 80% of market
  - market = adopted / 0.80
- You always reduce from market rate, but print market higher than adopted.

### 3.4 Rounding rule (co-op totals)
- Round **up to next 500**:
  - 400 → 500
  - 600 → 1000
  - etc.

### 3.5 Justification trigger
- Existing SBI/format content mentions 20%+ variance rule. Your decision:
  - Keep system behavior simple: show **“Justification required”** as a flag.
  - You may change manually if necessary.

---

## 4) Evidence requirements & annexures

### 4.1 Photos required (your practice)
- Interior images (to show interior expenditure/quality)
- Exterior images (cover entire property facing road)
- Surroundings images
- GPS photos (preferably via GPS Map Camera app)
- Google map screenshot
- Route map screenshot: route from bank branch to property

**Image order in report annexures**
1. Exterior
2. Interior
3. Surroundings
4. GPS
5. Screenshots

### 4.2 Documents required (importance order you provided)
1. “Uttar” (meaning: ownership extract / RTC / equivalent; exact document varies by state)
2. Building permission drawing and letter
3. Building completion certificate
4. NA order
5. Layout plan
6. Sale deed

### 4.3 Annexure pages & formatting
- Annexure sections are fixed headers such as:
  - SITE IMAGES
  - GUIDELINE VALUE
  - GOOGLE MAP
- Layout:
  - **Minimum 2, maximum 4 images per page**
  - Based on image sizes/aspect ratio
- Captions:
  - No per-image captions required
  - Only headings at the start of pages

---

## 5) Upload-first workflow + OCR design (your chosen approach)

You proposed: upload everything first, then OCR auto-fills as much as possible.

### 5.1 Step-by-step user flow

#### Screen 1 — Upload Hub
User uploads:
- title/docs
- guideline screenshot
- GPS map camera photos
- site photos
- google map + route screenshot

#### Screen 2 — Detected checklist
ZenOps auto-detects document types and shows a checklist:
- sale deed, uttar/RTC, NA order, layout plan, plan approval letter, completion certificate, etc.
- checklist is reorderable by importance
- user confirms/reorders

#### Screen 3 — Auto-filled draft review
ZenOps fills what it can, and user confirms/edits:
- lat/long (OCR from GPS photo overlay)
- inspection date (from GPS photo date)
- assignment date defaults to inspection date
- guideline value/rate (OCR from screenshot)
- warnings for missing items

#### Screen 4 — Remaining manual inputs
User enters:
- adopted/market rates (input unit allowed)
- manual land value & building value (your preference: manual)
- building age/total life (for depreciation %)
- optional narrative / justifications

#### Screen 5 — Generate report pack
- Generate **single DOCX** with:
  - cover pages
  - body template
  - annexures with images

### 5.2 OCR auto-fill scope and rules

#### 5.2.1 GPS overlay OCR
- OCR reads lat/long (overlay text in photo pixels)
- OCR fills `geo.lat` and `geo.long`
- If user edits, use user values
- Validation only:
  - lat in [-90, +90]
  - long in [-180, +180]
  - if outside, warn but allow proceed

#### 5.2.2 Guideline OCR
- OCR tries to extract:
  - guideline rate (sqm)
  - guideline value total
- Evidence stored: screenshot file
- If missing or OCR fails:
  - warn only
  - allow proceed; guideline/book values print “NA”

### 5.3 Warning policy (your decisions)
1. Guideline missing:
   - warn: “Proceed without guideline value calculations?”
   - if proceed: print “NA” for guideline/book values
2. Low OCR confidence:
   - warn only
3. User override of OCR:
   - proceed with typed values (with range warnings)

---

## 6) Template system architecture (how ZenOps generates exact Word formats)

### 6.1 Template families confirmed
1. `SBI_UNDER_5CR_V1`
   - Used for ANY property type valued < ₹5Cr (non-negotiable)
2. `PSU_GENERIC_OVER_5CR_V1` (BOI/PSU generic)
   - Used for:
     - SBI > ₹5Cr
     - BOI
     - All other PSU/other banks (non-coop)
3. `COOP_LB_V1`
   - Co-op banks, only bank name changes
4. `ANNEXURES_V1`
   - SITE IMAGES / GUIDELINE VALUE / GOOGLE MAP (same for SBI, PSU, co-op)

### 6.2 “Cover pages” reuse rule
- Cover letter + valuation summary table (pages 1–2) are constant across SBI/PSU.
- Co-op banks do not require PSU-style cover summary.

### 6.3 Manual-only sections inside templates
- Document checklist table prints but stays unticked (manual)
- Enclosures list prints but stays manual

---

## 7) Data model (universal schema)

### 7.1 Assignment meta
- assignment_id
- report_family: valuation / revaluation / stage_progress / dpr / agri_valuation
- bank_name, branch_name
- loan_product
- inspection_date, assignment_date, report_date
- valuer_signatory

### 7.2 Parties
- borrower_name
- owner_name
- contact details (optional)

### 7.3 Property core
- property_type
- address
- village/town label
- survey/khata identifiers (optional)

### 7.4 Rates
- guideline_rate_sqm
- guideline_value_total
- market_rate_input + unit
- adopted_rate_input + unit
- computed conversions to sqm

### 7.5 Values
- land_value (manual)
- building_value (manual)
- fmv (computed)
- realizable (computed)
- distress (computed)
- book_value = guideline_value_total (computed)
- value_in_words (computed/manual)

### 7.6 Building depreciation
- age_years
- total_life_years
- depreciation_pct (computed)

### 7.7 Geo
- gps photos
- lat/long (OCR prefills, user final)
- fallback: village/town centre if GPS unavailable

### 7.8 Evidence attachments
- photos grouped:
  - exterior, interior, surroundings, GPS, screenshots
- guideline screenshot
- google map screenshot
- route screenshot (bank → property)

---

## 8) Audit trail and versioning (as agreed)

### 8.1 Everything editable, but with safe governance
- Everything editable in UI
- Every change logged (old/new/user/time)
- Generated reports are versioned; never overwritten.

### 8.2 “Reason required” edits (recommended)
For audit defensibility, edits to these should request a reason:
- guideline/book value number
- land/building/FMV values
- lat/long

---

## 9) Time-to-fill estimates (based on chosen workflow)

### 9.1 With upload-first + OCR + manual values
- Typical valuation: **10–20 minutes**
- Plot/vacant land: **6–12 minutes**
- Constructed property: **12–25 minutes**
- Worst-case messy file: **20–35 minutes**

Drivers:
- Uploading photos
- Sorting photos
- Hunting guideline evidence (mitigated by warn + NA allowed)

---

## 10) Open items / future phases (not fully specified yet)

Requires additional samples/inputs:
- DPR template (Word)
- Stage progress report template (Word)
- TEV report template (Word)
- Agri land special fields (if any beyond standard valuation)

---

## 11) Implementation roadmap (recommended)

### Phase A — MVP (Valuation automation)
- Templates: SBI<5Cr, PSU generic, co-op, annexures
- Upload-first OCR: lat/long, GPS date, guideline screenshot
- One-click DOCX report pack generation
- Versioning and audit trail

### Phase B — Report Builder UI
- Preview/edit/regenerate
- Clause library toggles (future)

### Phase C — DPR / Stage / TEV automation
- After templates and sample docs provided

---

## 12) Non-negotiables (must not break)
1. SBI < 5Cr must output exact Format A style.
2. SBI > 5Cr uses BOI/PSU generic format.
3. PSU cover pages constant for SBI/PSU.
4. Co-op format fixed; only bank name changes.
5. Annexure images auto-arranged 2–4 per page; headings only; correct order.
6. Guideline missing warn-only; print NA if proceed.
7. GPS overlay OCR prefills; user override allowed; range warnings only.
8. Manual tick/checklist sections remain manual.
9. Generate outputs single DOCX pack with annexures.
10. Everything editable but versioned outputs + audit logs exist.

---

## 13) Operator instructions (how it should be used)
1. Create assignment → choose bank/report family.
2. Upload docs/photos/screenshots.
3. Review auto-filled lat/long, dates, guideline.
4. Enter remaining: adopted/market rate, land value, building value, age/life.
5. Generate report pack DOCX (v1).
6. If changes needed, edit and regenerate (v2, v3…).

---

_End of document._
