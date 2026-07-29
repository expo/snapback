import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..');
const repoRoot = resolve(demoRoot, '..', '..');
const secrets = await readFile(join(repoRoot, '.agent-local-secrets.md'), 'utf8');
const match = secrets.match(/^DIRECT_URL=(.+)$/m);
if (!match) throw new Error('DIRECT_URL is missing from .agent-local-secrets.md');

const migration = await readFile(
  join(demoRoot, 'supabase', 'migrations', '202607270001_signal_desk.sql'),
  'utf8',
);
const databaseUrl = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
const sql = postgres(databaseUrl, { max: 1, ssl: 'require' });
try {
  await sql.unsafe(migration);
  process.stdout.write('Signal Desk Supabase migration applied.\n');
} finally {
  await sql.end();
}
