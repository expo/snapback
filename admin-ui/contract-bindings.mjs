// Source of truth for the Snapback admin Contract data bindings.
//
// One binding list projects into generated/contract/* (query/mutation modules,
// .contract-meta sidecars, and the runtime-link registry) so the admin surface
// never drifts one hand-written file at a time.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - admin
//   Contract modules should be projected like the todo demos, not maintained as
//   hand-written per-binding sidecars.

export const adminContractBindings = [
  {
    name: 'inspect',
    kind: 'query',
    args: {},
    reads: ['inspect'],
    readMode: 'sync',
    cacheKey: 'inspect',
  },
  {
    name: 'refresh',
    kind: 'mutation',
    args: {},
    effects: ['inspect.refresh'],
    invalidates: ['inspect', 'networkProfile'],
  },
  {
    name: 'networkProfile',
    kind: 'query',
    args: {},
    reads: ['networkProfile'],
    readMode: 'sync',
    cacheKey: 'networkProfile',
  },
  {
    name: 'activateNetworkProfile',
    kind: 'mutation',
    args: {
      mode: 'string',
      name: 'string',
      mutationAckDelayMs: 'string',
      liveDeltaDelayMs: 'string',
      queryResponseDelayMs: 'string',
      jitterMs: 'string',
    },
    effects: ['networkProfile.activate'],
    invalidates: ['networkProfile'],
  },
  {
    name: 'telemetryLogs',
    kind: 'query',
    args: {},
    reads: ['telemetryLogs'],
    readMode: 'sync',
    cacheKey: 'telemetryLogs',
  },
  {
    name: 'errorIssues',
    kind: 'query',
    args: {},
    reads: ['errorIssues'],
    readMode: 'sync',
    cacheKey: 'errorIssues',
  },
  {
    name: 'errorDetail',
    kind: 'query',
    args: {},
    reads: ['errorDetail'],
    readMode: 'sync',
    cacheKey: 'errorDetail',
  },
  {
    name: 'loadErrorDetail',
    kind: 'mutation',
    args: { issue: 'string' },
    effects: ['errors.issue.load'],
    invalidates: ['errorDetail'],
  },
  {
    name: 'transitionError',
    kind: 'mutation',
    args: { issue: 'string', stateSeq: 'number', to: 'string' },
    effects: ['errors.transition'],
    invalidates: ['errorIssues', 'errorDetail'],
  },
  {
    name: 'refreshTelemetry',
    kind: 'mutation',
    args: {},
    effects: ['telemetry.poll'],
    invalidates: ['inspect', 'networkProfile'],
  },
  {
    name: 'loadOlderTelemetryLogs',
    kind: 'mutation',
    args: {},
    effects: ['telemetry.logs.page'],
    invalidates: ['telemetryLogs'],
  },
  {
    name: 'loadTelemetryLogs',
    kind: 'mutation',
    args: {
      kind: 'string',
      name: 'string',
      code: 'string',
      text: 'string',
    },
    effects: ['telemetry.logs.filter'],
    invalidates: ['telemetryLogs'],
  },
  {
    name: 'tableScan',
    kind: 'query',
    args: {},
    reads: ['tableScan'],
    readMode: 'sync',
    cacheKey: 'tableScan',
  },
  {
    name: 'loadTable',
    kind: 'mutation',
    args: {
      table: 'string',
      offset: 'number',
    },
    effects: ['tableScan.load'],
    invalidates: ['tableScan'],
  },
  {
    name: 'runResult',
    kind: 'query',
    args: {},
    reads: ['runResult'],
    readMode: 'sync',
    cacheKey: 'runResult',
  },
  {
    name: 'runFunction',
    kind: 'mutation',
    args: {
      name: 'string',
      argsText: 'string',
    },
    effects: ['runResult.run'],
    invalidates: ['runResult'],
  },
  {
    // Ephemeral cleanup: a privileged runtime-state write (token-gated like other
    // admin writes), then republish a fresh inspect so the counters update.
    name: 'cleanup',
    kind: 'mutation',
    args: {},
    effects: ['ephemeral.cleanup'],
    invalidates: ['inspect'],
  },
  {
    // config.verify: run a declared entry's probe action (token-gated admin
    // write), then republish inspect so the Secrets surface reflects the new
    // verification state. Status rides the inspect view; values never appear.
    name: 'verifyConfig',
    kind: 'mutation',
    args: {
      entry: 'string',
    },
    effects: ['config.verify'],
    invalidates: ['inspect'],
  },
  {
    name: 'guidePage',
    kind: 'query',
    args: {},
    reads: ['guidePage'],
    readMode: 'sync',
    cacheKey: 'guidePage',
  },
  {
    name: 'loadGuidePage',
    kind: 'mutation',
    args: {
      path: 'string',
    },
    effects: ['guidePage.load'],
    invalidates: ['guidePage'],
  },
];
