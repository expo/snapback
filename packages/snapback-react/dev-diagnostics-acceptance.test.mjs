// @ref LLP 0219#phases — P3 makes both Clique pilot dark loops visible through
// the default dev-console projection within one screenful.

import assert from 'node:assert/strict';
import { format } from 'node:util';

import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  SnapbackClient,
  createMemoryRqsResumeStore,
} from '../snapback-client/index.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  observeSnapbackDiagnostics,
  useSnapbackDiagnostics,
  useSnapbackMutation,
  useSnapbackQuery,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ONE_SCREENFUL = 40;
const SHIPPED_CHURN_TRANSITION_THRESHOLD = 8;
const SHIPPED_CHURN_WINDOW_MS = 2_000;
const ACCEPTANCE_RENDER_TRANSITIONS = 12;
const ACCEPTANCE_WEDGE_WARNING_MS = 25;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const flushDiagnostics = async () => {
  for (let iteration = 0; iteration < 4; iteration += 1) await flush();
};

const queryResultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 64 } }),
    ]),
    allowExtra: false,
  }),
});
const mutationResultContract = Object.freeze({
  kind: 'value',
  value: Object.freeze({ kind: 'string', maxBytes: 64 }),
});
const reference = (name, kind, resultContract) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'clique-dev-diagnostics-acceptance',
  id: `clique-dev-diagnostics-acceptance:${name}`,
  name,
  kind,
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      channel: { type: 'string' },
      filter: {},
      renderCounter: { type: 'integer' },
      logicalTimestamp: { type: 'integer' },
      body: { type: 'string' },
    },
  },
  resultContractHash: resultContractHash(resultContract),
  resultContract,
});
const cliqueMessages = reference('cliqueMessages', 'LiveQuery', queryResultContract);
const sendMessage = reference('sendMessage', 'Mutation', mutationResultContract);
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'clique-dev-diagnostics-acceptance',
  bundleHash: 'sha256:clique-dev-diagnostics-acceptance-bundle',
  functions: Object.freeze([cliqueMessages, sendMessage]),
});
const schema = Object.freeze({
  artifactKind: 'schemaManifest',
  schemaVersion: 'snapback.v0',
  appId: 'clique-dev-diagnostics-acceptance',
  schemaHash: 'sha256:clique-dev-diagnostics-acceptance-schema',
  ephemeralCollections: Object.freeze([]),
  tables: Object.freeze([]),
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  // @ref LLP 0218#41-the-dispatch-union-headless-contract — this acceptance
  // scenario exercises durable queued custody, so its target must positively
  // advertise the settlement-ledger capability required by that lifecycle.
  supportedCapabilities: Object.freeze(['live_subscriptions', 'offline_mutation_replay']),
});

function installConsoleCapture() {
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines = [];
  const collect = (level, parts) => {
    const atMs = Date.now();
    for (const text of format(...parts).split(/\r?\n/u)) {
      lines.push(Object.freeze({ level, atMs, text }));
    }
  };
  console.warn = (...parts) => collect('warn', parts);
  console.error = (...parts) => collect('error', parts);
  return Object.freeze({
    lines,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  });
}

function fixtureInspection() {
  return {
    targetProfileId: 'local-dev-sqlite-ibex',
    target: 'local-dev-sqlite-ibex',
    schema,
    functions,
    capabilityManifest,
  };
}

function bindFixtureBackend(client) {
  const liveHandles = new Set();
  let subscriptionSequence = 0;
  client.inspect = async () => fixtureInspection();
  client.authSession = async () => ({ activeMode: 'dev' });
  client.liveStreamManager = () => ({
    inspection: () => ({ socketDemand: liveHandles.size }),
    async settled() {},
  });
  client.releaseConnection = async () => ({ released: true });
  client.startLiveQuery = (_reference, options) => {
    subscriptionSequence += 1;
    const current = {
      subscriptionId: `clique-diagnostics-${subscriptionSequence}`,
      rows: Object.freeze([]),
      connection: 'live',
      freshness: 'current',
      retention: null,
    };
    const handle = {
      current,
      started: async () => {},
      dispose() { liveHandles.delete(handle); },
      settled: async () => {},
    };
    liveHandles.add(handle);
    queueMicrotask(() => options.onUpdate?.(current.rows, { kind: 'live_replace' }));
    return Object.freeze(handle);
  };
}

async function createAcceptanceHarness(clientOptions, providerOptions = {}) {
  const client = new SnapbackClient('http://127.0.0.1:9', clientOptions);
  bindFixtureBackend(client);
  const binding = await prepareReactBindingForClient(client, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding, providerOptions);
  return { client, provider };
}

async function disposeHarness(harness, renderer = null) {
  if (renderer !== null) {
    await act(async () => {
      renderer.unmount();
      await flushDiagnostics();
    });
  }
  await harness.provider.dispose();
  await harness.client.closeAuth();
}

function matchingLines(lines, startIndex, pattern) {
  return lines.slice(startIndex).filter((line) => pattern.test(line.text));
}

function surfacedLineNumber(lines, startIndex, pattern, message) {
  const relativeIndex = lines.slice(startIndex).findIndex((line) => pattern.test(line.text));
  assert.notEqual(relativeIndex, -1, message);
  return relativeIndex + 1;
}

async function runChurnAcceptance(capture) {
  let advanceRender = null;
  function CliquePilotScreen({ stable = false }) {
    const [renderCounter, setRenderCounter] = useState(0);
    advanceRender = () => setRenderCounter((value) => value + 1);
    const args = stable
      ? renderCounter % 2 === 0
        ? { channel: 'pilot', filter: { unread: true } }
        : { filter: { unread: true }, channel: 'pilot' }
      : { channel: 'pilot', renderCounter, logicalTimestamp: renderCounter };
    useSnapbackQuery(cliqueMessages, args);
    return React.createElement('output', { renderCounter, stable });
  }

  const harness = await createAcceptanceHarness({
    rqsStore: null,
    offlineQueue: false,
  });
  let renderer = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(CliquePilotScreen),
      ));
      await flushDiagnostics();
    });
    const pathologyLineStart = capture.lines.length;
    const pathologyStartedAtMs = Date.now();

    for (let transition = 1; transition < SHIPPED_CHURN_TRANSITION_THRESHOLD; transition += 1) {
      await act(async () => {
        advanceRender();
        await flushDiagnostics();
      });
      assert.equal(
        matchingLines(
          capture.lines,
          pathologyLineStart,
          /SNAPBACK_REACT_SUBSCRIPTION_CHURN/u,
        ).length,
        0,
        `the shipped default does not warn before transition ${SHIPPED_CHURN_TRANSITION_THRESHOLD}`,
      );
    }
    for (
      let transition = SHIPPED_CHURN_TRANSITION_THRESHOLD;
      transition <= ACCEPTANCE_RENDER_TRANSITIONS;
      transition += 1
    ) {
      await act(async () => {
        advanceRender();
        await flushDiagnostics();
      });
    }

    const churnLines = matchingLines(
      capture.lines,
      pathologyLineStart,
      /SNAPBACK_REACT_SUBSCRIPTION_CHURN/u,
    );
    assert.equal(churnLines.length, 1, 'continued churn coalesces to one console line');
    const [churnLine] = churnLines;
    const churnLineNumber = surfacedLineNumber(
      capture.lines,
      pathologyLineStart,
      /SNAPBACK_REACT_SUBSCRIPTION_CHURN/u,
      'genuinely-changing inline query args must surface a churn warning',
    );
    assert.ok(churnLineNumber <= ONE_SCREENFUL, 'churn surfaces within one screenful');
    assert.ok(
      churnLine.atMs - pathologyStartedAtMs <= SHIPPED_CHURN_WINDOW_MS,
      `churn surfaces within the shipped ${SHIPPED_CHURN_WINDOW_MS}ms detector window`,
    );
    assert.match(churnLine.text, /CliquePilotScreen/u, 'warning names the hook callsite');
    assert.match(churnLine.text, /cliqueMessages/u, 'warning names the generated reference');
    assert.match(
      churnLine.text,
      new RegExp(`Observed ${SHIPPED_CHURN_TRANSITION_THRESHOLD} committed query descriptor transitions`, 'u'),
      'warning names the shipped transition threshold and observed count',
    );
    assert.match(churnLine.text, /Memoize or hoist/u, 'warning carries the fix');
    assert.match(churnLine.text, /guide\/clients\/react\.md/u, 'warning carries the guide anchor');

    await disposeHarness(harness, renderer);
    renderer = null;

    const controlHarness = await createAcceptanceHarness({
      rqsStore: null,
      offlineQueue: false,
    });
    let controlRenderer = null;
    try {
      await act(async () => {
        controlRenderer = TestRenderer.create(React.createElement(
          SnapbackProvider,
          { provider: controlHarness.provider },
          React.createElement(CliquePilotScreen, { stable: true }),
        ));
        await flushDiagnostics();
      });
      const controlLineStart = capture.lines.length;
      for (let transition = 1; transition <= ACCEPTANCE_RENDER_TRANSITIONS; transition += 1) {
        await act(async () => {
          advanceRender();
          await flushDiagnostics();
        });
      }
      assert.equal(
        matchingLines(
          capture.lines,
          controlLineStart,
          /SNAPBACK_REACT_SUBSCRIPTION_CHURN/u,
        ).length,
        0,
        'content-equal fresh args across the same number of committed renders stay silent',
      );
    } finally {
      await disposeHarness(controlHarness, controlRenderer);
    }
    return churnLineNumber;
  } finally {
    if (renderer !== null) await disposeHarness(harness, renderer);
  }
}

async function runQueuedWedgeAcceptance(capture) {
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'acceptance-memory', durable: true });
  const harness = await createAcceptanceHarness({
    rqsStore: store,
    offlineQueue: true,
    queuedMutationWedgeWarningMs: ACCEPTANCE_WEDGE_WARNING_MS,
  }, { outboxDrain: 'manual' });
  let renderer = null;
  let observer = null;
  let dispatchMutation = null;
  let hookSnapshot = null;

  function SilentQueueScreen() {
    const mutate = useSnapbackMutation(sendMessage);
    hookSnapshot = useSnapbackDiagnostics();
    dispatchMutation = () => mutate({ body: 'offline pilot message' });
    // Deliberately no useSnapbackOutbox(), drain call, or drain UI. The
    // provider's explicit manual-drain mode reproduces the pilot's undrained
    // screen while preserving LLP 0218 P3's default provider-owned auto drain.
    return React.createElement('output', { status: 'ready' });
  }

  try {
    const observerSnapshots = [];
    observer = observeSnapbackDiagnostics(
      harness.provider,
      (snapshot) => observerSnapshots.push(snapshot),
    );
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(SilentQueueScreen),
      ));
      await flushDiagnostics();
    });

    const scenarioLineStart = capture.lines.length;
    const dispatchStartedAtMs = Date.now();
    let queuedOutcome = null;
    await act(async () => {
      queuedOutcome = await dispatchMutation();
      await flushDiagnostics();
    });
    assert.equal(queuedOutcome.status, 'queued');
    assert.equal(queuedOutcome.presentation, 'withheld');

    const queuedLines = matchingLines(
      capture.lines,
      scenarioLineStart,
      /SNAPBACK_(?:OFFLINE_MUTATION_QUEUED|REACT_MUTATION_QUEUED)/u,
    );
    assert.equal(
      queuedLines.length,
      1,
      'canonical and React compatibility queued events print exactly one line',
    );
    const [queuedLine] = queuedLines;
    assert.match(
      queuedLine.text,
      /SNAPBACK_OFFLINE_MUTATION_QUEUED/u,
      'the one deduplicated line uses the canonical client code',
    );
    const queuedLineNumber = surfacedLineNumber(
      capture.lines,
      scenarioLineStart,
      /SNAPBACK_OFFLINE_MUTATION_QUEUED/u,
      'queued mutation must print immediately',
    );
    assert.ok(queuedLineNumber <= ONE_SCREENFUL, 'queued mutation surfaces within one screenful');
    assert.ok(
      queuedLine.atMs - dispatchStartedAtMs < ACCEPTANCE_WEDGE_WARNING_MS,
      'queued line prints before the shortened wedge threshold',
    );
    assert.match(queuedLine.text, /Mutation: sendMessage/u);
    assert.match(queuedLine.text, /Keep pending UI visible/u);
    assert.match(queuedLine.text, /useSnapbackOutbox\(\)\.drainNow\(\)/u);

    await act(async () => {
      await new Promise((resolve) => setTimeout(
        resolve,
        ACCEPTANCE_WEDGE_WARNING_MS + 30,
      ));
      await flushDiagnostics();
    });

    const wedgeLines = matchingLines(
      capture.lines,
      scenarioLineStart,
      /SNAPBACK_REACT_MUTATION_QUEUE_WEDGED/u,
    );
    assert.equal(wedgeLines.length, 1, 'one unchanged durable head prints one wedge line');
    const [wedgeLine] = wedgeLines;
    const wedgeLineNumber = surfacedLineNumber(
      capture.lines,
      scenarioLineStart,
      /SNAPBACK_REACT_MUTATION_QUEUE_WEDGED/u,
      'undrained queued mutation must surface the wedge after the threshold',
    );
    assert.ok(wedgeLineNumber <= ONE_SCREENFUL, 'wedge surfaces within one screenful');
    assert.ok(
      wedgeLine.atMs - queuedLine.atMs >= ACCEPTANCE_WEDGE_WARNING_MS,
      'wedge line appears only after the shortened threshold',
    );
    assert.match(wedgeLine.text, /Queue depth: 1/u);
    assert.match(wedgeLine.text, new RegExp(queuedOutcome.clientMutationId, 'u'));
    assert.match(wedgeLine.text, /sequence: 1/u);
    assert.match(wedgeLine.text, /useSnapbackOutbox\(\)\.drainNow\(\)/u);

    const activeConditions = Object.values(hookSnapshot.activeConditions);
    assert.equal(activeConditions.length, 1, 'the hook exposes one active wedged head');
    const [condition] = activeConditions;
    assert.equal(condition.code, 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED');
    assert.equal(condition.details.queueDepth, 1);
    assert.equal(condition.details.clientMutationId, queuedOutcome.clientMutationId);
    assert.equal(condition.details.headSequence, 1);
    assert.match(condition.details.recoveryPath, /useSnapbackOutbox\(\)\.drainNow\(\)/u);
    assert.equal(
      observer.snapshot(),
      hookSnapshot,
      'hook and framework-neutral observer expose the same active-condition snapshot',
    );
    assert.ok(
      observerSnapshots.some((snapshot) => Object.values(snapshot.activeConditions)
        .some((event) => event.code === 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED')),
      'observer received the active wedge condition',
    );

    const scenarioLines = capture.lines.slice(scenarioLineStart);
    assert.ok(
      scenarioLines.length <= ONE_SCREENFUL,
      `queued/wedged scenario emitted ${scenarioLines.length} lines, exceeding one screenful`,
    );
    return { queuedLineNumber, wedgeLineNumber };
  } finally {
    observer?.dispose();
    await disposeHarness(harness, renderer);
    await store.close();
  }
}

const previousNodeEnvironment = process.env.NODE_ENV;
const previousDev = globalThis.__DEV__;
const originalFetch = globalThis.fetch;
const capture = installConsoleCapture();
let churnLineNumber;
let queuedSummary;
try {
  process.env.NODE_ENV = 'development';
  globalThis.__DEV__ = true;
  churnLineNumber = await runChurnAcceptance(capture);

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  queuedSummary = await runQueuedWedgeAcceptance(capture);
} finally {
  capture.restore();
  globalThis.fetch = originalFetch;
  if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnvironment;
  if (previousDev === undefined) delete globalThis.__DEV__;
  else globalThis.__DEV__ = previousDev;
}

process.stdout.write(
  `dev diagnostics acceptance: churn surfaced at captured line ${churnLineNumber}\n`,
);
process.stdout.write(
  `dev diagnostics acceptance: queued surfaced at captured line ${queuedSummary.queuedLineNumber}\n`,
);
process.stdout.write(
  `dev diagnostics acceptance: wedge surfaced at captured line ${queuedSummary.wedgeLineNumber} after ${ACCEPTANCE_WEDGE_WARNING_MS}ms threshold\n`,
);
