// Diagnostic pilot for LLP 0307.000 Acceptance 1 (S1 lane).
// Uses ONLY public @expo/snapback-acceptance API against the real dev server.
// Personas are hand-minted via `snapback session mint` (no --json flag) and
// injected through actors.bearerFor, sidestepping the replay.mjs mintSession
// defect (it passes --json, which the native binary rejects) WITHOUT touching
// product code. This validates the rest of the replay pipeline end to end.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { defineReplay, runReplay } from '../../node_modules/@expo/snapback-acceptance/replay.mjs';

const scratch = resolve(import.meta.dirname, '..');
const readyFile = join(scratch, 'dev.ready.json');
const api = join(scratch, 'app/snapback/generated/api.mjs');
const actions = join(scratch, 'actions-200.jsonl');
const binary = process.env.SNAPBACK_RUNTIME_BINARY;
assert(binary, 'SNAPBACK_RUNTIME_BINARY required');

const adminToken = readFileSync(
  JSON.parse(readFileSync(readyFile, 'utf8')).adminTokenFile, 'utf8',
).trim();
const tokens = new Map();
function bearerFor(actor) {
  if (tokens.has(actor)) return tokens.get(actor);
  const out = execFileSync(binary, [
    'session', 'mint', '--email', `${actor}@replay.invalid`, '--ready-file', readyFile,
  ], { encoding: 'utf8', env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken } });
  const envelope = JSON.parse(out);
  assert.equal(envelope.ok, true, `mint failed for ${actor}`);
  tokens.set(actor, envelope.data.token);
  return envelope.data.token;
}

const custodies = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['minted', 'none'];
for (const custody of custodies) {
  const lane = join(import.meta.dirname, custody);
  mkdirSync(lane, { recursive: true });
  const started = Date.now();
  const result = await runReplay(defineReplay({
    readyFile,
    api,
    actions,
    actors: { bearerFor },
    transportCustody: custody,
    receiptsFile: join(lane, 'receipts.jsonl'),
    statusFile: join(lane, 'status.json'),
  }));
  const ms = Date.now() - started;
  console.log(JSON.stringify({
    custody,
    exitCode: result.exitCode,
    status: result.receipt.status,
    settled: result.receipt.actions.settled,
    total: result.receipt.actions.total,
    upgraded: result.receipt.custody.upgraded,
    pool: result.receipt.pool,
    acknowledged: result.receipt.acknowledgement.acknowledged,
    diagnostic: result.receipt.diagnostic,
    wallMs: ms,
    msPerAction: ms / result.receipt.actions.total,
  }));
  if (result.exitCode !== 0) process.exit(1);
}
