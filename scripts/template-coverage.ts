import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Template Coverage Script — M5.7.3+
 *
 * For UNANNOTATED templates: report-only, no failure.
 * For ANNOTATED templates (manifest.is_annotated=true):
 *   - FAIL if any {tags} are not in the canonical RenderContext
 *   - FAIL if any {tags} are not in the MANUAL_ALLOWLIST_PREFIXES
 *     AND would be unresolved at render time
 *
 * Tag convention: single braces {tag} (docxtemplater default).
 *
 * Usage: pnpm exec tsx scripts/template-coverage.ts
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PizZip = require('pizzip');

const SAMPLES_DIR = join(__dirname, '..', 'docs', 'templates', 'samples');
const OUTPUT_REPORT = join(__dirname, '..', 'docs', 'templates', 'TEMPLATE_COVERAGE_REPORT.md');

// ─────────────────── Canonical context key registry ──────────────────────────
// Flat dot-notation paths that exist in RenderContext
const CANONICAL_KEYS = new Set([
    'meta.bankName', 'meta.branchName', 'meta.reportFamily', 'meta.slabRule',
    'meta.loanProduct', 'meta.refNumber', 'meta.inspectionDate', 'meta.assignmentDate',
    'meta.reportDate', 'meta.valuerSignatory', 'meta.exportHash', 'meta.templateHash', 'meta.generatedAt',

    'parties.borrowerName', 'parties.ownerName', 'parties.ownerNamesFull', 'parties.contactDetails',

    'property.propertyType', 'property.addressFull', 'property.villageTown',
    'property.surveyNumber', 'property.eSwattinNumber', 'property.rtcNumber', 'property.plotNumber',
    'property.khataNumber', 'property.nearbyLandmark', 'property.accessToProperty', 'property.landUse',
    'property.builtUpAreaSqm', 'property.carpetAreaSqm', 'property.saleableAreaSqm', 'property.landAreaSqm',
    'property.adjoiningEast', 'property.adjoiningWest', 'property.adjoiningNorth', 'property.adjoiningSouth',

    'construction.stage', 'construction.completionPct', 'construction.numFloors', 'construction.floorLocation',
    'construction.numBedrooms', 'construction.numToilets', 'construction.otherRooms',
    'construction.ageYears', 'construction.residualLife',

    'rates.guidelineRateSqm', 'rates.guidelineValueTotal',
    'rates.marketRateInput', 'rates.marketRateUnit', 'rates.adoptedRateInput', 'rates.adoptedRateUnit',
    'rates.marketRateSqm', 'rates.adoptedRateSqm',

    'valuation.landValue', 'valuation.buildingValue', 'valuation.fmv',
    'valuation.realizableValue', 'valuation.distressValue',
    'valuation.guidanceValue', 'valuation.bookValue',
    'valuation.coopAdoptedValue', 'valuation.coopRoundedTotal', 'valuation.valueInWords',
    // Amenity sub-fields (allow dynamic names like valuation.amenity_compound)
    'valuation.amenities',

    'depreciation.ageYears', 'depreciation.totalLifeYears', 'depreciation.depreciationPct',

    'valuer.name', 'valuer.qualifications', 'valuer.rvoNumber',
    'valuer.email', 'valuer.phone', 'valuer.address', 'valuer.dateOfValuation',

    'flags.isSarfaesiCompliant', 'flags.isSocialInfra', 'flags.isBoundaryMatching',
    'flags.isPlotDemarcated', 'flags.isEntirePropertyMortgaged', 'flags.justificationRequired',

    'evidence.photos', 'evidence.annexures',
    'evidence.guidelineScreenshot', 'evidence.googleMapScreenshot', 'evidence.routeMapScreenshot',

    'geo.latitude', 'geo.longitude', 'geo.source',

    'manual.justificationMissingApprovedPlan', 'manual.justificationValuationVariance',
    'manual.operatorNotes', 'manual.lastTwoTransactions', 'manual.otherRemarks',

    'isCoop', 'isSbi', 'isBoi'
]);

/**
 * Fields that are explicitly allowed to be unresolved in output.
 * Only prefixes/exact keys that operators fill manually.
 */
const MANUAL_ALLOWLIST_PREFIXES = ['manual.'];
const MANUAL_ALLOWLIST_EXACT = new Set([
    'construction.ageYears',
    'construction.residualLife',
    'construction.completionPct',
    'manual.justificationMissingApprovedPlan',
    'manual.justificationValuationVariance',
    'manual.operatorNotes',
    'manual.lastTwoTransactions',
    'manual.otherRemarks'
]);

function isManualAllowed(tag: string): boolean {
    if (MANUAL_ALLOWLIST_EXACT.has(tag)) return true;
    return MANUAL_ALLOWLIST_PREFIXES.some(p => tag.startsWith(p));
}

// ─────────────────── DOCX scanner ────────────────────────────────────────────

function collectDocxFiles(dir: string, onlyParts?: string[]): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            results.push(...collectDocxFiles(full, onlyParts));
        } else if (entry.endsWith('.docx') && !entry.startsWith('~') && !entry.includes('.original.')) {
            if (!onlyParts || onlyParts.some(p => entry.startsWith(p.replace('.docx', '')))) {
                results.push(full);
            }
        }
    }
    return results;
}

// Single-brace tag regex: {tag.path}, {#loop}, {/loop}
const TAG_RE = /\{([#/]?[a-zA-Z_][a-zA-Z0-9_.]*)\}/g;

function extractTags(filePath: string): string[] {
    const raw = readFileSync(filePath, 'binary');
    let zip: any;
    try {
        zip = new PizZip(raw);
    } catch {
        return [];
    }
    const tags = new Set<string>();
    for (const [name, entry] of Object.entries(zip.files) as [string, any][]) {
        if (!name.endsWith('.xml')) continue;
        try {
            const text: string = entry.asText();
            let m: RegExpExecArray | null;
            TAG_RE.lastIndex = 0;
            while ((m = TAG_RE.exec(text)) !== null) {
                const raw_tag = m[1].replace(/^[#/]/, ''); // strip loop markers
                tags.add(raw_tag);
            }
        } catch { /* skip binary */ }
    }
    return Array.from(tags).sort();
}

// ─────────────────── Main ────────────────────────────────────────────────────

interface FamilyResult {
    familyKey: string;
    isAnnotated: boolean;
    annotatedParts: string[];
    files: { path: string; tags: string[]; missingInContext: string[]; unknownAllowed: string[] }[];
    hasFatalErrors: boolean;
}

function run(): void {
    const familyDirs = readdirSync(SAMPLES_DIR).filter(e =>
        statSync(join(SAMPLES_DIR, e)).isDirectory()
    );

    let md = '# M5.7 Template Coverage Report\n\n';
    md += `> Generated by \`scripts/template-coverage.ts\` on ${new Date().toISOString()}\n`;
    md += '> Tag convention: single braces `{tag}` (docxtemplater default)\n\n';

    let globalFatal = false;
    const results: FamilyResult[] = [];

    for (const familyKey of familyDirs) {
        const familyDir = join(SAMPLES_DIR, familyKey);
        let manifest: any = {};
        try {
            manifest = JSON.parse(readFileSync(join(familyDir, 'manifest.json'), 'utf8'));
        } catch { /* no manifest */ }

        const isAnnotated: boolean = manifest.is_annotated === true;
        const annotatedParts: string[] = manifest.annotated_parts ?? [];
        const allDocx = collectDocxFiles(familyDir);

        const result: FamilyResult = { familyKey, isAnnotated, annotatedParts, files: [], hasFatalErrors: false };

        for (const docxPath of allDocx) {
            const rel = relative(SAMPLES_DIR, docxPath);
            const partName = rel.split('/').pop()?.replace('.docx', '') ?? '';
            const isPartAnnotated = isAnnotated && (annotatedParts.length === 0 || annotatedParts.includes(partName));

            const tags = extractTags(docxPath);
            const missingInContext = tags.filter(t => {
                // Allow dynamic valuation.amenity_* keys
                if (t.startsWith('valuation.amenity_')) return false;
                return !CANONICAL_KEYS.has(t);
            });
            const unknownAllowed = missingInContext.filter(isManualAllowed);
            const unknownFatal = missingInContext.filter(t => !isManualAllowed(t));

            if (isPartAnnotated && unknownFatal.length > 0) {
                result.hasFatalErrors = true;
                globalFatal = true;
            }

            result.files.push({ path: rel, tags, missingInContext, unknownAllowed });
        }
        results.push(result);
    }

    // Write report
    for (const r of results) {
        const badge = r.isAnnotated ? '🔒 ANNOTATED' : '📄 raw';
        md += `## ${r.familyKey} [${badge}]\n\n`;

        for (const f of r.files) {
            md += `### \`${f.path}\`\n`;
            if (f.tags.length === 0) {
                md += '_No `{tags}` found — unannotated or real-data file._\n\n';
                continue;
            }
            md += `**Tags found:** ${f.tags.length}\n\n`;
            md += '```\n' + f.tags.join('\n') + '\n```\n\n';

            const unknownFatal = f.missingInContext.filter(t => !isManualAllowed(t));
            if (unknownFatal.length > 0) {
                md += `**❌ MISSING from RenderContext (${unknownFatal.length}):**\n`;
                unknownFatal.forEach(t => { md += `- \`${t}\`\n`; });
                md += '\n';
            } else if (f.tags.length > 0) {
                md += '**✅ All tags covered by RenderContext.**\n\n';
            }
            if (f.unknownAllowed.length > 0) {
                md += `**⚠️ Manual-allowed (${f.unknownAllowed.length}):** ${f.unknownAllowed.map(t => `\`${t}\``).join(', ')}\n\n`;
            }
        }
        if (r.hasFatalErrors) {
            md += '> **❌ COVERAGE GATE: FAILED** — Fix missing context keys before render.\n\n';
        }
        md += '---\n\n';
    }

    const unusedKeys = Array.from(CANONICAL_KEYS).filter(k => {
        return !results.some(r => r.files.some(f => f.tags.includes(k)));
    });
    md += `## Unused RenderContext Keys (${unusedKeys.length})\n`;
    unusedKeys.forEach(k => { md += `- \`${k}\`\n`; });

    writeFileSync(OUTPUT_REPORT, md, 'utf8');
    console.log(`✅ Coverage report → ${relative(process.cwd(), OUTPUT_REPORT)}`);

    if (globalFatal) {
        console.error('❌ COVERAGE GATE FAILED: annotated template(s) have tags not in RenderContext.');
        process.exit(1);
    }
    console.log('✅ Coverage gate passed.');
}

run();
