/**
 * Pack Recipe — defines which DOCX parts make up a template family's output pack.
 *
 * The recipe is resolved from `manifest.json` in each template directory.
 */

export interface PackPart {
    name: 'cover' | 'letter' | 'report' | 'images';
    required: boolean;
    templateFile: string;
}

export interface PackRecipe {
    familyKey: string;
    bankFamily: string;
    reportType: string;
    slabRule: string;
    parts: PackPart[];
}

export interface ManifestJson {
    bank_family: string;
    report_type: string;
    slab_rule: string;
    pack_parts: string[];
    notes?: string;
}

/**
 * Maps a templateKey (e.g. 'SBI_UNDER_5CR_V1') to a family directory key (e.g. 'sbi_lb_lt5cr').
 */
export const TEMPLATE_KEY_TO_FAMILY: Record<string, string> = {
    'SBI_UNDER_5CR_V1': 'sbi_lb_lt5cr',
    'SBI_AGRI_LAND_V1': 'sbi_agri_land',
    'PSU_GENERIC_OVER_5CR_V1': 'boi_lb_gt5cr',
    'COOP_LB_V1': 'coop_lb',
    'COOP_PLOT_V1': 'coop_plot'
};

/**
 * Resolves a manifest.json into a PackRecipe.
 */
export function resolveRecipe(familyKey: string, manifest: ManifestJson): PackRecipe {
    const parts: PackPart[] = manifest.pack_parts.map(partName => ({
        name: partName as PackPart['name'],
        required: partName === 'report',
        templateFile: `${partName}.docx`
    }));

    return {
        familyKey,
        bankFamily: manifest.bank_family,
        reportType: manifest.report_type,
        slabRule: manifest.slab_rule,
        parts
    };
}
