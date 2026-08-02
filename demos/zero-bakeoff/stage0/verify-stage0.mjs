// @ref LLP 0155#stage-0--authority-reconciliation-and-baseline-freeze —
// current evidence bytes remain immutable while implementation identities are
// reproducibly resolved from the versioned freeze tree.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const baselinePath = resolve(import.meta.dirname, 'baseline.v1.json');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new Error(`SNAPBACK_STAGE0_BASELINE_INVALID: ${message}`);
};
const readRepo = (path) => readFile(resolve(repoRoot, path));
const readGitPath = (commit, path) => execFileSync(
  'git',
  ['show', `${commit}:${path}`],
  {cwd: repoRoot},
);
const digestRows = (rows) => sha256(rows
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  .map(({path, sha256: digest}) => `${digest}  ${path}\n`)
  .join(''));

if (baseline.schemaVersion !== 'snapback.local-sync-stage0-baseline.v1') {
  fail('wrong schemaVersion');
}
if (baseline.applicationManifests.length !== 6) fail('exactly six manifests must be frozen');
if (new Set(baseline.applicationManifests.map(({app}) => app)).size !== 6) {
  fail('application manifest ids must be unique');
}
if (baseline.immutableReceipts.length !== 15) {
  fail('all fourteen application receipts plus the runtime qualification must remain pinned');
}

for (const entry of [...baseline.applicationManifests, ...baseline.immutableReceipts]) {
  const current = await readRepo(entry.path);
  if (sha256(current) !== entry.sha256) fail(`${entry.path}: current digest moved`);
  const historical = readGitPath(baseline.immutableBakeoffSourceCommit, entry.path);
  if (sha256(historical) !== entry.sha256) fail(`${entry.path}: source-commit digest mismatch`);
  const blob = execFileSync(
    'git',
    ['rev-parse', `${baseline.immutableBakeoffSourceCommit}:${entry.path}`],
    {cwd: repoRoot, encoding: 'utf8'},
  ).trim();
  if (blob !== entry.gitBlob) fail(`${entry.path}: source git blob mismatch`);
}

// The source identities are a reproducible baseline, not ceilings on successor
// implementation. Verify them at the frozen tree while receipts remain immutable
// in both the frozen source and the current checkout.
const packageManifestBytes = readGitPath(
  baseline.freezeSourceCommit,
  baseline.identities.clientBundle.packageManifestPath,
);
if (sha256(packageManifestBytes) !== baseline.identities.clientBundle.packageManifestSha256) {
  fail('frozen client package manifest digest mismatch');
}
const packageManifest = JSON.parse(packageManifestBytes);
if (packageManifest.name !== baseline.identities.clientBundle.package) fail('client package name moved');
if (packageManifest.version !== baseline.identities.clientBundle.version) fail('client package version moved');
const packageRows = [];
for (const relativePath of [...packageManifest.files].sort()) {
  const path = `packages/snapback-client/${relativePath}`;
  packageRows.push({path, sha256: sha256(readGitPath(baseline.freezeSourceCommit, path))});
}
if (packageRows.length !== baseline.identities.clientBundle.closureFileCount) {
  fail('frozen client published closure file count mismatch');
}
if (digestRows(packageRows) !== baseline.identities.clientBundle.closureSha256) {
  fail('frozen client published closure digest mismatch');
}

const storeRows = [];
for (const path of baseline.identities.store.sourcePaths) {
  storeRows.push({path, sha256: sha256(readGitPath(baseline.freezeSourceCommit, path))});
}
if (digestRows(storeRows) !== baseline.identities.store.sourceClosureSha256) {
  fail('frozen store source closure digest mismatch');
}
if (sha256(readGitPath(baseline.freezeSourceCommit, baseline.identities.target.capabilityManifestPath))
    !== baseline.identities.target.capabilityManifestSha256) {
  fail('frozen target capability manifest digest mismatch');
}
if (sha256(readGitPath(baseline.freezeSourceCommit, 'Cargo.lock'))
    !== baseline.identities.target.cargoLockSha256) {
  fail('frozen Cargo.lock digest mismatch');
}
const ibexCommit = execFileSync('git', ['ls-tree', baseline.freezeSourceCommit, 'vendor/ibex'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim().split(/\s+/u)[2];
if (ibexCommit !== baseline.identities.target.ibexSubmoduleCommit) {
  fail('frozen Ibex gitlink mismatch');
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  manifests: baseline.applicationManifests.length,
  immutableReceipts: baseline.immutableReceipts.length,
  clientBundleFiles: packageRows.length,
  freezeSourceCommit: baseline.freezeSourceCommit,
})}\n`);
