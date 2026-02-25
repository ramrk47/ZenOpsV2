/**
 * RenderContext — single source of truth for all DOCX template hydration.
 *
 * Every key here maps to a potential {{placeholder}} in the bank templates.
 * Grouped to match ZENOPS_REPORT_GENERATION_REQUIREMENTS.md §7.
 */

// ──────────────────────────────────── Meta ────────────────────────────────────

export interface RenderContextMeta {
    bankName: string;
    branchName: string;
    reportFamily: 'valuation' | 'revaluation' | 'stage_progress' | 'dpr' | 'agri_valuation';
    slabRule: 'LT_5CR' | 'GT_5CR' | 'ALL';
    loanProduct: string;
    inspectionDate: string;
    assignmentDate: string;
    reportDate: string;
    valuerSignatory: string;
    exportHash: string;
    templateHash: string;
    generatedAt: string;
}

// ──────────────────────────────────── Parties ─────────────────────────────────

export interface RenderContextParties {
    borrowerName: string;
    ownerName: string;
    contactDetails?: string;
}

// ──────────────────────────────────── Property ────────────────────────────────

export interface RenderContextProperty {
    propertyType: string;
    addressFull: string;
    villageTown: string;
    surveyNumber: string;
    khataNumber?: string;
    builtUpAreaSqm: number;
    landAreaSqm: number;
}

// ──────────────────────────────────── Rates ───────────────────────────────────

export interface RenderContextRates {
    guidelineRateSqm: number | null;
    guidelineValueTotal: number | null;
    marketRateInput: number | null;
    marketRateUnit: 'sqft' | 'sqm';
    adoptedRateInput: number | null;
    adoptedRateUnit: 'sqft' | 'sqm';
    marketRateSqm: number | null;   // computed conversion
    adoptedRateSqm: number | null;  // computed conversion
}

// ──────────────────────────────────── Valuation ──────────────────────────────

export interface RenderContextValuation {
    landValue: number;
    buildingValue: number;
    fmv: number;                    // land + building
    realizableValue: number;        // 95% of FMV
    distressValue: number;          // 80% of FMV
    guidanceValue: number | null;
    bookValue: number | null;       // = guidanceValue
    coopAdoptedValue?: number;
    coopRoundedTotal?: number;      // rounded up to next 500
    valueInWords?: string;
}

// ──────────────────────────────────── Depreciation ───────────────────────────

export interface RenderContextDepreciation {
    ageYears: number;
    totalLifeYears: number;
    depreciationPct: number;        // (age / totalLife) * 100
}

// ──────────────────────────────────── Evidence ────────────────────────────────

export interface RenderContextPhoto {
    type: 'exterior' | 'interior' | 'surroundings' | 'gps' | 'screenshot';
    filename: string;
    url?: string;
}

export interface RenderContextAnnexure {
    type: 'uttar_rtc' | 'permission_drawing' | 'completion_cert' | 'na_order' | 'layout_plan' | 'sale_deed' | 'other';
    title: string;
    filename: string;
    url?: string;
}

export interface RenderContextEvidence {
    photos: RenderContextPhoto[];
    annexures: RenderContextAnnexure[];
    guidelineScreenshot?: string;
    googleMapScreenshot?: string;
    routeMapScreenshot?: string;
}

// ──────────────────────────────────── Geo ─────────────────────────────────────

export interface RenderContextGeo {
    latitude: number | null;
    longitude: number | null;
    source: 'gps_ocr' | 'manual' | 'village_centre';
}

// ──────────────────────────────────── Manual ─────────────────────────────────

export interface RenderContextManual {
    justificationMissingApprovedPlan?: string;
    justificationValuationVariance?: string;
    operatorNotes?: string;
}

// ──────────────────────────────────── Root ────────────────────────────────────

export interface RenderContext {
    meta: RenderContextMeta;
    parties: RenderContextParties;
    property: RenderContextProperty;
    rates: RenderContextRates;
    valuation: RenderContextValuation;
    depreciation: RenderContextDepreciation;
    evidence: RenderContextEvidence;
    geo: RenderContextGeo;
    manual: RenderContextManual;

    // Flattened conditionals for docxtemplater {#if ...}
    isCoop: boolean;
    isSbi: boolean;
    isBoi: boolean;
}
