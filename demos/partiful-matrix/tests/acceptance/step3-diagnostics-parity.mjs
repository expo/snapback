#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useSnapbackQuery } from '../../../../packages/snapback-react/index.mjs';
import {
  createKeyedSnapbackContractProvider,
  createSnapbackProviderDiagnosticError,
} from '../../../../packages/snapback-contract/index.mjs';
import {
  importExactContractCompiler,
  importExactContractDeclaration,
  importExactContractDiagnostics,
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';

// @ref LLP 0063#workstream-5--structural-mutation-outcomes-and-excellent-diagnostics —
//   the Step 3 witness pins the known compiler/provider/action failures to one
//   machine-readable envelope and proves per-root dedupe.
// @ref LLP 0012#validation-requirements — React and Contract consume the same
//   generated artifacts and observe each other's mutation/live-query updates.

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const snapbackRoot = resolve(here, '../../../..');
const exactRoot = resolve(process.env.EXACT_ROOT ?? join(snapbackRoot, '..', 'exact'));
const write = process.argv.includes('--write');
const resultPath = join(
  snapbackRoot,
  'demos/partiful-matrix/acceptance/results/step3-diagnostics-parity.json',
);
const contractSourceRelative = 'demos/partiful-matrix/surfaces/contract/event.contract';
const contractSourcePath = join(snapbackRoot, contractSourceRelative);
const generatedRoot = join(snapbackRoot, 'demos/partiful-matrix/snapback/generated');

assert(
  existsSync(join(exactRoot, 'packages/exact-contract/src/diagnostics/index.ts')),
  `Exact diagnostics source is missing under ${exactRoot}; set EXACT_ROOT to the Exact checkout under test`,
);

const [compiler, runtime, declaration, exactDiagnostics] = await Promise.all([
  importExactContractCompiler({ exactRoot }),
  importExactContractRuntime({ exactRoot }),
  importExactContractDeclaration({ exactRoot }),
  importExactContractDiagnostics({ exactRoot }),
]);

runtime.resetLogicalQuerySubscriptionsForTests();

const contractManifest = JSON.parse(readFileSync(join(generatedRoot, 'contract-data.manifest.json'), 'utf8'));
const artifactIndex = JSON.parse(readFileSync(join(generatedRoot, 'artifacts.json'), 'utf8'));
const generatedApiModule = await import(pathToFileURL(join(generatedRoot, 'api.mjs')).href);
const generatedApi = generatedApiModule.api;

assert.equal(contractManifest.inputsHash, artifactIndex.inputsHash);
assert.equal(generatedApi.guestList.kind, 'LiveQuery');
assert.equal(generatedApi.rsvp.kind, 'Mutation');
assert.equal(contractManifest.queries.guestList.name, generatedApi.guestList.name);
assert.equal(contractManifest.mutations.rsvp.name, generatedApi.rsvp.name);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const flush = () => new Promise((resolvePromise) => setImmediate(resolvePromise));

function compileDiagnostics(source, file, options = {}) {
  try {
    return compiler.compileContractSource(source, file, {
      ...options,
      diagnosticsMode: 'accumulate',
    }).diagnostics;
  } catch (error) {
    if (error instanceof compiler.ContractCompileError) return error.diagnostics;
    throw error;
  }
}

function assertChannelParity(envelope, {
  code,
  severity,
  file = undefined,
  line = undefined,
} = {}) {
  assert.equal(envelope.schemaVersion, 'contract-diagnostic.v1');
  assert.equal(envelope.code, code);
  assert.equal(envelope.severity, severity);
  if (file !== undefined) assert.equal(envelope.primarySpan?.file, file);
  if (line !== undefined) assert.equal(envelope.primarySpan?.line, line);

  assert.deepEqual(exactDiagnostics.DIAGNOSTIC_ADAPTERS, ['cli', 'lsp', 'agent']);
  const renderings = exactDiagnostics.DIAGNOSTIC_ADAPTERS.map((adapter) => (
    exactDiagnostics.renderForAdapter(envelope, adapter)
  ));
  assert.equal(new Set(renderings.map((entry) => entry.presentation)).size, 3);
  const projectionBytes = renderings.map((entry) => (
    exactDiagnostics.parityProjectionString(entry.projection)
  ));
  assert(projectionBytes.every((bytes) => bytes === projectionBytes[0]));
  return {
    code: envelope.code,
    severity: envelope.severity,
    source: envelope.source,
    primarySpan: envelope.primarySpan ?? null,
    related: envelope.related,
    fixIts: envelope.fixIts,
    dedupeKey: envelope.dedupeKey,
    adapterProjectionSha256: sha256(projectionBytes[0]),
    adapters: [...exactDiagnostics.DIAGNOSTIC_ADAPTERS],
  };
}

// Exact's registered corpus is the independent oracle. The Snapback witness
// below then runs the same classes through the real Partitime artifacts and
// adapters, instead of treating the upstream unit file as sufficient evidence.
const exactOracle = spawnSync(
  'bun',
  ['test', 'packages/exact-contract/src/__tests__/diagnostics-parity.test.ts'],
  { cwd: exactRoot, encoding: 'utf8', env: process.env },
);
assert.equal(
  exactOracle.status,
  0,
  `Exact diagnostics parity oracle failed\n${exactOracle.stdout}\n${exactOracle.stderr}`,
);
const exactOracleOutput = `${exactOracle.stdout}\n${exactOracle.stderr}`;
const exactOraclePasses = Number(exactOracleOutput.match(/(\d+) pass/)?.[1] ?? 0);
assert(exactOraclePasses >= 8, `expected at least 8 Exact diagnostic oracle tests, observed ${exactOraclePasses}`);

const contractSource = readFileSync(contractSourcePath, 'utf8');
const parsedContract = compiler.parseContractSource(contractSource, contractSourcePath);
const staticSemantics = compiler.resolveStaticContractImportSemantics(parsedContract, {
  rootDir: snapbackRoot,
});
assert.equal(
  staticSemantics.diagnostics.filter((entry) => entry.severity === 'error').length,
  0,
  `Partitime Contract import semantics failed: ${JSON.stringify(staticSemantics.diagnostics)}`,
);

const diagnosticCases = [];

// 1. Grammar: mutate the real Partitime source in memory to add a second view
// root. The reported line is the real view block, not a Vite overlay locus.
const badGrammarSource = contractSource.replace(
  '\n  view\n',
  '\n  view\n    text "deliberate second root"\n',
);
const grammarDiagnostic = compileDiagnostics(badGrammarSource, contractSourcePath, {
  importBoundaryMode: 'project',
  importSemantics: staticSemantics.descriptors,
}).find((entry) => entry.code === 'view_root_count');
assert(grammarDiagnostic, 'missing view_root_count diagnostic');
diagnosticCases.push({
  case: 'grammar',
  ...assertChannelParity(
    exactDiagnostics.envelopeFromCompilerDiagnostic(grammarDiagnostic, { file: contractSourceRelative }),
    { code: 'view_root_count', severity: 'error', file: contractSourceRelative, line: 42 },
  ),
});

// 2. Non-live: mutate Exact's Snapback declaration fixture only after proving
// the names under test are the same names in the generated Partitime artifact.
// Validation refuses the static incompatibility before provider boot.
const providerDeclaration = declaration.produceSnapbackProviderDeclaration(
  declaration.partitimeSnapbackSchemaFixture,
);
assert(contractManifest.queries.eventDetails);
assert(contractManifest.mutations.rsvp);
const snapshotQuery = providerDeclaration.queries.find((query) => query.name === 'eventDetails');
snapshotQuery.liveness = { mode: 'snapshot', defaultLive: true };
snapshotQuery.receipts = 'promised';
const declarationValidation = declaration.validateProviderDeclaration(providerDeclaration);
assert.equal(declarationValidation.ok, false);
const nonLiveIssue = declarationValidation.issues.find(
  (entry) => entry.code === 'declaration_snapshot_liveness_conflict',
);
assert(nonLiveIssue, 'missing declaration_snapshot_liveness_conflict issue');
diagnosticCases.push({
  case: 'non_live_binding',
  ...assertChannelParity(
    exactDiagnostics.envelopeFromDeclarationIssue(nonLiveIssue),
    { code: 'declaration_snapshot_liveness_conflict', severity: 'error' },
  ),
});

// 3. Wrong handler kind: preserve every descriptor resolved from the real
// project, but deliberately relabel eventDetails as a pure helper.
const wrongHandlerSemantics = {
  ...staticSemantics.descriptors,
  './data/eventDetails.query.ts#eventDetails': {
    kind: 'pure',
    params: ['eventId'],
    result: 'EventRow[]',
    depends: 'args',
  },
};
const wrongHandlerDiagnostic = compileDiagnostics(contractSource, contractSourcePath, {
  importBoundaryMode: 'project',
  importSemantics: wrongHandlerSemantics,
}).find((entry) => entry.code === 'query_non_query_import');
assert(wrongHandlerDiagnostic, 'missing query_non_query_import diagnostic');
diagnosticCases.push({
  case: 'wrong_handler_kind',
  ...assertChannelParity(
    exactDiagnostics.envelopeFromCompilerDiagnostic(wrongHandlerDiagnostic, { file: contractSourceRelative }),
    { code: 'query_non_query_import', severity: 'error', file: contractSourceRelative, line: 20 },
  ),
});

// 4. Helper type/metadata: remove only fmtWhen's generated sidecar semantics;
// the compiler reports the original use line and actionable metadata path.
const missingHelperSemantics = { ...staticSemantics.descriptors };
delete missingHelperSemantics['./helpers.ts#fmtWhen'];
const helperDiagnostic = compileDiagnostics(contractSource, contractSourcePath, {
  importBoundaryMode: 'project',
  importSemantics: missingHelperSemantics,
}).find((entry) => entry.code === 'missing_import_semantics' && entry.span?.line === 6);
assert(helperDiagnostic, 'missing source-located helper metadata diagnostic');
diagnosticCases.push({
  case: 'helper_type_metadata',
  ...assertChannelParity(
    exactDiagnostics.envelopeFromCompilerDiagnostic(helperDiagnostic, { file: contractSourceRelative }),
    { code: 'missing_import_semantics', severity: 'warning', file: contractSourceRelative, line: 6 },
  ),
});

// Shared in-memory backend for the two idiomatic surfaces. Both adapters carry
// the exact same generated manifest object; no route string or shadow schema is
// used to select guestList/rsvp.
const guestRows = new Map([
  ['event-1', [{ _id: 'host', eventId: 'event-1', userId: 'host', guestName: 'Host', status: 'host' }]],
]);
const liveObservers = new Set();

function rowsFor(eventId) {
  return [...(guestRows.get(eventId) ?? [])].map((row) => ({ ...row }));
}

function refusal(code, message, { queryName, mutationName, line }) {
  return createSnapbackProviderDiagnosticError(code, message, {
    provider: contractManifest.provider,
    owner: 'provider',
    targetSurface: 'React/Contract provider',
    queryName,
    mutationName,
    source: {
      file: contractSourceRelative,
      line,
      column: 5,
      generatedFrom: `demos/partiful-matrix/snapback/generated/api.mjs#${queryName ?? mutationName}`,
    },
  });
}

function openLive(queryName, args, onRows) {
  assert.equal(generatedApi[queryName]?.kind, 'LiveQuery');
  if (args.eventId === 'denied') {
    throw refusal(
      'SNAPBACK_PROVIDER_SUBSCRIBE_REFUSED',
      'the provider refused this event scope',
      { queryName, line: 21 },
    );
  }
  const entry = { queryName, args: { ...args }, onRows };
  liveObservers.add(entry);
  onRows(rowsFor(args.eventId));
  return {
    rows: rowsFor(args.eventId),
    connection: 'live',
    dispose() { liveObservers.delete(entry); },
  };
}

function publish(queryName, eventId) {
  for (const entry of [...liveObservers]) {
    if (entry.queryName === queryName && entry.args.eventId === eventId) {
      entry.onRows(rowsFor(eventId));
    }
  }
}

async function mutateBackend(mutationName, args) {
  assert.equal(generatedApi[mutationName]?.kind, 'Mutation');
  if (args.status === 'rejected') {
    throw refusal(
      'SNAPBACK_ACTION_REJECTED',
      'the RSVP action was rejected by the provider',
      { mutationName, line: 30 },
    );
  }
  const rows = guestRows.get(args.eventId) ?? [];
  const withoutUser = rows.filter((row) => row.userId !== args.userId);
  withoutUser.push({
    _id: `${args.eventId}:${args.userId}`,
    eventId: args.eventId,
    userId: args.userId,
    guestName: args.guestName,
    status: args.status,
  });
  guestRows.set(args.eventId, withoutUser);
  publish('guestList', args.eventId);
  return { mutationId: `${mutationName}:${args.userId}`, outcome: 'confirmed' };
}

const contractClient = {
  async liveQuery(name, options) {
    return openLive(name, options.args ?? {}, options.onUpdate);
  },
  async mutate(name, options) {
    return mutateBackend(name, options.args ?? {});
  },
};

const reactProvider = {
  backend: contractManifest.provider,
  name: contractManifest.provider,
  manifest: contractManifest,
  externalStoreProtocol: 'snapback.external-store.v1',
  async subscribe(name, args, _userId, observer) {
    try {
      return openLive(name, args ?? {}, (rows) => observer(rows, 'live', { kind: 'authoritative' }));
    } catch (error) {
      observer([], 'disconnected', { kind: 'error', error });
      return { rows: [], connection: 'disconnected', dispose() {} };
    }
  },
  async mutate(name, args) {
    return mutateBackend(name, args ?? {});
  },
};

const contractSurface = createKeyedSnapbackContractProvider({
  runtime,
  client: contractClient,
  manifest: contractManifest,
  userId: 'contract-user',
  keyedQueries: ['guestList'],
  rootId: 'partitime-step3-contract-root',
});
assert.equal(contractSurface.provider.manifest, contractManifest);
assert.equal(reactProvider.manifest, contractManifest);

const contractDeliveries = [];
const contractBinding = contractSurface.links.guestList({ eventId: 'event-1' }).subscribe((delivery) => {
  contractDeliveries.push({
    rows: [...delivery],
    cell: runtime.readQueryDeliveryCell(delivery) ?? null,
  });
});
await flush();

const reactQueries = new Map();
function Probe({ eventId }) {
  const query = useSnapbackQuery({
    provider: reactProvider,
    name: 'guestList',
    args: { eventId },
    userId: 'react-user',
  });
  reactQueries.set(eventId, query);
  return React.createElement('output', {
    eventId,
    status: query.status,
    connection: query.connection,
    rows: query.rows.length,
  });
}

let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(Probe, { eventId: 'event-1' }));
  await flush();
});
assert.equal(reactQueries.get('event-1').status, 'ready');
assert.equal(contractDeliveries.at(-1).cell.status, 'ready');

// React mutation -> Contract live query.
await act(async () => {
  await reactQueries.get('event-1').mutate('rsvp', {
    eventId: 'event-1',
    userId: 'react-user',
    guestName: 'React Guest',
    status: 'going',
  });
  await flush();
});
assert(contractDeliveries.at(-1).rows.some((row) => row.userId === 'react-user'));

// Contract mutation -> React live query.
let contractMutation;
await act(async () => {
  contractMutation = await contractSurface.links.rsvp({
    eventId: 'event-1',
    userId: 'contract-user',
    guestName: 'Contract Guest',
    status: 'maybe',
  });
  await flush();
});
assert.equal(contractMutation.ok, true);
assert(reactQueries.get('event-1').rows.some((row) => row.userId === 'contract-user'));

// Provider subscription refusal reaches both surfaces with the same raw
// provider diagnostic; Exact's envelope projection is consequently identical.
const deniedContractDeliveries = [];
const deniedContractBinding = contractSurface.links.guestList({ eventId: 'denied' }).subscribe((delivery) => {
  deniedContractDeliveries.push({
    rows: [...delivery],
    cell: runtime.readQueryDeliveryCell(delivery) ?? null,
  });
});
await act(async () => {
  renderer.update(React.createElement(
    React.Fragment,
    null,
    React.createElement(Probe, { eventId: 'event-1', key: 'ok' }),
    React.createElement(Probe, { eventId: 'denied', key: 'denied' }),
  ));
  await flush();
});
await flush();

const contractProviderDiagnostic = deniedContractDeliveries.at(-1).cell.error.diagnostic;
const reactProviderDiagnostic = reactQueries.get('denied').error.diagnostic;
assert.deepEqual(reactProviderDiagnostic, contractProviderDiagnostic);
const contractProviderEnvelope = exactDiagnostics.envelopeFromProviderDiagnostic(contractProviderDiagnostic);
const reactProviderEnvelope = exactDiagnostics.envelopeFromProviderDiagnostic(reactProviderDiagnostic);
assert.equal(
  exactDiagnostics.parityProjectionString(exactDiagnostics.parityProjection(reactProviderEnvelope)),
  exactDiagnostics.parityProjectionString(exactDiagnostics.parityProjection(contractProviderEnvelope)),
);
diagnosticCases.push({
  case: 'provider_refusal',
  ...assertChannelParity(contractProviderEnvelope, {
    code: 'SNAPBACK_PROVIDER_SUBSCRIBE_REFUSED',
    severity: 'error',
    file: contractSourceRelative,
    line: 21,
  }),
});

// Action rejection is not swallowed: React rejects the invoking promise and
// retains structured mutation state; Contract returns a structured failure.
let reactActionError = null;
await act(async () => {
  try {
    await reactQueries.get('event-1').mutate('rsvp', {
      eventId: 'event-1',
      userId: 'react-user',
      guestName: 'React Guest',
      status: 'rejected',
    }, { id: 'react-action-rejected' });
  } catch (error) {
    reactActionError = error;
  }
  await flush();
});
assert(reactActionError, 'React action rejection must propagate to its caller');
assert.equal(reactQueries.get('event-1').mutation.status, 'rejected');
assert.equal(reactQueries.get('event-1').mutation.error.diagnostic.code, 'SNAPBACK_ACTION_REJECTED');

const contractActionFirst = await contractSurface.links.rsvp({
  eventId: 'event-1',
  userId: 'contract-user',
  guestName: 'Contract Guest',
  status: 'rejected',
});
const contractActionSecond = await contractSurface.links.rsvp({
  eventId: 'event-1',
  userId: 'contract-user',
  guestName: 'Contract Guest',
  status: 'rejected',
});
assert.equal(contractActionFirst.ok, false);
assert.equal(contractActionSecond.ok, false);
assert.equal(contractActionFirst.error.diagnostic.code, 'SNAPBACK_ACTION_REJECTED');
assert.deepEqual(reactActionError.diagnostic, contractActionFirst.error.diagnostic);

const actionReports = contractSurface.diagnostics.filter(
  (entry) => entry.code === 'SNAPBACK_ACTION_REJECTED',
);
assert.equal(actionReports.length, 1, 'repeated action rejection emits one root report');
assert.equal(actionReports[0].occurrences, 2);
const actionEnvelope = exactDiagnostics.envelopeFromProviderDiagnostic(
  contractActionFirst.error.diagnostic,
);
assert.equal(actionEnvelope.source, 'provider', 'transport rejection is not a compiler/Vite overlay');
diagnosticCases.push({
  case: 'action_rejection',
  ...assertChannelParity(actionEnvelope, {
    code: 'SNAPBACK_ACTION_REJECTED',
    severity: 'error',
    file: contractSourceRelative,
    line: 30,
  }),
});

deniedContractBinding.dispose();
contractBinding.dispose();
contractSurface.dispose();
await act(async () => {
  renderer.unmount();
  await flush();
});
runtime.resetLogicalQuerySubscriptionsForTests();
assert.equal(runtime.activeLogicalQuerySubscriptionCount(), 0);
assert.equal(liveObservers.size, 0);

const result = {
  schemaVersion: 'partitime.step3-diagnostics-parity.v1',
  status: 'pass',
  scope: 'LLP 0063 Step 3 diagnostics and React/Contract parity slice',
  generatedArtifacts: {
    artifactIndex: relative(snapbackRoot, join(generatedRoot, 'artifacts.json')),
    contractManifest: relative(snapbackRoot, join(generatedRoot, 'contract-data.manifest.json')),
    apiModule: relative(snapbackRoot, join(generatedRoot, 'api.mjs')),
    inputsHash: contractManifest.inputsHash,
    schemaHash: contractManifest.schemaHash,
    bundleHash: contractManifest.bundleHash,
    queryReference: generatedApi.guestList.id,
    mutationReference: generatedApi.rsvp.id,
  },
  exactOracle: {
    path: 'packages/exact-contract/src/__tests__/diagnostics-parity.test.ts',
    passCount: exactOraclePasses,
  },
  crossSurface: {
    manifestObjectShared: true,
    reactMutationObservedByContractLiveQuery: true,
    contractMutationObservedByReactLiveQuery: true,
    providerDiagnosticProjectionEqual: true,
    actionDiagnosticProjectionEqual: true,
    actionErrorPropagatedToReactCaller: true,
    contractActionReturnedStructuredFailure: true,
  },
  diagnostics: diagnosticCases,
  rootReporting: {
    rootId: 'partitime-step3-contract-root',
    actionCode: 'SNAPBACK_ACTION_REJECTED',
    reports: actionReports.length,
    occurrences: actionReports[0].occurrences,
  },
  lifecycle: {
    exactLogicalSubscriptionsAfterDispose: runtime.activeLogicalQuerySubscriptionCount(),
    backendObserversAfterDispose: liveObservers.size,
  },
  nonClaims: [
    'This slice does not promote any cumulative-gate manifest claim.',
    'LSP completion/navigation/rename/formatting/incremental capability witnesses remain outside this diagnostics-parity slice.',
    'Native quiet-operation and non-Snapback producer gates remain separate Step 3 receipts.',
  ],
};

if (write) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
