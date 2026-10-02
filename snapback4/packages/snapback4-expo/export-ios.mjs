#!/usr/bin/env node
// @ref LLP 3000.030#15 — exact export, explicit environment skips, bounded evidence.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function skipReason(platform, env) {
  if (env.SNAPBACK4_NATIVE_SMOKE === 'off') return 'SNAPBACK4_NATIVE_SMOKE=off';
  if (platform !== 'darwin') return 'macOS is required';
  return null;
}
const environmentConditions = new Set(['simulator-list', 'missing-runtime', 'missing-device-type', 'simulator-create', 'simulator-boot']);
export function smokeResult(status, receipt) {
  if (status === 0) return { status: 0, message: 'native smoke passed' };
  if (receipt?.environmentCondition === 'simulator-create' && /^E_WITNESS_TIMEOUT:/.test(receipt.error)) return { status: status || 1, message: 'native smoke failed' };
  if (receipt?.phase === 'environment' && environmentConditions.has(receipt.environmentCondition) &&
      /^(E_WITNESS_PLATFORM|E_WITNESS_SIMULATOR|E_WITNESS_TIMEOUT):/.test(receipt.error)) {
    return { status: 0, message: `native smoke skipped: ${receipt.error}` };
  }
  return { status: status || 1, message: 'native smoke failed' };
}
// The Rust driver bounds its own cleanup and keeps its leases until it finishes.
// Wait for that exit even after a second signal; killing only its wrapper would
// orphan the driver's backend/app. This also forwards cancellation during export.
export function runChild(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env, ...options });
    let received;
    const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
      if (!received) { received = signal; child.kill(signal); }
    }]));
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    child.once('error', () => {}); // close also follows a failed spawn
    child.once('close', (status, signal) => {
      for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
      const cancelled = received ?? signal;
      resolve({ status: cancelled ? (cancelled === 'SIGINT' ? 130 : 143) : status ?? 1, cancelled });
    });
  });
}
// OS-locked pruning/recovery lives beside the driver's ownership records.
// Failure here is maintenance work, never a change to a completed smoke result.
export function retainEvidence(root, completed, binary = 'snapback4') {
  const result = spawnSync(binary, ['witness', 'export-cleanup', root, ...(completed ? [completed] : [])], { encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) console.error(`native smoke evidence cleanup deferred: ${result.stderr || result.error?.message || result.status}`);
  return result.status === 0;
}
export async function main() {
  const req = createRequire(path.resolve('package.json'));
  const exported = await runChild(process.execPath, [req.resolve('expo/bin/cli'), 'export', '--platform', 'ios', '--dump-assetmap']);
  if (exported.status !== 0) return exported.status;
  const skip = skipReason(process.platform, process.env);
  if (skip) { console.log(`native smoke skipped: ${skip}`); return 0; }
  const root = path.resolve('artifacts/native-smoke');
  const artifacts = path.join(root, `${Date.now()}-${process.pid}`);
  const receiptPath = path.join(artifacts, 'smoke-ios-run.json');
  fs.mkdirSync(artifacts, { recursive: true });
  const result = await runChild('snapback4', ['witness', 'ios', '--build', '.', '--smoke', '--export', 'dist', '--artifacts', artifacts], { env: { ...process.env, SNAPBACK4_EXPORT_WRAPPER_PID: String(process.pid) } });
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch {}
  const outcome = result.cancelled ? { status: result.status, message: 'native smoke interrupted' } : smokeResult(result.status, receipt);
  retainEvidence(root, artifacts);
  console.log(`${outcome.message}; receipt: ${receiptPath}`);
  return outcome.status;
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`export:ios failed: ${error.message}`); process.exitCode = 1; }
}
