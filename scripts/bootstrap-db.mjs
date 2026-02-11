import { execSync } from 'node:child_process';

const run = (command) => {
  process.stdout.write(`$ ${command}\n`);
  execSync(command, { stdio: 'inherit' });
};

const databaseUrl = process.env.DATABASE_URL_ROOT ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL_ROOT (or DATABASE_URL) is required for DB bootstrap');
}

const schemaPath = 'packages/db/prisma/schema';

run(`pnpm --filter @zenops/db exec prisma db execute --schema ${schemaPath} --url \"${databaseUrl}\" --file infra/sql/001_init.sql`);
run(`pnpm --filter @zenops/db exec prisma db push --schema ${schemaPath}`);
run(`pnpm --filter @zenops/db exec prisma db execute --schema ${schemaPath} --url \"${databaseUrl}\" --file infra/sql/010_rls.sql`);
run(`pnpm --filter @zenops/db exec prisma db execute --schema ${schemaPath} --url \"${databaseUrl}\" --file infra/sql/020_seed.sql`);
