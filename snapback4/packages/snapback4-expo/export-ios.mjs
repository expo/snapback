#!/usr/bin/env node
// @ref LLP 3000.030#15 — exact export, explicit environment skips, bounded evidence.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function exportFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative)).sort().flatMap(name => {
    const file = path.join(relative, name), full = path.join(root, file), stat = fs.lstatSync(full);
    const row = { path: file, mode: stat.mode & 0o777 };
    if (stat.isDirectory()) return [{ ...row, type: 'directory' }, ...exportFiles(root, file)];
    if (!stat.isFile()) throw Error('export contains an unsupported file type');
    const bytes = fs.readFileSync(full);
    return [{ ...row, type: 'file', bytes: bytes.length, sha256: sha256(bytes) }];
  });
}
function publicationExpectation(artifacts, source, skipped, smoke) {
  if (skipped) return { proofSha256: null, files: exportFiles(source) };
  const bytes = fs.readFileSync(path.join(artifacts, 'proof.json'));
  const proofSha256 = sha256(bytes), files = JSON.parse(bytes).exported?.inventory?.files;
  if (smoke?.exitStatus !== 0 || smoke?.proof?.sha256 !== proofSha256 || !Array.isArray(files)) throw Error('export proof does not match successful smoke receipt');
  return { proofSha256, files };
}
export function verifyPublication(artifacts, source, target, expected) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(artifacts, 'publication.json'), 'utf8')); }
  catch { throw Error('missing or unreadable verified publication.json'); }
  if (receipt.source !== source || receipt.target !== target || !Number.isFinite(receipt.verifiedAt) ||
      receipt.proofSha256 !== expected.proofSha256 || !isDeepStrictEqual(receipt.files, expected.files)) {
    throw Error('publication.json does not match the export proved by this run');
  }
}

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
// The helper locks a duplicate of this descriptor, so the kernel lease stays
// with this process after the helper exits. Children do not inherit it unless
// explicitly listed in stdio (the publisher must keep it if this wrapper dies).
export function acquireExportLease(artifacts, binary = 'snapback4') {
  const fd = fs.openSync(path.join(artifacts, 'export.lock'), 'a+');
  const result = spawnSync(binary, ['witness', 'export-lease', artifacts], { encoding: 'utf8', env: { ...process.env, SNAPBACK4_EXPORT_WRAPPER_PID: String(process.pid) }, stdio: ['ignore', 'pipe', 'pipe', fd] });
  if (result.status !== 0) { fs.closeSync(fd); throw Error(result.stderr || result.error?.message || 'export lease failed'); }
  return fd;
}
export async function main() {
  const req = createRequire(path.resolve('package.json'));
  const skip = skipReason(process.platform, process.env);
  if (skip) {
    const exported = await runChild(process.execPath, [req.resolve('expo/bin/cli'), 'export', '--platform', 'ios', '--dump-assetmap']);
    if (exported.status !== 0) return exported.status;
    console.log(`native smoke skipped: ${skip}`); return 0;
  }
  const root = path.resolve('artifacts/native-smoke');
  const artifacts = path.join(root, `${Date.now()}-${process.pid}`);
  const privateExport = path.join(artifacts, 'export');
  const receiptPath = path.join(artifacts, 'smoke-ios-run.json');
  fs.mkdirSync(artifacts, { recursive: true });
  const lease = acquireExportLease(artifacts);
  let publicationAttempted = false;
  try {
    const exported = await runChild(process.execPath, [req.resolve('expo/bin/cli'), 'export', '--platform', 'ios', '--dump-assetmap', '--output-dir', privateExport]);
    if (exported.status !== 0) return exported.status;
    const result = await runChild('snapback4', ['witness', 'ios', '--build', '.', '--smoke', '--export', privateExport, '--artifacts', artifacts], { env: { ...process.env, SNAPBACK4_EXPORT_WRAPPER_PID: String(process.pid) } });
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch {}
    const outcome = result.cancelled ? { status: result.status, message: 'native smoke interrupted' } : smokeResult(result.status, receipt);
    if (outcome.status === 0) {
      const expected = publicationExpectation(artifacts, privateExport, result.status !== 0, receipt);
      publicationAttempted = true;
      const published = await runChild('snapback4', ['witness', 'export-publish', privateExport, path.resolve('dist'), ...(result.status === 0 ? [] : ['--environment-skip'])], { stdio: ['inherit', 'inherit', 'inherit', lease] });
      try {
        verifyPublication(artifacts, privateExport, path.resolve('dist'), expected);
        if (published.status !== 0) throw Error(`publisher exited with status ${published.status}`);
      } catch (error) { outcome.status = published.status || 1; outcome.message = `export output publication failed: ${error.message}`; }
    }
    console.log(`${outcome.message}; receipt: ${receiptPath}`);
    return outcome.status;
  } finally {
    // After a publication attempt this path may be the displaced last good
    // export. Only the publisher, under its destination lock, may remove it.
    try { if (!publicationAttempted) fs.rmSync(privateExport, { recursive: true, force: true }); }
    finally { fs.closeSync(lease); retainEvidence(root, artifacts); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`export:ios failed: ${error.message}`); process.exitCode = 1; }
}
