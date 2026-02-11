import { Prisma, PrismaClient } from '@prisma/client';
import { roleForAudience } from '@zenops/rls';

export type TxClient = Prisma.TransactionClient;

export interface RequestDbContext {
  tenantId: string | null;
  userId: string | null;
  aud: 'web' | 'studio' | 'portal' | 'worker' | 'service';
}

export const createPrismaClient = (url: string): PrismaClient => {
  return new PrismaClient({
    datasourceUrl: url,
    log: ['error', 'warn']
  });
};

const normalizeConfigValue = (value: string | null | undefined): string => value ?? '';

export const setRlsContext = async (tx: TxClient, context: RequestDbContext): Promise<void> => {
  const role = roleForAudience(context.aud);
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${normalizeConfigValue(context.tenantId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.user_id', ${normalizeConfigValue(context.userId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.aud', ${context.aud}, true)`;
};

export const withTxContext = async <T>(
  prisma: PrismaClient,
  context: RequestDbContext,
  fn: (tx: TxClient) => Promise<T>
): Promise<T> => {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, context);
    return fn(tx);
  });
};

export { Prisma, PrismaClient };
