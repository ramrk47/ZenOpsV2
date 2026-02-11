export interface LaunchModeConfig {
  multiTenantEnabled: boolean;
  internalTenantId: string;
  externalTenantId: string;
}

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const loadLaunchModeConfig = (
  env: Record<string, string | undefined> = process.env
): LaunchModeConfig => {
  const internalTenantId = env.ZENOPS_INTERNAL_TENANT_ID ?? env.TENANT_INTERNAL_UUID;
  const externalTenantId = env.ZENOPS_EXTERNAL_TENANT_ID ?? env.TENANT_EXTERNAL_UUID;
  const multiTenantEnabled = parseBoolean(env.ZENOPS_MULTI_TENANT_ENABLED, false);

  if (!internalTenantId) {
    throw new Error('ZENOPS_INTERNAL_TENANT_ID is required');
  }

  if (!externalTenantId) {
    throw new Error('ZENOPS_EXTERNAL_TENANT_ID is required');
  }

  if (internalTenantId === externalTenantId) {
    throw new Error('ZENOPS_INTERNAL_TENANT_ID and ZENOPS_EXTERNAL_TENANT_ID must be different');
  }

  return {
    multiTenantEnabled,
    internalTenantId,
    externalTenantId
  };
};
