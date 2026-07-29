#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const cli = `${process.env.HOME}/.local/bin/spacetime`;
const result = spawnSync(
  cli,
  [
    'sql',
    '--no-config',
    '--server',
    'http://127.0.0.1:3102',
    '--format',
    'json',
    'todo-spacetimedb-calibration-02',
    'SELECT COUNT(*) AS task_count FROM task',
  ],
  { encoding: 'utf8' }
);
if (result.status !== 0) throw new Error(`authoritative SQL failed (exit ${result.status})`);
const payload = JSON.parse(result.stdout);
const taskCount = Number(payload[0]?.rows?.[0]?.[0]);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok: taskCount === 100,
  taskCount,
  queryClass: 'owner-authoritative-private-table-count',
  containsSecretValues: false,
};
await mkdir('../receipts', { recursive: true });
await writeFile('../receipts/authoritative-count.v1.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
