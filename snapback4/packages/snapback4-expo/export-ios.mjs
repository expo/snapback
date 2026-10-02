#!/usr/bin/env node
// @ref LLP 3000.030#15 — exact export, explicit environment skips, bounded evidence.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
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
const receipts = new Set(['smoke-ios-run.json', 'smoke-ios-receipts.jsonl', 'proof.json', 'build.json', 'installed.json', 'preparation-failure.json', 'native-base.json']);
export function retainEvidence(root, completed) {
  fs.writeFileSync(path.join(completed, 'finished.json'), JSON.stringify({ finishedAt: Date.now() }));
  const runs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && /^\d+-\d+$/.test(d.name))
    .map(d => path.join(root, d.name)).filter(dir => {
      if (fs.existsSync(path.join(dir, 'finished.json'))) return true;
      // Pre-retention wrappers also wrote run.json only after success/failure.
      try { const r = JSON.parse(fs.readFileSync(path.join(dir, 'smoke-ios-run.json'))); return Number.isInteger(r.exitStatus) && !!(r.endedAt || r.finishedAt); }
      catch { return false; }
    })
    .sort((a, b) => Number(path.basename(b).split('-')[0]) - Number(path.basename(a).split('-')[0]));
  for (const dir of runs.slice(5)) {
    if (fs.existsSync(path.join(dir, 'retention.json'))) continue;
    const removed = [], retained = [];
    for (const name of fs.readdirSync(dir)) {
      if (name === 'finished.json') continue;
      const file = path.join(dir, name);
      if (name.endsWith('.gz') && receipts.has(name.slice(0, -3)) && fs.lstatSync(file).isFile()) {
        // Resume an interrupted prune without deleting already-kept receipts.
        retained.push(name); continue;
      }
      if (receipts.has(name) && fs.lstatSync(file).isFile()) {
        const temporary = file + `.gz.${process.pid}.tmp`;
        fs.writeFileSync(temporary, gzipSync(fs.readFileSync(file)));
        fs.renameSync(temporary, file + '.gz');
        retained.push(name + '.gz');
      } else removed.push(name);
      fs.rmSync(file, { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(dir, 'retention.json'), JSON.stringify({ retained, removed }, null, 2));
  }
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
  const result = await runChild('snapback4', ['witness', 'ios', '--build', '.', '--smoke', '--export', 'dist', '--artifacts', artifacts]);
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
