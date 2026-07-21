import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { manifestSemanticSha256 } from './manifest-semantics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const acceptanceRoot = join(demoRoot, 'acceptance');
const shouldBuild = process.argv.includes('--build');
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const output = option('out');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

if (shouldBuild) {
  for (const arm of ['react', 'contract', 'vanilla']) {
    const run = spawnSync('bun', ['run', 'build'], {
      cwd: join(demoRoot, 'surfaces', arm),
      stdio: 'inherit',
    });
    assert.equal(run.status, 0, `${arm} production builds failed`);
  }
}

const sourceGroups = {
  react: [
    'surfaces/react/src/App.tsx', 'surfaces/react/src/main.tsx',
    'surfaces/react/src/provider.ts',
  ],
  contract: [
    'surfaces/contract/feed.contract', 'surfaces/contract/event.contract',
    'surfaces/contract/main.ts', 'surfaces/contract/provider.ts',
    'surfaces/contract/helpers.ts', 'surfaces/contract/helpers.contract-meta.ts',
  ],
  vanilla: [
    'surfaces/vanilla/src/main.js', 'surfaces/vanilla/src/provider.js',
    'surfaces/vanilla/src/lifecycle.js',
  ],
  snapbackBackend: [
    'snapback/schema.mjs', 'snapback/functions.mjs', 'snapback/seed.json',
  ],
};

const lineCount = (bytes) => {
  if (bytes.length === 0) return 0;
  const text = bytes.toString('utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};
const sourceInventory = Object.fromEntries(Object.entries(sourceGroups).map(([group, paths]) => {
  const files = paths.map((path) => {
    const bytes = readFileSync(join(demoRoot, path));
    return { path, lines: lineCount(bytes), bytes: bytes.length, sha256: sha256(bytes) };
  });
  return [group, { files, totalLines: files.reduce((sum, file) => sum + file.lines, 0) }];
}));
const glueInventory = {
  react: inventorySubset(sourceInventory.react, ['surfaces/react/src/main.tsx', 'surfaces/react/src/provider.ts']),
  contract: inventorySubset(sourceInventory.contract, [
    'surfaces/contract/main.ts', 'surfaces/contract/provider.ts',
    'surfaces/contract/helpers.ts', 'surfaces/contract/helpers.contract-meta.ts',
  ]),
  vanilla: inventorySubset(sourceInventory.vanilla, ['surfaces/vanilla/src/provider.js', 'surfaces/vanilla/src/lifecycle.js']),
};

function inventorySubset(group, paths) {
  const wanted = new Set(paths);
  const files = group.files.filter(({ path }) => wanted.has(path));
  assert.equal(files.length, paths.length, 'glue inventory omitted a declared source file');
  return { files, totalLines: files.reduce((sum, file) => sum + file.lines, 0) };
}

const walk = (root) => readdirSync(root).flatMap((name) => {
  const path = join(root, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const arms = ['react', 'contract', 'vanilla'];
const backends = ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = {};
for (const arm of arms) {
  for (const backend of backends) {
    const root = join(demoRoot, 'surfaces', arm, 'dist', backend);
    assert.ok(statSync(root).isDirectory(), `missing build output: ${relative(repoRoot, root)}`);
    const assets = walk(root).filter((path) => extname(path) === '.js').map((path) => {
      const bytes = readFileSync(path);
      return {
        path: relative(repoRoot, path),
        minifiedBytes: bytes.length,
        deterministicGzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
        sha256: sha256(bytes),
      };
    });
    assert.ok(assets.length > 0, `${arm}:${backend} emitted no JavaScript assets`);
    cells[`${arm}:${backend}`] = {
      assets,
      minifiedBytes: assets.reduce((sum, asset) => sum + asset.minifiedBytes, 0),
      deterministicGzipBytes: assets.reduce((sum, asset) => sum + asset.deterministicGzipBytes, 0),
    };
  }
}

const gatewayAverage = (arm, field) => Math.round(
  ['supabase', 'convex', 'sqlite'].reduce((sum, backend) => sum + cells[`${arm}:${backend}`][field], 0) / 3,
);
const attribution = {
  note: 'The vanilla row is a lower-bound subtraction instrument. Combined buckets are deliberately not represented as isolated framework cost.',
  minifiedBytes: {
    vanillaGatewayFloor: gatewayAverage('vanilla', 'minifiedBytes'),
    snapbackProviderClientLowerBound: cells['vanilla:snapback'].minifiedBytes - gatewayAverage('vanilla', 'minifiedBytes'),
    reactFrameworkAndApplicationCombined: gatewayAverage('react', 'minifiedBytes') - gatewayAverage('vanilla', 'minifiedBytes'),
    contractRuntimeAndApplicationCombined: gatewayAverage('contract', 'minifiedBytes') - gatewayAverage('vanilla', 'minifiedBytes'),
    contractSnapbackInteractionUnattributed: (cells['contract:snapback'].minifiedBytes - gatewayAverage('contract', 'minifiedBytes')) - (cells['vanilla:snapback'].minifiedBytes - gatewayAverage('vanilla', 'minifiedBytes')),
  },
};

const protocol = JSON.parse(readFileSync(join(acceptanceRoot, 'comparison-protocol.v1.json'), 'utf8'));
assert.equal(protocol.thresholdFormulas.emittedMinifiedJsBytes, 'floor(react_same_cell_baseline * 1.05)');
assert.equal(protocol.thresholdFormulas.compressedJsBytes, 'floor(react_same_cell_baseline * 1.05)');
assert.equal(protocol.thresholdFormulas.contractSourceLines, 'floor(react_same_workload_source_lines * 1.10)');
assert.equal(protocol.thresholdFormulas.snapbackBackendLines, 'floor(partitime_snapback_backend_baseline_lines * 0.80)');
assert.equal(protocol.thresholdFormulas.requiredCheckCount, 'partitime_full_web_matrix_required_check_count');
assert.equal(protocol.thresholdFormulas.firstPushFreshnessLatencyMsP95, 'floor(react_snapback_baseline * 1.10)');
const manifest = JSON.parse(readFileSync(join(acceptanceRoot, 'claims.v1.json'), 'utf8'));
const webReceiptPath = join(acceptanceRoot, 'results', 'step0-web.json');
const webReceiptBytes = readFileSync(webReceiptPath);
const webReceipt = JSON.parse(webReceiptBytes);
assert.equal(webReceipt.ok, true, 'the retained web receipt must pass before attribution');
const pushResults = webReceipt.results.filter(({ name }) =>
  name.endsWith('proves unsolicited push with polling fallback disabled')
);
assert.equal(pushResults.length, 3, 'the retained web receipt must contain three push witnesses');
const pushLatency = Object.fromEntries(pushResults.map(({ name, details }) => {
  assert.equal(details.warmupCount, 2, `${name} has the wrong push warmup count`);
  assert.equal(details.sampleCount, 7, `${name} has the wrong push sample count`);
  assert.equal(details.freshnessLatencyMs.samples.length, 7, `${name} is missing push samples`);
  const arm = name.split(' × ')[0];
  return [arm, details.freshnessLatencyMs];
}));
assert.deepEqual(Object.keys(pushLatency).sort(), ['contract', 'react', 'vanilla']);
const currentFormulaThresholds = {
  emittedMinifiedJsBytes: Object.fromEntries(backends.map((backend) => [backend, Math.floor(cells[`react:${backend}`].minifiedBytes * 1.05)])),
  compressedJsBytes: Object.fromEntries(backends.map((backend) => [backend, Math.floor(cells[`react:${backend}`].deterministicGzipBytes * 1.05)])),
  contractSourceLines: Math.floor(sourceInventory.react.totalLines * 1.10),
  snapbackBackendLines: Math.floor(sourceInventory.snapbackBackend.totalLines * 0.80),
  requiredWebCheckCount: 43,
  firstPushFreshnessLatencyMsP95: Math.floor(pushLatency.react.p95 * 1.10),
};
let thresholds = currentFormulaThresholds;
let thresholdId = `partitime-thresholds-v1-sha256-${sha256(JSON.stringify(thresholds)).slice(0, 16)}`;
let thresholdFreezeSource = null;
if (output) {
  // @ref LLP 0063#product-choice-at-the-start-of-the-program — threshold
  // numbers freeze at the first attribution run. A cumulative rerun measures
  // current costs against that baseline; it must never silently recompute a
  // more permissive threshold after implementation changes the cells.
  const outputPath = relative(repoRoot, resolve(repoRoot, output));
  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(revisionResult.status, 0, `git rev-parse HEAD failed: ${revisionResult.stderr}`);
  const committedRevision = revisionResult.stdout.trim();
  assert.match(committedRevision, /^[a-f0-9]{40}$/);
  const committed = spawnSync('git', ['show', `${committedRevision}:${outputPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (committed.status === 0) {
    const frozen = JSON.parse(committed.stdout);
    assert.equal(frozen.schemaVersion, 'partitime.attribution.v1');
    assert.equal(frozen.workloadVersion, protocol.workloadVersion);
    assert.equal(frozen.methodId, protocol.protocolId);
    assert.equal(frozen.thresholdFormulaSetId, protocol.thresholdFormulaSetId);
    thresholds = frozen.thresholds;
    thresholdId = frozen.thresholdId;
    thresholdFreezeSource = frozen.inputs?.thresholdFreezeSource ?? {
      path: outputPath,
      revision: committedRevision,
      sha256: sha256(committed.stdout),
    };
  }
}
const result = {
  schemaVersion: 'partitime.attribution.v1',
  workloadVersion: protocol.workloadVersion,
  methodId: protocol.protocolId,
  thresholdFormulaSetId: protocol.thresholdFormulaSetId,
  thresholdId,
  measuredAt: new Date().toISOString(),
  environment: {
    os: `${platform()}-${release()}-${arch()}`,
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
    bun: spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout.trim(),
  },
  inputs: {
    claimManifestSemanticSha256: manifestSemanticSha256(manifest),
    protocolSha256: sha256(readFileSync(join(acceptanceRoot, 'comparison-protocol.v1.json'))),
    webReceiptSha256: sha256(webReceiptBytes),
    thresholdFreezeSource,
    // React and Contract intentionally have isolated dependency graphs. The
    // dependency-free Vanilla arm is a root-workspace package, so its resolved
    // Vite identity is pinned by the repository lock rather than a fictional
    // surface-local lockfile.
    surfaceLocks: Object.fromEntries(arms.map((arm) => {
      const path = arm === 'vanilla'
        ? join(repoRoot, 'bun.lock')
        : join(demoRoot, 'surfaces', arm, 'bun.lock');
      return [arm, {
        path: relative(repoRoot, path),
        sha256: sha256(readFileSync(path)),
      }];
    })),
  },
  sourceInventory,
  glueInventory,
  cells,
  attribution,
  pushLatency,
  currentFormulaThresholds,
  thresholds,
};

if (output) {
  const path = resolve(repoRoot, output);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(temporary, path);
}
console.log(JSON.stringify(result));
