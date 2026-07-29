import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init as initAdmin } from '@instantdb/admin';
import schema from '../instant.schema.ts';

export const workRoot = resolve(import.meta.dirname, '..');
export const armRoot = resolve(workRoot, '..');
export const runtimeDir = resolve(workRoot, '.arm-runtime');
export const evidenceDir = resolve(armRoot, 'evidence');
export const receiptsDir = resolve(armRoot, 'receipts');
export const handoffDir = resolve(armRoot, 'handoff');
export const namespace = 'llp0102-partiful-instantdb-w3-a3';
export const frozenStart = '2026-07-29T06:32:56.448Z';
export const frozenStartMonotonicMs = 263334000;

for (const directory of [runtimeDir, evidenceDir, receiptsDir, handoffDir]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function writeJson(path, value, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

export function readTarget() {
  return JSON.parse(readFileSync(resolve(runtimeDir, 'target.json'), 'utf8'));
}

export function dbForTarget(target = readTarget()) {
  return initAdmin({
    appId: target.appId,
    adminToken: target.adminToken,
    schema,
  });
}

export function dbAs(email, target = readTarget()) {
  return dbForTarget(target).asUser({ email });
}

export function monotonicMs() {
  return Math.round(process.uptime() * 1000 + (Date.now() - performance.timeOrigin));
}

export function actorEmail(name) {
  return `${namespace}-${name}@example.test`;
}

export const ids = {
  event(index) {
    const hex = createHash('sha256').update(`${namespace}:event:${index}`).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
  },
  opaque() {
    return randomUUID();
  },
};

export function scrub(value, target) {
  return String(value ?? '')
    .replaceAll(target?.appId ?? '__none__', '[APP_ID]')
    .replaceAll(target?.adminToken ?? '__none__', '[ADMIN_TOKEN]')
    .slice(-12000);
}

export async function queryCounts(db = dbForTarget()) {
  const data = await db.query({
    profiles: {},
    events: {},
    invitations: {},
    seatClaims: {},
    wallPosts: {},
    reminderJobs: {},
    notificationAttempts: {},
    $files: {},
    $users: {},
  });
  return Object.fromEntries(
    Object.entries(data).map(([key, values]) => [key, Array.isArray(values) ? values.length : values ? 1 : 0]),
  );
}

export async function waitFor(predicate, { timeoutMs = 12000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}`);
}
