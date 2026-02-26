/**
 * buildRenderContext — transforms a DB snapshot (fieldValues + evidenceLinks + factoryPayload)
 * into the canonical RenderContext for template hydration.
 *
 * This is the ONLY place where sqft→sqm conversion, FMV computation, co-op rounding,
 * and depreciation % happen. Templates receive fully computed values.
 */

import type {
    RenderContext,
    RenderContextMeta,
    RenderContextParties,
    RenderContextProperty,
    RenderContextConstruction,
    RenderContextRates,
    RenderContextValuation,
    RenderContextAmenity,
    RenderContextDepreciation,
    RenderContextValuer,
    RenderContextFlags,
    RenderContextEvidence,
    RenderContextPhoto,
    RenderContextAnnexure,
    RenderContextGeo,
    RenderContextManual
} from './renderContext.js';

// ──────────────────────────────── Types ───────────────────────────────────────

export interface FieldValueRow {
    sectionKey: string;
    fieldKey: string;
    valueJson: unknown;
}

export interface EvidenceLinkRow {
    sectionKey: string | null;
    fieldKey: string | null;
    sortOrder: number;
    document: {
        id: string;
        originalFilename: string | null;
        contentType: string | null;
    };
}

export interface SnapshotBundle {
    assignmentId: string;
    templateKey: string;
    bankName: string;
    branchName: string;
    reportFamily: string;
    fieldValues: FieldValueRow[];
    evidenceLinks: EvidenceLinkRow[];
    exportHash: string;
    templateHash: string;
    factoryPayload?: Record<string, unknown>;
}

// ──────────────────────────────── Helpers ─────────────────────────────────────

const SQFT_TO_SQM = 0.092903;

function toNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }
    return 0;
}

function toString(v: unknown): string {
    if (typeof v === 'string') return v;
    if (v == null) return '';
    return String(v);
}

function toBoolean(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1' || v.toLowerCase() === 'yes';
    return Boolean(v);
}

function getField(fields: FieldValueRow[], section: string, key: string): unknown {
    const row = fields.find(f => f.sectionKey === section && f.fieldKey === key);
    return row?.valueJson ?? null;
}

function getFlatField(fields: FieldValueRow[], key: string): unknown {
    const row = fields.find(f => (!f.sectionKey || f.sectionKey === '') && f.fieldKey === key);
    return row?.valueJson ?? null;
}

/** Round up to next 500 (co-op rule §3.4) */
function roundUpToNext500(value: number): number {
    return Math.ceil(value / 500) * 500;
}

/** Convert rate to sqm if input is sqft */
function convertToSqm(rate: number | null, unit: 'sqft' | 'sqm'): number | null {
    if (rate == null) return null;
    return unit === 'sqft' ? rate / SQFT_TO_SQM : rate;
}

// ──────────────────────────────── Builder ─────────────────────────────────────

export function buildRenderContext(bundle: SnapshotBundle): RenderContext {
    const { fieldValues: f, evidenceLinks: ev } = bundle;

    const bankLower = bundle.bankName.toLowerCase();
    const isCoop = bankLower.includes('coop') || bankLower.includes('co-op') || bankLower.includes('cooperative');
    const isSbi = bankLower.includes('sbi');
    const isBoi = bankLower.includes('boi') || bankLower.includes('bank of india');

    // ── Meta ──
    const meta: RenderContextMeta = {
        bankName: bundle.bankName,
        branchName: bundle.branchName,
        reportFamily: bundle.reportFamily as RenderContextMeta['reportFamily'],
        slabRule: (toString(getFlatField(f, 'slab_rule')) || 'ALL') as RenderContextMeta['slabRule'],
        loanProduct: toString(getFlatField(f, 'loan_product')),
        refNumber: toString(getFlatField(f, 'ref_number')),
        inspectionDate: toString(getFlatField(f, 'inspection_date')),
        assignmentDate: toString(getFlatField(f, 'assignment_date')),
        reportDate: toString(getFlatField(f, 'report_date')),
        valuerSignatory: toString(getFlatField(f, 'valuer_signatory')),
        exportHash: bundle.exportHash,
        templateHash: bundle.templateHash,
        generatedAt: new Date().toISOString()
    };

    // ── Parties ──
    const parties: RenderContextParties = {
        borrowerName: toString(getField(f, 'parties', 'borrower_name')),
        ownerName: toString(getField(f, 'parties', 'owner_name')),
        ownerNamesFull: toString(getField(f, 'parties', 'owner_names_full')) || toString(getField(f, 'parties', 'owner_name')),
        contactDetails: toString(getField(f, 'parties', 'contact_details')) || undefined
    };

    // ── Property ──
    const property: RenderContextProperty = {
        propertyType: toString(getField(f, 'property', 'property_type')),
        addressFull: toString(getField(f, 'property', 'address_full')),
        villageTown: toString(getField(f, 'property', 'village_town')),
        surveyNumber: toString(getField(f, 'property', 'survey_number')),
        eSwattinNumber: toString(getField(f, 'property', 'e_swattin_number')) || undefined,
        rtcNumber: toString(getField(f, 'property', 'rtc_number')) || undefined,
        plotNumber: toString(getField(f, 'property', 'plot_number')) || undefined,
        khataNumber: toString(getField(f, 'property', 'khata_number')) || undefined,
        nearbyLandmark: toString(getField(f, 'property', 'nearby_landmark')) || undefined,
        accessToProperty: toString(getField(f, 'property', 'access_to_property')) || undefined,
        landUse: toString(getField(f, 'property', 'land_use')) || undefined,
        builtUpAreaSqm: toNumber(getField(f, 'property', 'built_up_area_sqm')),
        carpetAreaSqm: toNumber(getField(f, 'property', 'carpet_area_sqm')) || undefined,
        saleableAreaSqm: toNumber(getField(f, 'property', 'saleable_area_sqm')) || undefined,
        landAreaSqm: toNumber(getField(f, 'property', 'land_area_sqm')),
        adjoiningEast: toString(getField(f, 'property', 'adjoining_east')) || undefined,
        adjoiningWest: toString(getField(f, 'property', 'adjoining_west')) || undefined,
        adjoiningNorth: toString(getField(f, 'property', 'adjoining_north')) || undefined,
        adjoiningSouth: toString(getField(f, 'property', 'adjoining_south')) || undefined
    };

    // ── Construction ──
    const construction: RenderContextConstruction = {
        stage: (toString(getField(f, 'construction', 'stage')) || 'completed') as RenderContextConstruction['stage'],
        completionPct: toNumber(getField(f, 'construction', 'completion_pct')) || undefined,
        numFloors: toNumber(getField(f, 'construction', 'num_floors')) || undefined,
        floorLocation: toString(getField(f, 'construction', 'floor_location')) || undefined,
        numBedrooms: toNumber(getField(f, 'construction', 'num_bedrooms')) || undefined,
        numToilets: toNumber(getField(f, 'construction', 'num_toilets')) || undefined,
        otherRooms: toString(getField(f, 'construction', 'other_rooms')) || undefined,
        ageYears: toString(getField(f, 'construction', 'age_years_display')) || undefined,
        residualLife: toString(getField(f, 'construction', 'residual_life')) || undefined
    };

    // ── Rates (with sqft→sqm conversion §3.2) ──
    const marketUnit = (toString(getField(f, 'rates', 'market_rate_unit')) || 'sqft') as 'sqft' | 'sqm';
    const adoptedUnit = (toString(getField(f, 'rates', 'adopted_rate_unit')) || 'sqft') as 'sqft' | 'sqm';
    const marketRateRaw = toNumber(getField(f, 'rates', 'market_rate_input')) || null;
    const adoptedRateRaw = toNumber(getField(f, 'rates', 'adopted_rate_input')) || null;

    const rates: RenderContextRates = {
        guidelineRateSqm: toNumber(getField(f, 'rates', 'guideline_rate_sqm')) || null,
        guidelineValueTotal: toNumber(getField(f, 'rates', 'guideline_value_total')) || null,
        marketRateInput: marketRateRaw,
        marketRateUnit: marketUnit,
        adoptedRateInput: adoptedRateRaw,
        adoptedRateUnit: adoptedUnit,
        marketRateSqm: convertToSqm(marketRateRaw, marketUnit),
        adoptedRateSqm: convertToSqm(adoptedRateRaw, adoptedUnit)
    };

    // ── Valuation (§3.1 formulas) ──
    const landValue = toNumber(getFlatField(f, 'land_value'));
    const buildingValue = toNumber(getFlatField(f, 'building_value'));
    const fmv = landValue + buildingValue;

    // Parse amenities JSON array [{label, value}]
    const amenitiesRaw = getField(f, 'valuation', 'amenities');
    const amenities: RenderContextAmenity[] | undefined = Array.isArray(amenitiesRaw)
        ? (amenitiesRaw as RenderContextAmenity[])
        : undefined;

    const valuation: RenderContextValuation = {
        landValue,
        buildingValue,
        fmv,
        realizableValue: Math.round(fmv * 0.95),
        distressValue: Math.round(fmv * 0.80),
        guidanceValue: rates.guidelineValueTotal,
        bookValue: rates.guidelineValueTotal,
        valueInWords: toString(getFlatField(f, 'value_in_words')) || undefined,
        amenities
    };

    if (isCoop) {
        const adoptedVal = toNumber(getFlatField(f, 'coop_adopted_value'));
        valuation.coopAdoptedValue = adoptedVal || undefined;
        valuation.coopRoundedTotal = adoptedVal ? roundUpToNext500(adoptedVal) : undefined;
    }

    // ── Depreciation (§3.7) ──
    const ageYears = toNumber(getField(f, 'depreciation', 'age_years'));
    const totalLifeYears = toNumber(getField(f, 'depreciation', 'total_life_years'));
    const depreciation: RenderContextDepreciation = {
        ageYears,
        totalLifeYears,
        depreciationPct: totalLifeYears > 0 ? Math.round((ageYears / totalLifeYears) * 100 * 100) / 100 : 0
    };

    // ── Valuer ──
    const valuer: RenderContextValuer = {
        name: toString(getField(f, 'valuer', 'name')) || meta.valuerSignatory,
        qualifications: toString(getField(f, 'valuer', 'qualifications')),
        rvoNumber: toString(getField(f, 'valuer', 'rvo_number')),
        email: toString(getField(f, 'valuer', 'email')),
        phone: toString(getField(f, 'valuer', 'phone')),
        address: toString(getField(f, 'valuer', 'address')),
        dateOfValuation: meta.reportDate
    };

    // ── Flags ──
    const flags: RenderContextFlags = {
        isSarfaesiCompliant: toBoolean(getField(f, 'flags', 'is_sarfaesi_compliant')),
        isSocialInfra: toBoolean(getField(f, 'flags', 'is_social_infra')),
        isBoundaryMatching: toBoolean(getField(f, 'flags', 'is_boundary_matching')),
        isPlotDemarcated: toBoolean(getField(f, 'flags', 'is_plot_demarcated')),
        isEntirePropertyMortgaged: toBoolean(getField(f, 'flags', 'is_entire_property_mortgaged')),
        justificationRequired: false // computed below
    };
    // Trigger required if >20% variance between market and guideline
    if (rates.guidelineRateSqm && rates.marketRateSqm) {
        const variance = Math.abs(rates.marketRateSqm - rates.guidelineRateSqm) / rates.guidelineRateSqm;
        flags.justificationRequired = variance >= 0.20;
    }

    // ── Evidence (§4, with ordering §4.1) ──
    const photoOrder = ['exterior', 'interior', 'surroundings', 'gps', 'screenshot'] as const;
    const photos: RenderContextPhoto[] = ev
        .filter(link => {
            const ct = link.document.contentType ?? '';
            return ct.startsWith('image/') || (link.sectionKey ?? '').includes('photo') || (link.sectionKey ?? '').includes('image');
        })
        .map(link => ({
            type: inferPhotoType(link.sectionKey ?? link.fieldKey ?? ''),
            filename: link.document.originalFilename ?? link.document.id,
            url: undefined
        }))
        .sort((a, b) => photoOrder.indexOf(a.type) - photoOrder.indexOf(b.type));

    const annexures: RenderContextAnnexure[] = ev
        .filter(link => {
            const ct = link.document.contentType ?? '';
            return ct === 'application/pdf' || ct.includes('document');
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(link => ({
            type: 'other' as const,
            title: link.sectionKey ?? link.fieldKey ?? 'Document',
            filename: link.document.originalFilename ?? link.document.id,
            url: undefined
        }));

    const evidence: RenderContextEvidence = {
        photos,
        annexures,
        guidelineScreenshot: toString(getField(f, 'evidence', 'guideline_screenshot')) || undefined,
        googleMapScreenshot: toString(getField(f, 'evidence', 'google_map_screenshot')) || undefined,
        routeMapScreenshot: toString(getField(f, 'evidence', 'route_map_screenshot')) || undefined
    };

    // ── Geo ──
    const geo: RenderContextGeo = {
        latitude: toNumber(getField(f, 'geo', 'latitude')) || null,
        longitude: toNumber(getField(f, 'geo', 'longitude')) || null,
        source: (toString(getField(f, 'geo', 'source')) || 'manual') as RenderContextGeo['source']
    };

    // ── Manual ──
    const manual: RenderContextManual = {
        justificationMissingApprovedPlan: toString(getField(f, 'manual', 'justification_missing_approved_plan')) || undefined,
        justificationValuationVariance: toString(getField(f, 'manual', 'justification_valuation_variance')) || undefined,
        operatorNotes: toString(getField(f, 'manual', 'operator_notes')) || undefined,
        lastTwoTransactions: toString(getField(f, 'manual', 'last_two_transactions')) || undefined,
        otherRemarks: toString(getField(f, 'manual', 'other_remarks')) || undefined
    };

    return {
        meta,
        parties,
        property,
        construction,
        rates,
        valuation,
        depreciation,
        valuer,
        flags,
        evidence,
        geo,
        manual,
        isCoop,
        isSbi,
        isBoi
    };
}

// ──────────────────────────────── Internals ──────────────────────────────────

function inferPhotoType(sectionKey: string): RenderContextPhoto['type'] {
    const s = sectionKey.toLowerCase();
    if (s.includes('exterior')) return 'exterior';
    if (s.includes('interior')) return 'interior';
    if (s.includes('surround')) return 'surroundings';
    if (s.includes('gps')) return 'gps';
    if (s.includes('screen') || s.includes('map')) return 'screenshot';
    return 'exterior'; // default
}
