#!/usr/bin/env node

// LLP 0129 Phase 2a browser-IR coverage gate runner: execute the exact,
// SHA-256-pinned LLP 0051 D5 corpus through the shipping browser IR evaluator
// inside a real system Chrome, with every normalized outcome persisted to and
// read back from IndexedDB before comparison, and emit a dated coverage
// receipt for the OQ9-designated gate.
//
// The gate's three components are reported honestly and separately:
// semantic IR coverage (carried from the dated audited assessment of the
// frozen corpus, pinned by digest — not re-audited here), exact-D5
// real-browser execution (measured here), and 100%-common-path execution
// coverage (INDETERMINATE: no frozen designated-browser-common-path mutation
// set exists; this runner refuses to invent one).
//
// @ref LLP 0129#open-questions — OQ9 (resolved 2026-08-06): Phase 2a's
//   falsifiable exit is the browser-IR-coverage gate; advancement remains
//   author-presented, so this runner records evidence and never declares exit.
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   the corpus manifest, not this runner, defines correct; drift is refusal.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';
import { replayDataTierCaseInJs } from '../conformance/data-tier/js-d5-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const RUN_DATE = '2026-08-06';
const CORPUS_DIR = join(ROOT, 'tests', 'conformance', 'data-tier');
const MANIFEST_PATH = join(CORPUS_DIR, 'corpus.manifest.json');
const PAGE_MODULE_PATH = join(here, 'browser-ir-coverage-v1-page.mjs');
const ASSESSMENT_PATH = join(
  ROOT,
  'tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md',
);
const PHASE1_RUST_RECEIPT_PATH = join(
  ROOT,
  'tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.json',
);
const RETAINED_RECEIPT_PATH = join(
  ROOT,
  `tests/acceptance/fixtures/browser-lane/browser-ir-coverage.${RUN_DATE}.v1.json`,
);
// Chrome IndexedDB initialization has failed on this fleet's macOS hosts when
// the profile lives under os.tmpdir()'s /var/folders spelling; literal /tmp is
// the proven-safe scoped workaround, and the receipt records the exact
// spelling used (issues/20260806-chrome-indexeddb-profile-macos-tmpdir.md).
const PROFILE_TEMP_ROOT = process.platform === 'darwin' ? '/tmp' : null;

const sha256Prefixed = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

// Normalization policy copied from phase1-d5-evidence.2026-08-03.v1.mjs so the
// browser-vs-Node byte comparison and the retained receipt share one spelling.
const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(out, key, {
        value: canonicalValue(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
};
const stableText = (value, spacing = 0) => JSON.stringify(canonicalValue(value), null, spacing);
const normalizeOutcome = (outcome) => {
  const normalized = canonicalValue(outcome);
  for (const rows of Object.values(normalized.rows ?? {})) {
    rows.sort((left, right) => {
      const a = stableText(left);
      const b = stableText(right);
      return a === b ? 0 : a < b ? -1 : 1;
    });
  }
  return normalized;
};

const GATE_DEFINITION = {
  authority: [
    'llp/0129-local-first-program.plan.md §Open questions 9 (RESOLVED 2026-08-06, Charlie Cheever)',
    'tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md §5 Option B',
  ],
  oq9Verbatim:
    'Phase 2a’s falsifiable exit is therefore the browser-IR-coverage gate '
    + '(assessment exit option 2): ≥90% semantic IR coverage of the versioned '
    + 'reference-app durable-mutation corpus plus 100% execution coverage for the '
    + 'designated browser common-path mutations, proven by generated artifacts under '
    + 'a real-browser IndexedDB acceptance run with exact LLP 0051 D5 results.',
  optionBPassVerbatim:
    '(1) at least 90% of the frozen corpus is semantically IR-expressible; '
    + '(2) 100% of mutations designated browser common-path carry a generated local '
    + 'artifact and complete the real-browser suite; (3) D5 is exact on both '
    + 'evaluators; and (4) every remainder is explicitly server-only or '
    + 'offline-nonclaim, with no common-path remainder requiring a general runtime.',
  semanticCoverageDefinitionVerbatim:
    'IR-expressible: the closed v1 plan grammar can represent the semantics and '
    + 'evaluateBrowserIrPlanV1 can execute the resulting data. '
    + '(Denominator: the 13 durable mutations frozen as LLP 0051’s measured demo corpus.)',
};

const options = {
  browser: process.env.CHROME_PATH ?? process.env.SNAPBACK_BROWSER_EXECUTABLE ?? null,
  headed: false,
  dryRun: false,
  retain: false,
  receipt: null,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--browser') options.browser = process.argv[++index];
  else if (arg === '--headed') options.headed = true;
  else if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--retain') options.retain = true;
  else if (arg === '--receipt') options.receipt = resolve(process.argv[++index]);
  else fail('SNAPBACK_BROWSER_IR_COVERAGE_USAGE', `unknown argument: ${arg}`);
}

function resolveChrome() {
  if (options.browser) {
    if (!existsSync(options.browser)) {
      fail('SNAPBACK_BROWSER_IR_COVERAGE_BROWSER_NOT_FOUND', `browser executable missing: ${options.browser}`);
    }
    return resolve(options.browser);
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : process.platform === 'linux'
      ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      : [];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    fail(
      'SNAPBACK_BROWSER_IR_COVERAGE_BROWSER_NOT_FOUND',
      'no system Chrome-family browser found; pass --browser or set SNAPBACK_BROWSER_EXECUTABLE',
    );
  }
  return found;
}

async function verifyCorpus() {
  const manifestRaw = await readFile(MANIFEST_PATH);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  if (manifest.cases.length !== 37) {
    fail('SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT', `expected the complete 37-case v1 corpus, found ${manifest.cases.length}`);
  }
  const manifestPaths = new Set(manifest.cases.map((entry) => entry.path));
  const onDisk = (await readdir(CORPUS_DIR)).filter((name) => name.endsWith('.case.json'));
  for (const name of onDisk) {
    if (!manifestPaths.has(name)) {
      fail('SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT', `unmanifested case file present: ${name}`);
    }
  }
  const cases = [];
  for (const entry of manifest.cases) {
    const raw = await readFile(join(CORPUS_DIR, entry.path));
    const digest = sha256Prefixed(raw);
    if (digest !== entry.sha256) {
      fail(
        'SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT',
        `${entry.name}: case bytes drifted from the pinned manifest digest (${digest} != ${entry.sha256})`,
      );
    }
    const text = raw.toString('utf8');
    if (text.includes('$ANY_')) {
      fail('SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT', `${entry.name}: nondeterministic placeholder present`);
    }
    const testCase = JSON.parse(text);
    if (!testCase.ctxLedger) {
      fail('SNAPBACK_BROWSER_IR_COVERAGE_CORPUS_DRIFT', `${entry.name}: exact ctx ledger is absent`);
    }
    cases.push({ entry, testCase });
  }
  return { manifestRaw, manifest, cases };
}

async function bundlePage() {
  const result = await build({
    entryPoints: [PAGE_MODULE_PATH],
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  return result.outputFiles[0].contents;
}

async function startHarnessServer(bundle) {
  const html = Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"><title>browser-ir-coverage</title></head>'
    + '<body><p id="status">browser-ir-coverage</p>'
    + '<script type="module" src="/bundle.mjs"></script></body></html>',
  );
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/' || pathname === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    if (pathname === '/bundle.mjs') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(bundle);
      return;
    }
    response.writeHead(404).end('not found');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    fail('SNAPBACK_BROWSER_IR_COVERAGE_SERVER_BIND', 'harness server did not bind TCP');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => server.close(
      (error) => (error ? rejectClose(error) : resolveClose()),
    )),
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const entry = settle(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connect failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectResult(new Error(`CDP command timed out: ${method}`));
      }, 60_000);
      pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    });
  };
  return {
    close: () => socket.close(),
    async newPage(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Page.navigate', { url }, sessionId);
      const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId);
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
      };
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (await evaluate("typeof globalThis.snapbackBrowserIrCoverage === 'object'")) break;
        await sleep(100);
      }
      if (!await evaluate("typeof globalThis.snapbackBrowserIrCoverage === 'object'")) {
        fail('SNAPBACK_BROWSER_IR_COVERAGE_PAGE_NOT_READY', 'browser harness page did not become ready');
      }
      return {
        eval: evaluate,
        call(method, argumentJson) {
          const argument = argumentJson === undefined
            ? ''
            : `JSON.parse(${JSON.stringify(argumentJson)})`;
          return evaluate(`globalThis.snapbackBrowserIrCoverage[${JSON.stringify(method)}](${argument})`);
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
  };
}

const { manifestRaw, manifest, cases } = await verifyCorpus();
const manifestSha256 = sha256Prefixed(manifestRaw);
const bundle = await bundlePage();
const { version: esbuildVersion } = await import('esbuild');

const sourcePaths = [
  'tests/acceptance/browser-ir-coverage-v1.mjs',
  'tests/acceptance/browser-ir-coverage-v1-page.mjs',
  'tests/conformance/data-tier/js-d5-harness.mjs',
  'packages/snapback-client/ir-evaluator.mjs',
  'packages/snapback-contract/derived-overlay.mjs',
  'packages/snapback-contract/index.mjs',
];
const sourceHashes = {};
for (const path of sourcePaths) {
  sourceHashes[path] = sha256Prefixed(await readFile(join(ROOT, path)));
}
const assessmentSha256 = sha256Prefixed(await readFile(ASSESSMENT_PATH));

let rustChain;
try {
  const phase1 = JSON.parse(await readFile(PHASE1_RUST_RECEIPT_PATH, 'utf8'));
  rustChain = phase1?.corpus?.manifestSha256 === manifestSha256
    ? {
        status: 'chained',
        receipt: 'tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.json',
        statement:
          'The retained Phase-1 receipt pins Rust-host == JS outcomes for this exact corpus manifest '
          + 'digest, so browser == Node == Rust follows from manifest identity.',
        baseRevision: phase1.baseRevision ?? null,
      }
    : {
        status: 'unchained',
        reason: 'corpus manifest digest differs from the retained Phase-1 Rust receipt',
      };
} catch {
  rustChain = { status: 'unchained', reason: 'Phase-1 Rust receipt unreadable' };
}

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: 'dry-run',
    cases: cases.length,
    manifestSha256,
    bundleSha256: sha256Prefixed(bundle),
    bundleBytes: bundle.length,
    esbuild: esbuildVersion,
    rustChain: rustChain.status,
  })}\n`);
  process.exit(0);
}

const browserExecutable = resolveChrome();
const browserVersion = execFileSync(browserExecutable, ['--version'], { encoding: 'utf8' }).trim();
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const gitDirty = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
const databaseName = `snapback-browser-ir-coverage-${randomUUID()}`;

const receipt = {
  schemaVersion: 'snapback.browser-ir-coverage-receipt.v1',
  runDate: RUN_DATE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  gateDefinition: GATE_DEFINITION,
  evidenceClass: 'standards-real-browser-process-indexeddb-round-trip-d5-replay',
  source: {
    gitCommit,
    gitDirty,
    gitDirtyNote: gitDirty
      ? 'The gate run is produced from the uncommitted gate worktree by design; exact executed bytes are bound by the source hashes below.'
      : null,
    hashes: sourceHashes,
    bundleSha256: sha256Prefixed(bundle),
    bundleBytes: bundle.length,
    esbuild: esbuildVersion,
    node: process.version,
    assessment: {
      path: 'tests/acceptance/fixtures/browser-lane/wasm-assessment.2026-08-05.v1.md',
      sha256: assessmentSha256,
    },
  },
  corpus: {
    manifestPath: 'tests/conformance/data-tier/corpus.manifest.json',
    manifestSha256,
    corpus: manifest.corpus,
    cases: manifest.cases.length,
    profileVersion: manifest.profileVersion,
    corpusFormatVersion: manifest.corpusFormatVersion,
    ledgerVersion: manifest.ledgerVersion,
  },
  browser: {
    executable: browserExecutable,
    executableSha256: sha256Prefixed(await readFile(browserExecutable)),
    version: browserVersion,
    automation: 'raw-cdp-over-node-websocket',
    userAgent: null,
  },
  carrier: {
    implementation: 'indexeddb-per-case-persist-and-read-back',
    databaseName,
    databaseDeleted: false,
    profileTempRoot: PROFILE_TEMP_ROOT ?? 'os-default',
    profilePathSpelling: null,
    profileNote:
      'Profile placed under literal /tmp on macOS per the scoped workaround in '
      + 'issues/20260806-chrome-indexeddb-profile-macos-tmpdir.md.',
  },
  cases: [],
  gate: null,
  cleanup: {
    browserStopped: false,
    profileRemoved: false,
    harnessServerClosed: false,
  },
  nonclaims: [
    'No Parity, capability, store, settlement, React presentation, or phase-advancement claim: per LLP 0129 advancement is author-presented and none is declared here.',
    'Semantic IR coverage is carried from the dated audited assessment classification of the frozen 13-mutation corpus, pinned by digest; this runner does not re-audit demo sources.',
    'The plan-shape M1 admission counts over the D5 conformance cases are evidence only; they are NOT the gate’s common-path metric, whose designated mutation set is unfrozen.',
  ],
};

let profilePath = null;
let lifecycle = null;
let cdp = null;
let harness = null;
let failure = null;

try {
  if (PROFILE_TEMP_ROOT !== null) await mkdir(PROFILE_TEMP_ROOT, { recursive: true });
  profilePath = await mkdtemp(join(PROFILE_TEMP_ROOT ?? (await import('node:os')).tmpdir(), 'snapback-browser-ir-coverage-'));
  receipt.carrier.profilePathSpelling = profilePath;

  harness = await startHarnessServer(bundle);
  lifecycle = await launchChromeCdp({
    chromeBin: browserExecutable,
    userDataDir: profilePath,
    headless: !options.headed,
    stopSignal: 'SIGTERM',
    startupTimeoutMs: 20_000,
    pollMs: 50,
    extraArgs: [
      '--remote-allow-origins=*',
      '--disable-background-networking',
      '--disable-component-update',
    ],
  });
  cdp = await connectCdp(lifecycle.ws);
  const page = await cdp.newPage(`${harness.origin}/?database=${encodeURIComponent(databaseName)}`);

  const facts = await page.call('envFacts');
  if (facts?.indexedDb !== true) {
    fail('SNAPBACK_BROWSER_IR_COVERAGE_NO_INDEXEDDB', 'browser page does not expose real IndexedDB');
  }
  receipt.browser.userAgent = facts.userAgent ?? null;

  for (const { entry, testCase } of cases) {
    const browserResult = await page.call('runCase', JSON.stringify(testCase));
    const nodeOutcomeText = stableText(normalizeOutcome(replayDataTierCaseInJs(testCase)));
    const browserVsNodeExact = browserResult.normalizedOutcomeText === nodeOutcomeText;
    receipt.cases.push({
      name: entry.name,
      sha256: entry.sha256,
      verdict: browserResult.verdict,
      failureDetail: browserResult.failureDetail,
      admission: browserResult.admission,
      browserVsNodeExact,
      indexedDb: browserResult.indexedDb,
      normalizedOutcomeSha256: sha256Prefixed(browserResult.normalizedOutcomeText),
    });
  }

  const cleanupFacts = await page.call('cleanup');
  receipt.carrier.databaseDeleted = cleanupFacts?.databaseDeleted === true;
  await page.close();
} catch (error) {
  failure = error;
} finally {
  if (cdp !== null) {
    try {
      cdp.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (lifecycle !== null) {
    try {
      await lifecycle.stop();
      receipt.cleanup.browserStopped = true;
    } catch (error) {
      failure ??= error;
    }
  }
  if (harness !== null) {
    try {
      await harness.close();
      receipt.cleanup.harnessServerClosed = true;
    } catch (error) {
      failure ??= error;
    }
  }
  if (profilePath !== null) {
    try {
      await rm(profilePath, { recursive: true, force: true });
      receipt.cleanup.profileRemoved = !existsSync(profilePath);
    } catch (error) {
      failure ??= error;
    }
  }
}

const total = receipt.cases.length;
const passed = receipt.cases.filter(({ verdict }) => verdict === 'PASS').length;
const failedCases = receipt.cases.filter(({ verdict }) => verdict !== 'PASS').map(({ name }) => name);
const browserVsNodeAllExact = total > 0 && receipt.cases.every(({ browserVsNodeExact }) => browserVsNodeExact);
const admissionCounts = {};
for (const { admission } of receipt.cases) {
  const key = admission?.classification ?? 'unknown';
  admissionCounts[key] = (admissionCounts[key] ?? 0) + 1;
}
const d5Complete = failure === null && total === 37;
const d5Result = d5Complete && passed === 37 && browserVsNodeAllExact ? 'PASS' : 'FAIL';

receipt.gate = {
  semanticIrCoverage: {
    definitionVerbatim: GATE_DEFINITION.semanticCoverageDefinitionVerbatim,
    numerator: 12,
    denominator: 13,
    percent: 92.3,
    threshold: '>=90%',
    result: 'PASS',
    basis:
      'Carried from the dated audited assessment classification of the frozen LLP 0051 corpus '
      + '(wasm-assessment.2026-08-05.v1.md §1, pinned by sha256 above); not re-audited by this runner.',
  },
  d5RealBrowserExactness: {
    threshold: 'exact normalized outcomes for all 37 pinned cases, compared after IndexedDB read-back',
    total,
    passed,
    failed: failedCases,
    browserVsNodeExact: browserVsNodeAllExact,
    indexedDbRoundTrip: receipt.cases.every(({ indexedDb }) => indexedDb?.readBack === true),
    rustChain,
    result: d5Result,
  },
  commonPathExecution: {
    threshold: '100% of designated browser common-path mutations carry a generated local artifact and complete the real-browser suite',
    result: 'INDETERMINATE',
    reason:
      'No frozen designated-browser-common-path mutation set exists in the repository. The assessment’s '
      + 'Option B locates that designation act in tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json, '
      + 'which has not been created, and no dated ruling freezes a mutation subset. The designation is '
      + 'author-owned; measuring this axis against an invented set would not be falsifiable against the '
      + 'author’s chosen wording. Ticketed: issues/20260806-phase2a-common-path-designation-absent.md.',
    evidence: {
      planShapeAdmissionCounts: admissionCounts,
      label:
        'classifyLocalMutationIrV1 plan-shape classification of the D5 conformance cases under the '
        + 'M1 Insert/Get/Guard/Patch ceiling — evidence only, NOT the gate metric.',
    },
  },
  overall: d5Result === 'FAIL'
    ? {
        result: 'FAIL',
        detail: 'A measured component is below threshold: the exact-D5 real-browser component did not pass.',
      }
    : {
        result: 'NOT-DECLARABLE',
        detail:
          'Two of three components are measured or carried and pass (semantic 92.3% >= 90%; exact D5 in the '
          + 'real browser). The 100%-common-path component cannot be measured until the author freezes the '
          + 'designated browser-common-path mutation set, so no whole-gate PASS is declared.',
      },
};

receipt.finishedAt = new Date().toISOString();
receipt.ok = failure === null
  && d5Result === 'PASS'
  && receipt.carrier.databaseDeleted === true
  && receipt.cleanup.browserStopped === true
  && receipt.cleanup.profileRemoved === true
  && receipt.cleanup.harnessServerClosed === true;
if (failure !== null) receipt.error = String(failure?.stack ?? failure);

const receiptPath = options.receipt
  ?? (options.retain
    ? RETAINED_RECEIPT_PATH
    : join(PROFILE_TEMP_ROOT ?? '.', `snapback-browser-ir-coverage-scratch-${RUN_DATE}.json`));
await mkdir(dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${stableText(receipt, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  ok: receipt.ok,
  cases: total,
  passed,
  failed: failedCases,
  browserVsNodeExact: browserVsNodeAllExact,
  semanticCoverage: '12/13=92.3%',
  commonPath: 'INDETERMINATE',
  overall: receipt.gate.overall.result,
  browser: browserVersion,
  receipt: receiptPath,
})}\n`);
if (failure !== null || d5Result !== 'PASS') process.exitCode = 1;
