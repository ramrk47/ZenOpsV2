import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const run = (command) => {
  process.stdout.write(`$ ${command}\n`);
  execSync(command, { stdio: 'inherit' });
};

const databaseUrl = process.env.DATABASE_URL_ROOT ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL_ROOT (or DATABASE_URL) is required for DB bootstrap');
}

const schemaPath = resolve(process.cwd(), 'packages/db/prisma/schema');
const sql = (file) => resolve(process.cwd(), 'infra/sql', file);

run(`pnpm --filter @zenops/db exec prisma db execute --url \"${databaseUrl}\" --file \"${sql('001_init.sql')}\"`);
run(`DATABASE_URL=\"${databaseUrl}\" pnpm --filter @zenops/db exec prisma db push --schema ${schemaPath}`);
run(`pnpm --filter @zenops/db exec prisma db execute --url \"${databaseUrl}\" --file \"${sql('010_rls.sql')}\"`);
run(`pnpm --filter @zenops/db exec prisma db execute --url \"${databaseUrl}\" --file \"${sql('020_seed.sql')}\"`);
