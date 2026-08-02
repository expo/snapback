import postgres from 'postgres';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const status = JSON.parse(execFileSync(process.execPath, [
  join(root, 'scripts', 'postgres-local.mjs'),
  'status'
], {cwd: root, encoding: 'utf8'}));

if (!status.running) {
  process.stdout.write(JSON.stringify({
    schemaVersion: 'snapback.zero-bakeoff.cleanup-audit.v1',
    postgresRunning: false,
    ownedDatabases: [],
    ownedSlots: [],
    ok: true
  }) + '\n');
  process.exit(0);
}

const sql = postgres(status.url, {max: 1});
try {
  const databases = await sql.unsafe(
    "SELECT datname FROM pg_database WHERE datname LIKE 'zero_bakeoff_%' ORDER BY datname"
  );
  const slots = await sql.unsafe(
    "SELECT slot_name, database, active FROM pg_replication_slots WHERE database LIKE 'zero_bakeoff_%' ORDER BY database, slot_name"
  );
  const receipt = {
    schemaVersion: 'snapback.zero-bakeoff.cleanup-audit.v1',
    postgresRunning: true,
    ownedDatabases: databases.map(({datname}) => datname),
    ownedSlots: slots,
    ok: databases.length === 0 && slots.length === 0
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await sql.end({timeout: 2});
}
