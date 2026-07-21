#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// mount the real Partitime feed against the Exact runtime under review, then
// retain the Agent operation's structured answer to “why didn't it update?”.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1];
};
const exactRoot = resolve(option('exact-checkout') ?? process.env.PARTITIME_EXACT_CHECKOUT ?? join(repoRoot, '..', 'exact'));
const outputPath = resolve(repoRoot, option('receipt') ?? 'demos/partiful-matrix/acceptance/results/step4-agent-session.json');
const exactModule = (path) => pathToFileURL(join(exactRoot, path)).href;

const compiler = await import(exactModule('packages/exact-contract/src/compiler/index.ts'));
const runtime = await import(exactModule('packages/exact-contract/src/runtime/index.ts'));
const inspection = await import(exactModule('packages/exact-devtools/src/agent/contract-inspection.ts'));
const helpers = await import(pathToFileURL(join(demoRoot, 'surfaces/contract/helpers.ts')).href);
const ui = await import(pathToFileURL(join(demoRoot, 'surfaces/contract/ui.ts')).href);
const manifest = JSON.parse(readFileSync(join(demoRoot, 'snapback/generated/contract-data.manifest.json'), 'utf8'));
const seed = JSON.parse(readFileSync(join(demoRoot, 'snapback/seed.json'), 'utf8'));

runtime.reset();
runtime.resetContractDataflowInspectorForTests();
runtime.resetLogicalQuerySubscriptionsForTests();
const previousExactHost = globalThis.exact;
globalThis.exact = { ...(previousExactHost ?? {}), dispatch() {} };

const deliveries = [];
const provider = {
  manifest,
  partitionId: () => 'partitime-agent-disconnected-fixture',
  subscribe(queryName, args, observer) {
    assert.equal(queryName, 'listEvents');
    const cell = {
      status: 'ready',
      value: seed.tables.events,
      empty: false,
      connection: 'disconnected',
    };
    deliveries.push({ queryName, args, cell });
    observer(cell);
    return { dispose() {} };
  },
  async mutate(mutationName, args, correlation) {
    return { ok: true, value: { mutationName, args, correlation, id: 'event_not_delivered' } };
  },
};

function compileContract(path) {
  const sourcePath = join(demoRoot, 'surfaces/contract', path);
  const source = readFileSync(sourcePath, 'utf8');
  const preflight = compiler.parseContractSource(source, sourcePath);
  const semantics = compiler.resolveStaticContractImportSemantics(preflight);
  const compiled = compiler.compileContractSource(source, sourcePath, {
    importSemantics: semantics.descriptors,
    importInferenceSources: semantics.inferenceSources,
    preparsedFile: preflight,
    diagnosticsMode: 'accumulate',
  });
  const errors = [...semantics.diagnostics, ...compiled.diagnostics].filter(({ severity }) => severity === 'error');
  assert.deepEqual(errors, [], `Contract compilation failed: ${JSON.stringify(errors)}`);
  return compiled.file;
}

const connectionBadge = runtime.defineComponent(compileContract('connection-badge.contract'));
const feed = runtime.defineComponent(compileContract('feed.contract'), {
  ConnectionBadge: connectionBadge,
  listEvents: (args = {}) => runtime.createProviderQueryHandle(provider, 'listEvents', args),
  createEvent: runtime.createProviderMutation(provider, 'createEvent'),
  fmtWhen: helpers.fmtWhen,
  openEvent: () => undefined,
  backgroundFor: ui.backgroundFor,
  textFor: ui.textFor,
  mutedFor: ui.mutedFor,
  accentFor: ui.accentFor,
  surfaceStyle: ui.surfaceStyle,
  fieldStyle: ui.fieldStyle,
  requiredMessage: ui.requiredMessage,
});

const mount = runtime.mount(feed, {
  props: { userName: 'Eve', backendName: 'snapback', initialVariant: 'warm' },
});
await new Promise((resolveSettle) => setTimeout(resolveSettle, 0));

const before = visibleEventCount(mount.container);
const mutation = await provider.mutate('createEvent', { title: 'Unseen event' }, { rootId: 'partitime-agent-session' });
await new Promise((resolveSettle) => setTimeout(resolveSettle, 0));
const after = visibleEventCount(mount.container);
assert.equal(before, seed.tables.events.length);
assert.equal(after, before, 'the disconnected fixture unexpectedly delivered a list update');

const bindingsEnvelope = await inspection.contractBindingsOperation({
  component: 'PartifulFeed',
  queryName: 'listEvents',
  provider: 'snapback',
});
const claimsEnvelope = await inspection.contractVerifyClaimsOperation({ component: 'PartifulFeed' });
const subscription = bindingsEnvelope.data.subscriptions.find(({ queryName }) => queryName === 'listEvents');
assert(subscription, 'Agent bindings response omitted listEvents');
assert.equal(subscription.why.state, 'ready');
assert.equal(subscription.why.connection, 'disconnected');
assert.match(subscription.why.reason, /no active transport and no retry in progress/i);
assert(bindingsEnvelope.data.components.some(({ component }) => component === 'PartifulFeed'));
assert.equal(claimsEnvelope.data.degraded, false);

const explicitClauseStatuses = claimsEnvelope.data.components.flatMap((component) => [
  ...component.verified.map((clause) => ({
    kind: 'live-tree',
    description: clause.description,
    status: clause.ok ? 'pass' : 'fail',
    skipped: clause.skipped ?? null,
    message: clause.message ?? null,
  })),
  ...component.interactionClauses.map((clause) => ({
    kind: clause.kind,
    description: clause.description,
    status: 'skipped',
    skipped: clause.skipped,
    message: null,
  })),
  ...component.witness.map((clause) => ({
    kind: clause.kind,
    description: clause.clause,
    status: clause.status,
    skipped: null,
    message: clause.detail ?? null,
  })),
]);
assert(explicitClauseStatuses.length > 0, 'Agent claim verification returned no clause statuses');
assert(explicitClauseStatuses.every(({ status, skipped }) => status || skipped), 'a Contract clause disappeared without a status');

const exactRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: exactRoot, encoding: 'utf8' }).trim();
const fileIdentity = (path) => {
  const absolute = resolve(repoRoot, path);
  return {
    path,
    sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
  };
};
const report = {
  schemaVersion: 'partitime.step4-agent-session.v1',
  ok: true,
  exactRevision,
  question: 'Why did the bound Partitime event list not update after createEvent?',
  answer: subscription.why,
  observation: {
    beforeRows: before,
    afterRows: after,
    mutation,
    providerFixture: 'Snapback manifest-compatible provider with an authoritative retained value and a disconnected transport',
  },
  bindings: bindingsEnvelope.data,
  claimVerification: claimsEnvelope.data,
  explicitClauseStatuses,
  inputs: [
    fileIdentity('demos/partiful-matrix/surfaces/contract/feed.contract'),
    fileIdentity('demos/partiful-matrix/surfaces/contract/connection-badge.contract'),
    fileIdentity('demos/partiful-matrix/snapback/generated/contract-data.manifest.json'),
  ],
};

mount.dispose();
runtime.reset();
runtime.resetContractDataflowInspectorForTests();
runtime.resetLogicalQuerySubscriptionsForTests();
if (previousExactHost === undefined) delete globalThis.exact;
else globalThis.exact = previousExactHost;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS Partitime Agent session — ${report.answer.reason}`);

function visibleEventCount(container) {
  let count = 0;
  const visit = (node) => {
    const testId = node?.originalProps?.testId ?? node?.originalProps?.testID;
    if (typeof testId === 'string' && testId.startsWith('event-card-')) count += 1;
    for (const child of node?.children ?? []) visit(child);
  };
  visit(container);
  return count;
}
