export const TERMINOLOGY = {
    plane: {
        tenant: 'Tenant Plane',
        control: 'Control Plane',
        intake: 'Intake Plane',
        runtime: 'Runtime Plane'
    },
    org: {
        tenant: 'Tenant',
        coreTenant: 'Core Tenant',
        externalAssociate: 'External Associate',
        referralChannel: 'Referral Channel'
    },
    repogen: {
        system: 'Repogen',
        workOrder: 'Work Order',
        snapshot: 'Snapshot',
        exportBundle: 'Export Bundle',
        reportPack: 'Report Pack',
        generationJob: 'Generation Job',
        artifact: 'Artifact',
        deliverablesRelease: 'Deliverables Release',
        releaseRecord: 'Release Record'
    },
    evidence: {
        item: 'Evidence Item',
        profile: 'Evidence Profile',
        checklist: 'Evidence Checklist',
        fieldDef: 'Field Definition',
        fieldLink: 'Field-Evidence Link',
        ocrJob: 'OCR Job'
    },
    billing: {
        account: 'Billing Account',
        modePostpaid: 'POSTPAID',
        modeCredit: 'CREDIT',
        creditWallet: 'Credit Wallet',
        creditReservation: 'Credit Reservation',
        creditLedger: 'Credit Ledger',
        serviceInvoice: 'Service Invoice',
        billingGate: 'Billing Gate'
    }
} as const;

export type TerminologyKey = keyof typeof TERMINOLOGY;

/**
 * Returns the canonical label for a given terminology section and key.
 * Example: labelFor('plane', 'control') -> 'Control Plane'
 */
export function labelFor<
    Section extends keyof typeof TERMINOLOGY,
    Key extends keyof typeof TERMINOLOGY[Section]
>(section: Section, key: Key): typeof TERMINOLOGY[Section][Key] {
    return TERMINOLOGY[section][key];
}

/**
 * Helper to replace known deprecated terms in a string with their canonical equivalents.
 * Note: This is an overly broad text replacer and should primarily be used for 
 * massaging external or legacy messages where exact keying isn't possible.
 */
export function deprecatedToCanonical(text: string): string {
    if (!text) return text;

    let result = text;

    // Organizations
    result = result.replace(/Tenant #1/gi, TERMINOLOGY.org.coreTenant);
    result = result.replace(/Factory tenant/gi, TERMINOLOGY.org.coreTenant);
    result = result.replace(/Worker tenant/gi, TERMINOLOGY.org.coreTenant);
    // Note: 'Partner' is context-dependent, either External Associate or Referral Channel. 
    // We cannot automatically replace it securely in a global blind replace without context, 
    // but if needed as a generic fallback, we use External Associate.

    // Surfaces
    result = result.replace(/Template Builder/gi, TERMINOLOGY.plane.control);

    return result;
}
