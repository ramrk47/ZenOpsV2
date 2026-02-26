# Repogen Operator SOP

## Overview
This Standard Operating Procedure (SOP) guides operators through the end-to-end Repogen report generation and delivery pipeline.

---

## Prerequisites
- Assignment must have all required field values populated.
- Evidence photos must be uploaded and (ideally) tagged with correct sections.
- A valid template must exist for the assignment's `template_key`.

---

## Step-by-Step Process

### 1. Trigger Generation
- Navigate to the **Workspace → Assignments** queue.
- Select the target assignment and open it.
- Click **"Generate Report"** in the Repogen panel.
- The system will queue a generation job. Monitor status via the Job badge.

### 2. View Draft
Once the job completes:
- A **"View Draft"** button will appear in the sidebar/panel.
- Click **"View Draft (PDF)"** to preview in-browser (if PDF conversion was enabled).
- Click **"View Draft (DOCX)"** to download the raw Word document for manual review.
- If the PDF badge shows **"PDF Skipped"** or **"PDF Failed"**, review using the DOCX only.

### 3. Make Final
After reviewing the draft:
- Click **"Make Final"** to finalize the pack.
- Confirm the action in the dialog.
- The pack status transitions from `DRAFT` → `FINAL`.

### 4. Download Final ZIP
Once finalized:
- Click **"Download Pack (Final)"** to download the ZIP archive.
- The ZIP contains: DOCX files, PDF files (if generated), and `meta.json`.

### 5. Deliver
- Attach the final ZIP to the client communication channel.
- Mark the assignment as **"Delivered"** in the workspace.
- The system enforces: a finalized pack with artifacts must exist before delivery is allowed.

---

## Troubleshooting

### PDF Conversion Skipped
- **Cause**: LibreOffice (`soffice`) is not installed on the worker machine.
- **Action**: Deliver the DOCX only. Install `soffice` for future runs.
- **Badge**: Shows "PDF Skipped" in the sidebar.

### PDF Conversion Failed
- **Cause**: LibreOffice crashed or timed out (90s limit).
- **Action**: Retry generation. If persistent, deliver with DOCX only.
- **Badge**: Shows "PDF Failed" in the sidebar.

### Image Classifier Disabled
- **Cause**: The `enable_image_classifier` feature flag is off for this tenant.
- **Action**: Photos will not be auto-embedded. Embed manually in the DOCX if needed.

### Cannot Mark as Delivered
- **Cause**: No finalized pack with artifacts exists.
- **Action**: Ensure you have clicked "Make Final" on the latest pack before attempting delivery.

---

## Feature Flags
The following flags control pipeline behavior per tenant (set in `repogen_features_json`):

| Flag | Controls |
|---|---|
| `enable_repogen` | Allows generation to be triggered |
| `enable_review_gap` | Allows pack finalization |
| `enable_pdf_conversion` | Enables DOCX → PDF via LibreOffice |
| `enable_image_classifier` | Enables Python-based photo classification + embedding |

All flags default to `false`. Enable per-tenant as rollout progresses.
