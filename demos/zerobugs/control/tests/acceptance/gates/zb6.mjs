import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';

import {
  CONTROL_ROOT,
  PLAN_PATH,
  REPO_ROOT,
  actorIdentityFromLaneReceipts,
  buildGateReceiptFields,
  loadGateContext,
} from '../gate-support.mjs';
import {sha256File, validateReceipt} from '../receipt.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb6--authoring-and-diagnostics — chronology, assistance,
// workaround burden, stable codes, facts, refusals, and gaps stay inspectable.

export const CHECK_IDS = Object.freeze([
  'gate-definition-and-receipt-assembly',
  'chronological-assistance-and-failed-path-sources-resolve',
  'landed-gate-receipts-are-valid-immutable-attempts',
  'failed-attempt-remediation-trail-is-preserved',
  'workaround-register-rows-remain-declared',
  'workaround-register-file-line-spans-resolve',
  'workaround-register-source-provider-line-counts',
  'authored-source-accounting-is-separated-by-class',
  'guide-use-pages-resolve-and-are-current',
  'guide-gap-findings-remain-visible',
  'stable-snapback-diagnostics-observed-in-landed-receipts',
  'stable-zbugs-diagnostics-observed-in-landed-receipts',
  'capability-facts-aggregate-without-parity-boolean',
  'refusal-facts-aggregate-as-closed-evidence',
  'static-gate-created-no-owned-runtime-resources',
  'guide-gap-tickets-filed',
  'cross-arm-authoring-delta',
]);

const EVIDENCE_PATHS = Object.freeze([
  'demos/zerobugs/evidence/snapback-control.zb0.v1.json',
  'demos/zerobugs/evidence/snapback-control.zb1.v1.json',
  'demos/zerobugs/evidence/snapback-control.zb2.v1.json',
  'demos/zerobugs/evidence/snapback-control.zb3.v1.json',
  'demos/zerobugs/evidence/snapback-control.zb3.v2.json',
  'demos/zerobugs/evidence/snapback-control.zb4.v1.json',
  'demos/zerobugs/evidence/snapback-control.zb4.v2.json',
]);

const GUIDE_PAGES = Object.freeze([
  'guide/index.md',
  'guide/testing/acceptance.md',
  'guide/auth/sessions-and-principals.md',
  'guide/realtime/live-queries.md',
  'guide/backend/mutations.md',
  'guide/backend/actions-and-fetch.md',
  'guide/backend/assets.md',
  'guide/operating/network-profiles.md',
  'guide/operating/diagnostics.md',
]);

const PLAN_FILE = 'demos/zerobugs/control/PLAN.md';

const CHRONOLOGY = Object.freeze([
  {
    sequence: 1,
    date: '2026-08-05',
    kind: 'failed-path',
    result: 'Initial offline install/codegen path failed, then the exact local package set resolved and static generation passed.',
    source: {file: PLAN_FILE, section: 'Validation record for this scaffold'},
  },
  {
    sequence: 2,
    date: '2026-08-05',
    kind: 'failed-path',
    result: 'The complete seed hit SNAPBACK_SEED_EFFECT_LIMIT; no row was omitted and bounded ordinary ingestion was chosen.',
    source: {file: PLAN_FILE, section: 'Lane 1 validation'},
  },
  {
    sequence: 3,
    date: '2026-08-05',
    kind: 'environment-refusal',
    result: 'The sandbox refused loopback bind; cleanup removed the owned namespace and the live step moved to the supervisor.',
    source: {file: PLAN_FILE, section: 'Lane 1 continuation — bounded fixture ingestion'},
  },
  {
    sequence: 4,
    date: '2026-08-05',
    kind: 'failed-path',
    result: 'The first supervised load exposed 16 KiB JS string truncation after all counts passed; the runtime defect was filed and fixed.',
    source: {file: PLAN_FILE, section: 'Lane 1 continuation — live load outside the sandbox'},
  },
  {
    sequence: 5,
    date: '2026-08-05',
    kind: 'live-proof',
    result: 'The repaired runtime loaded all 3,758 rows and matched the frozen overall digest.',
    source: {file: PLAN_FILE, section: 'Lane 1 completion — live load PASS on the repaired runtime'},
  },
  {
    sequence: 6,
    date: '2026-08-05',
    kind: 'live-proof',
    result: 'The five bound actors plus anonymous/attacker transitions passed 9/9.',
    source: {file: PLAN_FILE, section: 'Lane 2 completion — live actor harness PASS'},
  },
  {
    sequence: 7,
    date: '2026-08-06',
    kind: 'rejected-path',
    result: 'Runtime admission rejected route-cut groups for opaque JS queries; the route manifest was removed and W-QGROUP retained.',
    source: {file: PLAN_FILE, section: 'Lane 3 amendment — route-cut query groups unavailable to JS queries'},
  },
  {
    sequence: 8,
    date: '2026-08-06',
    kind: 'supervisor-correction',
    result: 'The 16/16 query run found readiness settling and an anonymous-public auth-body defect, then passed after repair.',
    source: {file: PLAN_FILE, section: 'Lane 3 completion — live parity harness PASS'},
  },
  {
    sequence: 9,
    date: '2026-08-06',
    kind: 'supervisor-correction',
    result: 'The 18/18 mutation run corrected generic runtime id prefixes and absent rather than null generated IR fields.',
    source: {file: PLAN_FILE, section: 'Lane 4 completion — live mutation corpus PASS'},
  },
  {
    sequence: 10,
    date: '2026-08-06',
    kind: 'supervisor-correction',
    result: 'The 16/16 composition run fixed config-before-data ordering and the host.fetch result contract, retaining all five corrections.',
    source: {file: PLAN_FILE, section: 'Lane 5 completion — live gateway/effects harness PASS'},
  },
  {
    sequence: 11,
    date: '2026-08-06',
    kind: 'live-proof',
    result: 'The typed adapter/window/session smoke passed 6/6.',
    source: {file: PLAN_FILE, section: 'Lane 6a completion — live adapter/controller smoke PASS'},
  },
  {
    sequence: 12,
    date: '2026-08-06',
    kind: 'supervisor-correction',
    result: 'The browser handoff adopted the supported one-use email-code exchange and the short /tmp Chrome profile root.',
    source: {file: PLAN_FILE, section: 'Lane 6b live continuation: session handoff and supervisor corrections'},
  },
  {
    sequence: 13,
    date: '2026-08-06',
    kind: 'failed-path',
    result: 'Two inconsistent browser runs exposed session/window generation races; singleton ownership and authority-axis fencing closed them.',
    source: {file: PLAN_FILE, section: 'Lane 6b live continuation: auth/window race closure'},
  },
  {
    sequence: 14,
    date: '2026-08-06',
    kind: 'failed-path',
    result: 'A full reload proved memory custody was wrong; the control switched to shipped IndexedDB/Web Locks custody.',
    source: {file: PLAN_FILE, section: 'Lane 6b live continuation: authenticated reload custody'},
  },
  {
    sequence: 15,
    date: '2026-08-06',
    kind: 'live-proof',
    result: 'Lane 6b passed 12/12 after the shipped auth deadlock, control render loop, and permalink re-arm defects were explained and fixed.',
    source: {file: PLAN_FILE, section: 'Lane 6b live status — PASS (12/12, 2026-08-06)'},
  },
  {
    sequence: 16,
    date: '2026-08-06',
    kind: 'gate-attempt',
    result: 'ZB0 v1 passed 9 checks.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[0], section: 'checks.rows'},
  },
  {
    sequence: 17,
    date: '2026-08-06',
    kind: 'gate-attempt',
    result: 'ZB1 v1 retained one D2 query-group GAP.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[1], section: 'checks.rows'},
  },
  {
    sequence: 18,
    date: '2026-08-06',
    kind: 'gate-attempt',
    result: 'ZB2 v1 retained 39 explicit retention/offline/custody GAPs and passed three honesty checks.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[2], section: 'checks.rows'},
  },
  {
    sequence: 19,
    date: '2026-08-06',
    kind: 'failed-gate-attempt',
    result: 'ZB3 v1 failed on frozen-name/generated-identity lookup and guessed Lane 4 ordering; the immutable attempt remains.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[3], section: 'diagnostics'},
  },
  {
    sequence: 20,
    date: '2026-08-06',
    kind: 'remediation-attempt',
    result: 'ZB3 v2 passed 26 checks and retained two unsupported queued-intent GAPs.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[4], section: 'checks.rows'},
  },
  {
    sequence: 21,
    date: '2026-08-06',
    kind: 'failed-gate-attempt',
    result: 'ZB4 v1 incorrectly expected value-free config status to refuse untrusted reads; the immutable attempt remains.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[5], section: 'diagnostics'},
  },
  {
    sequence: 22,
    date: '2026-08-06',
    kind: 'remediation-attempt',
    result: 'ZB4 v2 passed 26 checks, retained four unavailable carrier/policy-transition GAPs, and pinned the config contract.',
    source: {file: PLAN_FILE, section: 'Lane F live status — ZB0–ZB4 receipts landed (2026-08-06); ZB5–ZB7 pending'},
    evidence: {file: EVIDENCE_PATHS[6], section: 'checks.rows'},
  },
]);

function fileSpec(path, spans = [], options = {}) {
  return Object.freeze({path, spans: Object.freeze(spans), complete: spans.length === 0, ...options});
}

const NORMAL_FIXTURE_FILES = Object.freeze([
  'comment.json', 'emoji.json', 'fixture.json', 'identityBinding.json',
  'issue.json', 'issueLabel.json', 'issueLabelRead.json', 'issueListRead.json',
  'issueNotifications.json', 'issueSearchDocument.json', 'label.json',
  'project.json', 'projectUserRead.json', 'searchEpoch.json', 'user.json',
  'userPref.json', 'viewState.json',
].map(name => fileSpec(`fixtures/normal-seed-v1/${name}`, [], {
  planToken: 'fixtures/normal-seed-v1/*.json',
})));

const WORKAROUND_REGISTER = Object.freeze([
  {
    id: 'W-QGROUP',
    files: [
      fileSpec('snapback/functions.mjs', [[2322, 2439], [2552, 2736], [2922, 3379]]),
      fileSpec('tests/lane3-list-engine.test.mts', [[153, 175]]),
    ],
  },
  {
    id: 'W-READMODEL',
    files: [
      fileSpec('snapback/schema.mjs', [[158, 233]]),
      fileSpec('scripts/build-fixture.mts', [[511, 643]]),
      ...['projectUserRead.json', 'issueListRead.json', 'issueLabelRead.json', 'issueSearchDocument.json'].map(name => (
        fileSpec(`fixtures/normal-seed-v1/${name}`, [], {
          planToken: 'fixtures/normal-seed-v1/{projectUserRead,issueListRead,issueLabelRead,issueSearchDocument}.json',
        })
      )),
      fileSpec('snapback/functions.mjs', [[600, 732], [882, 1672], [2322, 2736], [2999, 3674]]),
      fileSpec('tests/lane3-oracle.mts', [[1, 164]]),
      fileSpec('tests/lane3-list-engine.test.mts', [[1, 354]]),
      fileSpec('tests/acceptance/lane3-live.mts', [[1, 781]]),
    ],
  },
  {
    id: 'W-MANUALSET',
    files: [
      fileSpec('snapback/functions.mjs', [[2255, 2439], [2441, 2736], [2760, 3674]]),
      fileSpec('tests/lane3-oracle.mts', [[1, 164]]),
      fileSpec('tests/lane3-list-engine.test.mts', [[1, 354]]),
      fileSpec('tests/acceptance/lane3-live.mts', [[1, 781]]),
    ],
  },
  {
    id: 'W-SEARCH-EPOCH',
    files: [
      fileSpec('snapback/schema.mjs', [[235, 245]]),
      fileSpec('scripts/build-fixture.mts', [[625, 635]]),
      fileSpec('fixtures/normal-seed-v1/searchEpoch.json', [[1, 14]]),
      fileSpec('snapback/functions.mjs', [[622, 666], [882, 1672], [2505, 2736], [3394, 3469]]),
      fileSpec('tests/lane3-oracle.mts', [[91, 149]]),
      fileSpec('tests/lane3-list-engine.test.mts', [[176, 258]]),
      fileSpec('tests/acceptance/lane3-live.mts', [[359, 422]]),
    ],
  },
  {
    id: 'W-MUTATION-IR',
    files: [
      fileSpec('snapback/functions.mjs', [[443, 839], [1172, 1213], [1476, 1509]]),
      fileSpec('tests/acceptance/lane4-live.mts', [[456, 475]]),
    ],
  },
  {
    id: 'W-REDUCER',
    files: [
      fileSpec('snapback/functions.mjs', [[443, 1672]]),
      fileSpec('src/data/mutations.ts', [[21, 106], [137, 623], [699, 840]]),
      fileSpec('tests/lane6a-mutations.test.mts', [[1, 190]]),
      fileSpec('tests/acceptance/lane6a-live.mts', [[174, 231]]),
    ],
  },
  {
    id: 'W-PENDING',
    files: [
      fileSpec('src/data/mutations.ts', [[54, 65], [155, 170], [589, 645], [724, 806]]),
      fileSpec('tests/lane6a-mutations.test.mts', [[149, 169]]),
      fileSpec('tests/acceptance/lane6a-live.mts', [[215, 231]]),
    ],
  },
  {
    id: 'W-WINDOW',
    files: [
      fileSpec('src/windowing/controller.ts', [[1, 651]]),
      fileSpec('src/windowing/use-window.ts', [[1, 57]]),
      fileSpec('src/windowing/history-state.ts', [[1, 99]]),
      fileSpec('tests/lane6a-window.test.mts', [[1, 226]]),
      fileSpec('tests/acceptance/lane6a-live.mts', [[136, 170]]),
    ],
  },
  {
    id: 'W-IDENTITY',
    files: [
      fileSpec('snapback/schema.mjs', [[144, 156]]),
      fileSpec('snapback/functions.mjs', [[56, 152], [212, 440]]),
      fileSpec('scripts/bind-actors.mts', [[9, 235]]),
      fileSpec('tests/lane2-functions.test.mts', [[123, 254]]),
      fileSpec('tests/acceptance/lane2-live.mts', [[46, 222]]),
      fileSpec('fixtures/normal-seed-v1/fixture.json', [[7, 33]]),
      fileSpec('tests/fixtures/fixture-digests.json', [[20, 46]]),
    ],
  },
  {
    id: 'C-GATEWAY',
    files: [
      fileSpec('composition/zerobugs-control-composition.v1.json', [[1, 145]]),
      fileSpec('composition/server.mts', [[1, 807]]),
      fileSpec('snapback/functions.mjs', [[3776, 3865]]),
      ...['envelopes.mts', 'markdown.mts', 'tokens.mts'].map(name => fileSpec(`composition/lib/${name}`, [], {
        planToken: 'composition/lib/{envelopes,markdown,tokens}.mts',
      })),
      ...['tests/lane5-envelope.test.mts', 'tests/lane5-token.test.mts'].map(path => fileSpec(path, [], {
        planToken: 'tests/lane5-{envelope,token}.test.mts',
      })),
      fileSpec('tests/acceptance/lane5-live.mts', [[312, 511], [639, 681], [812, 824]]),
    ],
  },
  {
    id: 'C-NOTIFY',
    files: [
      fileSpec('snapback/schema.mjs', [[247, 292]]),
      fileSpec('snapback/functions.mjs', [[449, 849], [908, 1569], [4065, 4295]]),
      ...['deliver.mts', 'payloads.mts'].map(name => fileSpec(`composition/effects/${name}`, [], {
        planToken: 'composition/effects/{deliver,payloads}.mts',
      })),
      fileSpec('tests/lane5-payload.test.mts'),
      fileSpec('tests/acceptance/lane5-live.mts', [[512, 638], [762, 811]]),
    ],
  },
  {
    id: 'C-ASSET',
    files: [
      fileSpec('snapback/schema.mjs', [[306, 326]]),
      fileSpec('snapback/functions.mjs', [[3866, 4022]]),
      fileSpec('composition/server.mts', [[540, 671]]),
      fileSpec('tests/acceptance/lane5-live.mts', [[682, 761]]),
    ],
  },
  {
    id: 'W-FIXTURE',
    files: [
      fileSpec('scripts/build-fixture.mts', [[1, 1115]]),
      fileSpec('scripts/load-fixture.mts', [[14, 342]]),
      fileSpec('snapback/functions.mjs', [[12, 274], [239, 256], [258, 275]]),
      fileSpec('tests/fixture-loader.test.mts', [[1, 153]]),
      ...NORMAL_FIXTURE_FILES,
      fileSpec('fixtures/policy-extension-v1.json', [[1, 162]]),
      fileSpec('tests/fixtures/fixture-digests.json', [[1, 181]]),
    ],
  },
  {
    id: 'W-ENUM',
    files: [
      fileSpec('scripts/build-fixture.mts', [[190, 203], [645, 742], [758, 784], [811, 865]]),
      fileSpec('snapback/functions.mjs', [[62, 90], [449, 481], [560, 590], [600, 632], [652, 666], [812, 839], [882, 1541]]),
      fileSpec('snapback/schema.mjs', [[16, 20], [51, 54]]),
    ],
  },
  {
    id: 'W-SHORTID',
    files: [
      fileSpec('snapback/functions.mjs', [[493, 509], [882, 941]]),
      fileSpec('tests/lane4-oracle.mts', [[131, 138], [353, 361]]),
      fileSpec('tests/lane4-domain.test.mts', [[106, 125]]),
    ],
  },
]);

function repoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

function physicalLineCount(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/u);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function fileClass(path) {
  if (path.startsWith('tests/')) return 'witness';
  if (path.startsWith('fixtures/')) return 'fixture';
  return 'provider-source';
}

function mergedSpanLines(spans) {
  const sorted = spans.map(([start, end]) => [start, end]).sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const tail = merged.at(-1);
    if (!tail || start > tail[1] + 1) merged.push([start, end]);
    else tail[1] = Math.max(tail[1], end);
  }
  return merged.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

function registerPlanRow(planText, id) {
  const row = planText.split(/\r?\n/u).find(line => line.startsWith(`| \`${id}\``));
  assert(row, `PLAN workaround row ${id} exists`);
  return row;
}

async function resolveWorkaroundRegister(planText) {
  const results = [];
  for (const entry of WORKAROUND_REGISTER) {
    const row = registerPlanRow(planText, entry.id);
    assert(!row.includes('TBD-before-use'), `${entry.id} has no unresolved marker`);
    const perPath = new Map();
    for (const spec of entry.files) {
      const token = spec.planToken ?? spec.path;
      assert(row.includes(token), `${entry.id} PLAN row still names ${token}`);
      for (const [start, end] of spec.spans) {
        assert(row.includes(`${start}-${end}`), `${entry.id} PLAN row still names ${start}-${end}`);
        assert(Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start);
      }
      const current = perPath.get(spec.path) ?? {spans: [], complete: false};
      current.spans.push(...spec.spans);
      current.complete ||= spec.complete;
      perPath.set(spec.path, current);
    }
    const files = [];
    for (const [path, spec] of perPath) {
      const absolute = join(CONTROL_ROOT, path);
      const text = await readFile(absolute, 'utf8');
      const physicalLines = physicalLineCount(text);
      for (const [start, end] of spec.spans) {
        assert(end <= physicalLines, `${entry.id} ${path}:${start}-${end} exceeds ${physicalLines} lines`);
      }
      files.push({
        path,
        class: fileClass(path),
        physicalLines,
        declaredSpans: spec.spans.map(([start, end]) => `${start}-${end}`),
        countedLines: spec.complete ? physicalLines : mergedSpanLines(spec.spans),
        completeFile: spec.complete,
      });
    }
    const count = kind => files.filter(file => file.class === kind).reduce((sum, file) => sum + file.countedLines, 0);
    results.push({
      id: entry.id,
      status: 'retained-control-workaround-or-component',
      namedFiles: files.length,
      providerSourceLines: count('provider-source'),
      witnessLines: count('witness'),
      fixtureLines: count('fixture'),
      declaredLines: files.reduce((sum, file) => sum + file.countedLines, 0),
      files,
    });
  }
  return results;
}

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((candidate, key) => candidate?.[key], value);
}

function markdownSection(text, section) {
  const lines = text.split(/\r?\n/u);
  const index = lines.findIndex(line => /^#{2,5}\s+/u.test(line) && line.replace(/^#{2,5}\s+/u, '').trim() === section);
  assert.notEqual(index, -1, `markdown section ${section} exists`);
  const level = /^#+/u.exec(lines[index])[0].length;
  let end = lines.length;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const match = /^(#+)\s+/u.exec(lines[cursor]);
    if (match && match[1].length <= level) {
      end = cursor;
      break;
    }
  }
  return lines.slice(index, end).join('\n');
}

async function validateChronologySources() {
  let previous = 0;
  for (const row of CHRONOLOGY) {
    assert.equal(row.sequence, previous + 1);
    previous = row.sequence;
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(row.date), `chronology row ${row.sequence} has a source-backed date`);
    const sourceText = await readFile(join(REPO_ROOT, row.source.file), 'utf8');
    assert(markdownSection(sourceText, row.source.section).length > 0);
    if (row.evidence) {
      const evidence = JSON.parse(await readFile(join(REPO_ROOT, row.evidence.file), 'utf8'));
      assert.notEqual(getPath(evidence, row.evidence.section), undefined, `${row.evidence.file}#${row.evidence.section}`);
    }
  }
}

async function loadEvidenceReceipts() {
  return await Promise.all(EVIDENCE_PATHS.map(async path => {
    const absolute = join(REPO_ROOT, path);
    const [text, sha256] = await Promise.all([
      readFile(absolute, 'utf8'),
      sha256File(absolute),
    ]);
    const receipt = JSON.parse(text);
    validateReceipt(receipt);
    assert.equal(`${receipt.arm}.${receipt.gate}.${receipt.attempt}.json`, path.split('/').at(-1));
    return {path, receipt, sha256};
  }));
}

async function validateImmutablePublisher() {
  const path = join(CONTROL_ROOT, 'tests/acceptance/receipt.mjs');
  const source = await readFile(path, 'utf8');
  assert.match(source, /await open\(temporary, 'wx', 0o600\)/u);
  assert.match(source, /await link\(temporary, finalPath\)/u);
  assert.match(source, /error\?\.code === 'EEXIST'/u);
  assert.match(source, /await chmod\(finalPath, 0o444\)/u);
  return {
    file: repoPath(path),
    publication: 'exclusive temporary create plus atomic hard-link; EEXIST refuses replacement',
    postPublicationMode: '0444 (working-tree checkouts may restore Git-tracked files as 0644)',
  };
}

async function walkFiles(root, {exclude = new Set()} = {}) {
  const files = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (exclude.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files;
}

async function countSourceClass(files) {
  let lines = 0;
  for (const path of files) lines += physicalLineCount(await readFile(path, 'utf8'));
  return {files: files.length, physicalLines: lines};
}

async function authoredSourceAccounting() {
  const extension = /\.(?:css|js|json|mjs|mts|ts|tsx)$/u;
  const files = (await walkFiles(CONTROL_ROOT, {
    exclude: new Set(['node_modules', '.snapback', 'dist']),
  })).filter(path => extension.test(path));
  const relativePaths = files.map(path => ({path, relative: relative(CONTROL_ROOT, path).split(sep).join('/')}));
  const generated = relativePaths.filter(row => row.relative.startsWith('snapback/generated/'));
  const authored = relativePaths.filter(row => (
    !row.relative.startsWith('snapback/generated/')
    && row.relative !== 'bun.lock'
    && row.relative !== 'source-inventory.v1.json'
  ));
  const categories = {
    applicationIntent: authored.filter(row => (
      row.relative.startsWith('src/')
      && !/^(?:src\/(?:auth|data|windowing)\/|src\/assets\/upload\.ts$)/u.test(row.relative)
    )),
    schemaQueryMutation: authored.filter(row => /^(?:snapback\/schema\.mjs|snapback\/functions\.mjs)$/u.test(row.relative)),
    adapterGatewayConfiguration: authored.filter(row => (
      /^(?:composition\/|scripts\/|src\/(?:auth|data|windowing)\/|src\/assets\/upload\.ts$)/u.test(row.relative)
      || /^(?:demo\.snapback\.json|package\.json|postcss\.config\.js|tailwind\.config\.js|tsconfig\.json|vite\.config\.ts)$/u.test(row.relative)
    )),
    tests: authored.filter(row => row.relative.startsWith('tests/')),
    fixtureData: authored.filter(row => row.relative.startsWith('fixtures/')),
  };
  const output = {};
  for (const [name, rows] of Object.entries(categories)) output[name] = await countSourceClass(rows.map(row => row.path));
  output.generatedOutput = await countSourceClass(generated.map(row => row.path));
  output.authoredTotalExcludingFixtureAndGenerated = {
    files: Object.entries(output).filter(([name]) => !['fixtureData', 'generatedOutput', 'authoredTotalExcludingFixtureAndGenerated'].includes(name)).reduce((sum, [, value]) => sum + value.files, 0),
    physicalLines: Object.entries(output).filter(([name]) => !['fixtureData', 'generatedOutput', 'authoredTotalExcludingFixtureAndGenerated'].includes(name)).reduce((sum, [, value]) => sum + value.physicalLines, 0),
  };
  return output;
}

async function main() {
  const evidenceAbsolute = EVIDENCE_PATHS.map(path => join(REPO_ROOT, path));
  const guideAbsolute = GUIDE_PAGES.map(path => join(REPO_ROOT, path));
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb6.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/receipt.mjs'),
    ...evidenceAbsolute,
    ...guideAbsolute,
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const evidenceDir = process.env.ZBUGS_EVIDENCE_DIR;
  const planText = await readFile(PLAN_PATH, 'utf8');
  let receipts = [];
  let register = [];
  let sourceAccounting = {};
  let capabilityFacts = [];
  let refusalFacts = [];
  let stableCodes = [];
  let guideFacts = [];

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb6',
    attempt,
    title: 'Zerobugs control ZB6 — assistance, diagnostics, and accounting',
    expectedCheckIds: CHECK_IDS,
    evidenceDir,
    run: async gate => {
      await gate.check('gate-definition-and-receipt-assembly', async () => {
        assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
        assert.equal(WORKAROUND_REGISTER.length, 15);
        assert.equal(EVIDENCE_PATHS.length, 7);
        return {
          expectedChecks: CHECK_IDS.length,
          chronologyRows: CHRONOLOGY.length,
          workaroundRows: WORKAROUND_REGISTER.length,
          landedReceiptAttempts: EVIDENCE_PATHS.length,
        };
      });

      await gate.check('chronological-assistance-and-failed-path-sources-resolve', async () => {
        await validateChronologySources();
        return {
          rows: CHRONOLOGY.length,
          failedOrRejectedRows: CHRONOLOGY.filter(row => /failed|rejected|refusal/u.test(row.kind)).length,
          sourceRule: 'every row cites PLAN file+heading; gate attempts also cite immutable receipt file+JSON section',
        };
      });

      receipts = await loadEvidenceReceipts();
      await gate.check('landed-gate-receipts-are-valid-immutable-attempts', async () => {
        const publisher = await validateImmutablePublisher();
        return {
          publisher,
          attempts: receipts.map(row => ({
            file: row.path,
            gate: row.receipt.gate,
            attempt: row.receipt.attempt,
            outcome: row.receipt.outcome,
            counts: row.receipt.checks.counts,
            sha256: row.sha256,
          })),
        };
      });

      await gate.check('failed-attempt-remediation-trail-is-preserved', async () => {
        const byName = new Map(receipts.map(row => [`${row.receipt.gate}.${row.receipt.attempt}`, row.receipt]));
        assert.equal(byName.get('zb3.v1')?.outcome, 'FAIL');
        assert.equal(byName.get('zb3.v2')?.outcome, 'GAP');
        assert.equal(byName.get('zb4.v1')?.outcome, 'FAIL');
        assert.equal(byName.get('zb4.v2')?.outcome, 'GAP');
        return {
          trails: [
            {gate: 'zb3', first: 'v1 FAIL', remediation: 'v2 GAP', firstPreserved: true},
            {gate: 'zb4', first: 'v1 FAIL', remediation: 'v2 GAP', firstPreserved: true},
          ],
        };
      });

      await gate.check('workaround-register-rows-remain-declared', async () => {
        for (const entry of WORKAROUND_REGISTER) registerPlanRow(planText, entry.id);
        return {rows: WORKAROUND_REGISTER.map(entry => entry.id), undeclared: []};
      });

      register = await resolveWorkaroundRegister(planText);
      await gate.check('workaround-register-file-line-spans-resolve', async () => ({
        rows: register.map(row => ({id: row.id, files: row.files})),
        rowCount: register.length,
        namedFiles: register.reduce((sum, row) => sum + row.namedFiles, 0),
        invalidSpans: 0,
        rule: 'every declared start/end is positive, ordered, and at or below the current physical file length',
      }));
      await gate.check('workaround-register-source-provider-line-counts', async () => ({
        rows: register.map(row => ({
          id: row.id,
          namedFiles: row.namedFiles,
          providerSourceLines: row.providerSourceLines,
          witnessLines: row.witnessLines,
          fixtureLines: row.fixtureLines,
          declaredLines: row.declaredLines,
        })),
        counting: 'overlapping spans within one row/file are unioned; complete-file entries use current physical lines',
      }));

      sourceAccounting = await authoredSourceAccounting();
      await gate.check('authored-source-accounting-is-separated-by-class', async () => {
        for (const name of [
          'applicationIntent', 'schemaQueryMutation', 'adapterGatewayConfiguration',
          'tests', 'fixtureData', 'generatedOutput',
        ]) {
          assert(sourceAccounting[name].files > 0, `${name} has files`);
          assert(sourceAccounting[name].physicalLines > 0, `${name} has lines`);
        }
        return sourceAccounting;
      });

      await gate.check('guide-use-pages-resolve-and-are-current', async () => {
        guideFacts = [];
        for (const path of GUIDE_PAGES) {
          const text = await readFile(join(REPO_ROOT, path), 'utf8');
          assert.match(text, /^---\n[\s\S]*?\nstatus: current\n[\s\S]*?\n---\n/u, `${path} is current`);
          const heading = /^# (.+)$/mu.exec(text)?.[1];
          assert(heading, `${path} has a title`);
          guideFacts.push({path, heading, sha256: await sha256File(join(REPO_ROOT, path))});
        }
        return {pages: guideFacts};
      });

      await gate.check('guide-gap-findings-remain-visible', async () => {
        const mainGaps = markdownSection(planText, 'Guide gaps encountered');
        const lane6bGaps = markdownSection(planText, 'Guide gaps found during Lane 6b');
        const dated = [...mainGaps.matchAll(/^- \*\*2026-/gmu)].length;
        const lane6b = [...lane6bGaps.matchAll(/^\d+\. /gmu)].length;
        assert(dated >= 8, 'main chronology retains at least eight concrete guide gaps');
        assert.equal(lane6b, 3, 'Lane 6b retains three browser guide gaps');
        return {
          datedControlGuideGaps: dated,
          lane6bBrowserGuideGaps: lane6b,
          totalVisibleFindings: dated + lane6b,
          source: `${PLAN_FILE}#Guide gaps encountered and #Guide gaps found during Lane 6b`,
        };
      });

      const serializedReceipts = receipts.map(row => JSON.stringify(row.receipt)).join('\n');
      stableCodes = [...new Set(serializedReceipts.match(/(?:SNAPBACK|ZBUGS)_[A-Z0-9_]+/gu) ?? [])].sort();
      await gate.check('stable-snapback-diagnostics-observed-in-landed-receipts', async () => {
        assert(stableCodes.includes('SNAPBACK_HANDLER_FAILED'));
        return {
          codes: stableCodes.filter(code => code.startsWith('SNAPBACK_')),
          witness: `${EVIDENCE_PATHS[6]}#checks.rows[fixture-ingestion-refuses-after-completion]`,
          assertionRule: 'code, never message prose',
        };
      });
      await gate.check('stable-zbugs-diagnostics-observed-in-landed-receipts', async () => {
        assert(stableCodes.includes('ZBUGS_RECEIPT_ZERO_CHECKS'));
        return {
          codes: stableCodes.filter(code => code.startsWith('ZBUGS_')),
          witness: `${EVIDENCE_PATHS[0]}#checks.rows[zero-check-receipt-refusal]`,
          assertionRule: 'code, never message prose',
        };
      });

      capabilityFacts = receipts.flatMap(row => row.receipt.capabilityFacts.map(fact => ({
        sourceReceipt: row.path,
        ...fact,
      })));
      await gate.check('capability-facts-aggregate-without-parity-boolean', async () => {
        assert(capabilityFacts.length > 0);
        assert(!capabilityFacts.some(fact => fact.id === 'zerobugsParity'));
        return {
          facts: capabilityFacts.length,
          uniqueIds: new Set(capabilityFacts.map(fact => fact.id)).size,
          wholeProductBooleanPresent: false,
          attemptsIncluded: receipts.length,
        };
      });

      refusalFacts = receipts.flatMap(row => row.receipt.refusalFacts.map(fact => ({
        sourceReceipt: row.path,
        ...fact,
      })));
      await gate.check('refusal-facts-aggregate-as-closed-evidence', async () => {
        assert(refusalFacts.length > 0);
        assert(refusalFacts.every(fact => fact.id && fact.status === 'refused'));
        return {
          facts: refusalFacts.length,
          uniqueIds: new Set(refusalFacts.map(fact => fact.id)).size,
          allClosedRefusals: true,
        };
      });

      await gate.check('static-gate-created-no-owned-runtime-resources', async () => ({
        servers: 0,
        sockets: 0,
        browsers: 0,
        processes: 0,
        credentialCarriers: 0,
        scratchNamespaces: 0,
        cleanup: 'no runtime resources created; receipt publication is the only write',
      }));

      gate.gap('guide-gap-tickets-filed', {
        owner: 'repository guide maintenance / LLP 0061 diary loop',
        reason: 'PLAN records that the Lane 6b task was confined to demos/zerobugs/control and deferred its three required filesystem guide-gap tickets; this Stage C task is confined to gate/helper/evidence deliverables.',
        findingsRemainVisible: true,
      });
      gate.gap('cross-arm-authoring-delta', {
        owner: 'Stage 4 comparator and acceptance.v2 authoring baseline',
        reason: 'This is the D1 current-Snapback control. No immutable pinned-Zero arm or final-Snapback arm attempt exists from which to compute the required measured workaround/source delta.',
        currentControlCountsRecorded: true,
      });
    },
    buildReceipt: async run => {
      const fields = await buildGateReceiptFields(context, run, {
        actorIdentity: actorIdentityFromLaneReceipts(),
        capabilityFacts: [
          {id: 'authoring.chronology', status: 'supported-local-control', rows: CHRONOLOGY.length},
          {id: 'authoring.workaround-accounting', status: 'supported-local-control', rows: register.length},
          {id: 'diagnostics.stable-observed-codes', status: 'supported-local-control', codes: stableCodes},
          {id: 'authoring.guide-gap-tickets', status: 'gap', owner: 'LLP 0061 diary loop'},
          {id: 'authoring.cross-arm-delta', status: 'gap', owner: 'Stage 4 / acceptance.v2'},
          ...capabilityFacts,
        ],
        refusalFacts: [
          {id: 'zero-check-attempt', status: 'refused', code: 'ZBUGS_RECEIPT_ZERO_CHECKS'},
          {id: 'mutable-first-attempt', status: 'refused'},
          {id: 'whole-product-parity-boolean', status: 'refused'},
          ...refusalFacts,
        ],
        workarounds: register.map(row => ({
          id: row.id,
          status: row.status,
          namedFiles: row.namedFiles,
          providerSourceLines: row.providerSourceLines,
          witnessLines: row.witnessLines,
          fixtureLines: row.fixtureLines,
          declaredLines: row.declaredLines,
        })),
        sourceAccounting: {
          categories: sourceAccounting,
          workaroundRegister: register.map(row => ({
            id: row.id,
            namedFiles: row.namedFiles,
            providerSourceLines: row.providerSourceLines,
            witnessLines: row.witnessLines,
            fixtureLines: row.fixtureLines,
            declaredLines: row.declaredLines,
          })),
          immutableAttemptsInspected: receipts.length,
          chronologyRows: CHRONOLOGY.length,
          guidePagesUsed: guideFacts.length,
        },
        custodyAccounting: {
          mode: 'receipt archaeology and static source accounting',
          landedCustodyRecordsInspected: receipts.length,
          liveBrowserFactsAdded: 0,
          rawSessionCarriersRetained: 0,
        },
      });
      return {
        ...fields,
        browserIdentity: {
          mode: 'not-used-static-accounting-gate',
          browserFactsSource: 'landed receipts only',
        },
        network: 'none; filesystem-only receipt archaeology and source accounting',
        assistance: CHRONOLOGY,
      };
    },
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
