import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const controller = resolve(here, 'controller.mjs');
const baselineApp = resolve(process.env.SNAPBACK3_BASELINE_APP ?? 'baseline-app');
const candidateApp = resolve(process.env.SNAPBACK3_CANDIDATE_APP ?? 'candidate-app');
const baselinePackageArchive = resolve(process.env.SNAPBACK3_BASELINE_PACKAGE_ARCHIVE ?? 'baseline-package.tgz');
const candidatePackageArchive = resolve(process.env.SNAPBACK3_CANDIDATE_PACKAGE_ARCHIVE ?? 'candidate-package.tgz');
const output = resolve(process.env.SNAPBACK3_PAIRS_OUTPUT ?? `pairs-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
const node = process.env.SNAPBACK3_NODE ?? process.execPath;
const port = Number(process.env.SNAPBACK3_PORT ?? 54924);
const pairs = Number(process.env.SNAPBACK3_PAIRS ?? 10);
const preflightOnly = process.env.SNAPBACK3_PAIRS_PREFLIGHT === '1';
if (![54924, 54925].includes(port)) throw new Error(`Refusing unauthorized port ${port}.`);
if (!Number.isSafeInteger(pairs) || pairs < 1 || pairs > 10) throw new Error('SNAPBACK3_PAIRS must be 1 through 10.');
await Promise.all([stat(baselineApp), stat(candidateApp), stat(baselinePackageArchive), stat(candidatePackageArchive)]);
await mkdir(output, { recursive: false });

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fileHash = async path => sha256(await readFile(path));
const bundleHash = async app => {
  const html = await readFile(resolve(app, 'dist/index.html'), 'utf8');
  const source = html.match(/<script[^>]+src=["']([^"']*\/entry-[^"']+\.js)["']/)?.[1];
  if (!source) throw new Error(`No production bundle reference in ${resolve(app, 'dist/index.html')}.`);
  return fileHash(resolve(app, 'dist', source.replace(/^\//, '')));
};
const json = value => JSON.stringify(value, null, 2) + '\n';
const plan = [];
for (let pair = 1; pair <= pairs; pair++) {
  const order = pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const variant of order) plan.push({ pair, variant, app: variant === 'baseline' ? baselineApp : candidateApp });
}
const receipt = {
  createdAt: new Date().toISOString(), pairs, port, preflightOnly,
  pairsRunnerSha256: await fileHash(fileURLToPath(import.meta.url)),
  controllerSha256: await fileHash(controller),
  apps: {
    baseline: { path: baselineApp, packageArchive: baselinePackageArchive,
      packageArchiveSha256: await fileHash(baselinePackageArchive),
      packageBuildManifestSha256: await fileHash(resolve(baselineApp, 'node_modules/snapback3/dist/package-build.json')),
      acquireSha256: await fileHash(resolve(baselineApp, 'src/acquire.ts')), bundleSha256: await bundleHash(baselineApp) },
    candidate: { path: candidateApp, packageArchive: candidatePackageArchive,
      packageArchiveSha256: await fileHash(candidatePackageArchive),
      packageBuildManifestSha256: await fileHash(resolve(candidateApp, 'node_modules/snapback3/dist/package-build.json')),
      acquireSha256: await fileHash(resolve(candidateApp, 'src/acquire.ts')), bundleSha256: await bundleHash(candidateApp) },
  },
  plan: plan.map(({ pair, variant }) => ({ pair, variant })),
  trials: [],
};
await writeFile(resolve(output, 'plan.json'), json(receipt));

if (preflightOnly) {
  receipt.finishedAt = new Date().toISOString();
  receipt.preflight = { passed: true, launchedOwner: false, launchedChromium: false };
  await writeFile(resolve(output, 'summary.json'), json(receipt));
  process.exit(0);
}

for (let index = 0; index < plan.length; index++) {
  const trial = plan[index];
  const name = `${String(index + 1).padStart(2, '0')}-pair-${String(trial.pair).padStart(2, '0')}-${trial.variant}`;
  const trialOutput = resolve(output, name);
  const startedAt = new Date().toISOString();
  const child = spawn(node, [controller], {
    cwd: here,
    env: { ...process.env, SNAPBACK3_TARGET_APP: trial.app, SNAPBACK3_TARGET_OUTPUT: trialOutput,
      SNAPBACK3_PORT: String(port), SNAPBACK3_REPETITIONS: '1', SNAPBACK3_PROFILE: '0', SNAPBACK3_NODE: node },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.on('error', reject); child.on('exit', resolvePromise);
  });
  let summary;
  try { summary = JSON.parse(await readFile(resolve(trialOutput, 'summary.json'), 'utf8')); } catch {}
  const expectedMode = trial.variant === 'baseline' ? 'verbatim-retained-serial-walker' : 'public-sdk-acquire';
  const observedMode = summary?.results?.[0]?.inner?.acquisition?.mode ?? null;
  const controllerSuccess = summary?.results?.[0]?.success === true;
  receipt.trials.push({ name, pair: trial.pair, variant: trial.variant, startedAt,
    finishedAt: new Date().toISOString(), exitCode, stdout, stderr,
    success: controllerSuccess && observedMode === expectedMode,
    controllerSuccess, expectedMode, observedMode,
    primaryElapsedMs: summary?.results?.[0]?.primaryElapsedMs,
    summaryPath: summary ? resolve(trialOutput, 'summary.json') : null,
    summarySha256: summary ? await fileHash(resolve(trialOutput, 'summary.json')) : null });
  await writeFile(resolve(output, 'summary.partial.json'), json(receipt));
}

const values = variant => receipt.trials.filter(trial => trial.variant === variant && trial.success)
  .map(trial => trial.primaryElapsedMs).sort((a, b) => a - b);
const median = rows => rows.length ? rows.length % 2 ? rows[(rows.length - 1) / 2]
  : (rows[rows.length / 2 - 1] + rows[rows.length / 2]) / 2 : null;
for (const variant of ['baseline', 'candidate']) {
  const rows = values(variant);
  receipt[variant] = { successful: rows.length, failed: pairs - rows.length, medianMs: median(rows),
    minMs: rows[0] ?? null, maxMs: rows.at(-1) ?? null };
}
receipt.finishedAt = new Date().toISOString();
await writeFile(resolve(output, 'summary.json'), json(receipt));
process.exitCode = receipt.trials.every(trial => trial.success) ? 0 : 1;
