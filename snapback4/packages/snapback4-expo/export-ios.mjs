#!/usr/bin/env node
// @ref LLP 3000.030#15 — preserve export success on unavailable native hosts only.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function skipReason(platform, env) {
  if (env.SNAPBACK4_NATIVE_SMOKE === 'off') return 'SNAPBACK4_NATIVE_SMOKE=off';
  if (platform !== 'darwin') return 'macOS is required';
  return null;
}
export function smokeResult(status, receipt) {
  if (status === 0) return { status: 0, message: 'native smoke passed' };
  if (receipt?.phase === 'environment' && receipt?.error) return { status: 0, message: `native smoke skipped: ${receipt.error}` };
  return { status: status || 1, message: 'native smoke failed' };
}
export function main() {
  const req = createRequire(path.resolve('package.json'));
  // Asset metadata adds no transform and does not change the Hermes bytes/path.
  const exported = spawnSync(process.execPath, [req.resolve('expo/bin/cli'), 'export', '--platform', 'ios', '--dump-assetmap'], { stdio: 'inherit', env: process.env });
  if (exported.error || exported.status !== 0) return exported.status || 1;
  const skip = skipReason(process.platform, process.env);
  if (skip) { console.log(`native smoke skipped: ${skip}`); return 0; }
  const artifacts = path.resolve('artifacts/native-smoke', `${Date.now()}-${process.pid}`);
  const receiptPath = path.join(artifacts, 'smoke-ios-run.json');
  const result = spawnSync('snapback4', ['witness', 'ios', '--build', '.', '--smoke', '--export', 'dist', '--artifacts', artifacts], { stdio: 'inherit', env: process.env });
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch {}
  const outcome = smokeResult(result.error ? 1 : result.status, receipt);
  console.log(`${outcome.message}; receipt: ${receiptPath}`);
  return outcome.status;
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) process.exitCode = main();
