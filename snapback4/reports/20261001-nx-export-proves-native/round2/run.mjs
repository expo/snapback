// Run from snapback4/. Measurements use pinned Node and the local candidate CLI.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { retainEvidence } from '../../../packages/snapback4-expo/export-ios.mjs';
const [starter, label] = process.argv.slice(2);
const report = path.resolve('reports/20261001-nx-export-proves-native/round2'), project = path.resolve('target/nx', starter);
const nodeDir = '/Users/ccheever/.volta/tools/image/node/24.18.0/bin';
const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH}`, SNAPBACK4_BIN: process.env.NX_BIN || path.resolve('target/nx/timing-cli'), SNAPBACK4_SMOKE_DEVICE_PREFIX: process.env.NX_SMOKE_DEVICE_PREFIX || 'sb4-nx-r2-', CI: '1' };
if (label === 'missing-runtime') env.PATH = path.resolve('target/nx/no-runtime') + ':' + env.PATH;
if (label === 'opt-out') env.SNAPBACK4_NATIVE_SMOKE = 'off';
const resultPath = path.join(report, `${starter}-${label}.json`);
if (fs.existsSync(resultPath)) throw Error('refusing to replace existing run result: ' + resultPath);
const log = path.join(report, `${starter}-${label}.log`), fd = fs.openSync(log, 'wx');
const before = Date.now();
// The resource comparator must reuse the exact prior dist, without re-exporting.
// It invokes the same driver/cache-miss path and applies the wrapper's retention.
const reuseExport = label.endsWith('asset-fresh');
const freshArtifacts = reuseExport && path.join(project, 'artifacts/native-smoke', `${before}-${process.pid}`);
if (freshArtifacts) fs.mkdirSync(freshArtifacts, { recursive: true });
const command = reuseExport ? [env.SNAPBACK4_BIN, 'witness', 'ios', '--build', '.', '--smoke', '--export', 'dist', '--artifacts', freshArtifacts] : [path.join(nodeDir, 'npm'), 'run', 'export:ios'];
const result = spawnSync(command[0], command.slice(1), { cwd: project, env, stdio: ['ignore', fd, fd] });
if (freshArtifacts) retainEvidence(path.dirname(freshArtifacts), freshArtifacts);
fs.closeSync(fd);
const durationMs = Date.now() - before, text = fs.readFileSync(log, 'utf8');
const receiptPath = freshArtifacts ? path.join(freshArtifacts, 'smoke-ios-run.json') : text.match(/native smoke (?:passed|failed|interrupted|skipped:.*); receipt: (.+)/)?.[1];
const receipt = receiptPath && fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath)) : null;
const metadata = JSON.parse(fs.readFileSync(path.join(project, 'dist/metadata.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundleHash = hash(fs.readFileSync(path.join(project, 'dist', metadata.fileMetadata.ios.bundle)));
let build;
if (receiptPath) {
  const dir = path.dirname(receiptPath), evidence = path.join(report, 'evidence', `${starter}-${label}`); fs.mkdirSync(evidence, { recursive: true });
  const retained = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(json|jsonl|log)$/.test(name)) continue;
    const bytes = fs.readFileSync(path.join(dir, name));
    fs.writeFileSync(path.join(evidence, name + '.gz'), gzipSync(bytes));
    retained.push({ name, sha256: hash(bytes), bytes: bytes.length });
  }
  fs.writeFileSync(path.join(evidence, 'inventory.json'), JSON.stringify(retained, null, 2));
  if (fs.existsSync(path.join(dir, 'build.json'))) {
    const bytes = fs.readFileSync(path.join(dir, 'build.json')); build = JSON.parse(bytes);
    if (build.cacheHit && build.nativeBase.receipt) {
      if (bytes.length > 1024 * 1024) throw Error('warm receipt duplicates native build evidence');
      const producer = build.nativeBase.receipt;
      const original = fs.existsSync(producer.path) ? fs.readFileSync(producer.path) : gunzipSync(fs.readFileSync(producer.path + '.gz'));
      if (hash(original) !== producer.sha256) throw Error('native producer receipt hash changed');
      build.warmReceiptBytes = bytes.length;
    }
  }
  for (const name of ['preparation-tmp', 'base.app', 'export.app', 'build.xcresult']) {
    if (fs.existsSync(path.join(dir, name))) throw Error('per-run temporary retained: ' + name);
  }
}
const row = { starter, label, command, reusedExactExport: reuseExport, startedAt: before, durationMs, status: result.status, signal: result.signal, bundleHash, receiptPath,
  cache: receipt?.nativeCache, proofKind: receipt?.proofKind, receiptExit: receipt?.exitStatus, phase: receipt?.phase, error: receipt?.error,
  environmentCondition: receipt?.environmentCondition,
  segments: receipt?.segments && Object.fromEntries(Object.entries(receipt.segments).map(([k,v]) => [k,v.status])),
  nativeDurationMs: receipt?.durationMs, loadedHash: receipt?.installed?.javascript?.sha256,
  metroResources: build?.metroResources, warmReceiptBytes: build?.warmReceiptBytes, nativeMarker: build?.executedApp?.info?.NXNativeMode,
  cacheMiss: text.match(/native-cache miss: .+/)?.[0] };
fs.writeFileSync(resultPath, JSON.stringify(row, null, 2) + '\n');
console.log(JSON.stringify({ ...row, metroResources: row.metroResources?.length }));
process.exitCode = result.status || 0;
