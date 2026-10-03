// Retained E2E driver. Run from snapback4/, with installed candidate starters.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [starter, label] = process.argv.slice(2);
const report = path.resolve('reports/20261001-nx-export-proves-native');
const project = path.resolve('target/nx', starter);
const nodeDir = '/Users/ccheever/.volta/tools/image/node/24.18.0/bin';
const env = { ...process.env, PATH: `${nodeDir}:${process.env.PATH}`, SNAPBACK4_BIN: path.resolve('target/production/snapback4'), SNAPBACK4_SMOKE_DEVICE_PREFIX: 'sb4-nx-', CI: '1' };
if (label === 'missing-runtime') env.PATH = path.resolve('target/nx/no-runtime') + ':' + env.PATH;
if (label === 'opt-out') env.SNAPBACK4_NATIVE_SMOKE = 'off';
const log = path.join(report, `${starter}-${label}.log`), fd = fs.openSync(log, 'wx');
const before = Date.now();
const result = spawnSync(path.join(nodeDir, 'npm'), ['run', 'export:ios'], { cwd: project, env, stdio: ['ignore', fd, fd] });
fs.closeSync(fd);
const durationMs = Date.now() - before, text = fs.readFileSync(log, 'utf8');
const receiptPath = text.match(/native smoke (?:passed|failed|skipped:.*); receipt: (.+)/)?.[1];
const receipt = receiptPath && fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath)) : null;
const metadata = JSON.parse(fs.readFileSync(path.join(project, 'dist/metadata.json')));
const bundleHash = createHash('sha256').update(fs.readFileSync(path.join(project, 'dist', metadata.fileMetadata.ios.bundle))).digest('hex');
const row = { starter, label, startedAt: before, durationMs, status: result.status, signal: result.signal, bundleHash, receiptPath,
  cache: receipt?.nativeCache, proofKind: receipt?.proofKind, receiptExit: receipt?.exitStatus, phase: receipt?.phase, error: receipt?.error,
  segments: receipt?.segments && Object.fromEntries(Object.entries(receipt.segments).map(([k,v]) => [k, v.status])),
  nativeDurationMs: receipt?.durationMs, loadedHash: receipt?.installed?.javascript?.sha256 };
fs.writeFileSync(path.join(report, `${starter}-${label}.json`), JSON.stringify(row, null, 2) + '\n');
console.log(JSON.stringify(row));
process.exitCode = result.status || 0;
