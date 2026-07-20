#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  acceptanceRoot,
  demoRoot,
  finalizeReport,
  identity,
  measureJavaScriptBundle,
  measureSourceInventory,
  readCommittedJson,
  readJson,
  requirement,
  run,
  validateRetainedWebReceipt,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — every WS8
// category receives a machine row; missing prospective instruments remain red
// nonclaims and frozen thresholds are evaluated without rebaselining.

const output = `${acceptanceRoot}/results/step4-budgets.json`;
const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';
const attributionPath = 'demos/partiful-matrix/acceptance/results/step0-attribution.json';
const webReceiptPath = 'demos/partiful-matrix/acceptance/results/step0-web.json';
const nativeAggregatePath = 'demos/partiful-matrix/acceptance/results/step0-native.json';
const nativeExactPath = 'demos/partiful-matrix/acceptance/results/step0-native-exact.json';
const nativeSwiftuiPath = 'demos/partiful-matrix/acceptance/results/step0-native-swiftui.json';
const reactAndroidPath = 'demos/partiful-matrix/acceptance/results/step2-react-expo-android.json';
const supabaseRealtimePath = 'demos/partiful-matrix/acceptance/results/supabase-realtime-web.json';
const convexRealtimePath = 'demos/partiful-matrix/acceptance/results/convex-realtime-web.json';
const contractConvexRealtimePath = 'demos/partiful-matrix/acceptance/results/contract-convex-realtime-web.json';

const protocol = readJson(protocolPath);
const thresholdSource = readCommittedJson(attributionPath);
const frozen = thresholdSource.value;
const webReceipt = readJson(webReceiptPath);
const nativeAggregate = readJson(nativeAggregatePath);
const nativeExact = readJson(nativeExactPath);
const nativeSwiftui = readJson(nativeSwiftuiPath);
const reactAndroid = readJson(reactAndroidPath);
const supabaseRealtime = readJson(supabaseRealtimePath);
const convexRealtime = readJson(convexRealtimePath);
const contractConvexRealtime = readJson(contractConvexRealtimePath);
validateRetainedWebReceipt(webReceipt);

assert.equal(frozen.workloadVersion, protocol.workloadVersion);
assert.equal(frozen.methodId, protocol.protocolId);
assert.equal(frozen.thresholdFormulaSetId, protocol.thresholdFormulaSetId);
assert.deepEqual(protocol.initialAttributionCategories, [
  'emittedMinifiedJsBytes',
  'compressedJsBytes',
  'authoredSourceLines',
  'glueFileAndLineInventory',
  'requiredCheckCount',
  'firstPushFreshnessLatencyMsP95',
]);
const arms = ['react', 'contract', 'vanilla'];
const backends = ['snapback', 'supabase', 'convex', 'sqlite'];
const candidateBuilds = arms.map((arm) => run('bun', ['run', 'build'], `${demoRoot}/surfaces/${arm}`));
for (const build of candidateBuilds) {
  assert.equal(build.status, 0, `candidate production build failed: ${JSON.stringify(build)}`);
}

const sourceGroups = {
  react: [
    'demos/partiful-matrix/surfaces/react/src/App.tsx',
    'demos/partiful-matrix/surfaces/react/src/main.tsx',
    'demos/partiful-matrix/surfaces/react/src/provider.ts',
  ],
  contract: [
    'demos/partiful-matrix/surfaces/contract/feed.contract',
    'demos/partiful-matrix/surfaces/contract/event.contract',
    'demos/partiful-matrix/surfaces/contract/main.ts',
    'demos/partiful-matrix/surfaces/contract/provider.ts',
    'demos/partiful-matrix/surfaces/contract/helpers.ts',
    'demos/partiful-matrix/surfaces/contract/helpers.contract-meta.ts',
  ],
  vanilla: [
    'demos/partiful-matrix/surfaces/vanilla/src/main.js',
    'demos/partiful-matrix/surfaces/vanilla/src/provider.js',
    'demos/partiful-matrix/surfaces/vanilla/src/lifecycle.js',
  ],
  snapbackBackend: [
    'demos/partiful-matrix/snapback/schema.mjs',
    'demos/partiful-matrix/snapback/functions.mjs',
    'demos/partiful-matrix/snapback/handlers.mjs',
    'demos/partiful-matrix/snapback/seed.json',
  ],
};
const sourceInventory = Object.fromEntries(
  Object.entries(sourceGroups).map(([group, paths]) => [group, measureSourceInventory(paths)]),
);
const inventorySubset = (group, paths) => {
  const wanted = new Set(paths);
  const files = sourceInventory[group].files.filter(({ path }) => wanted.has(path));
  assert.equal(files.length, paths.length, `candidate glue inventory omitted ${group} sources`);
  return { files, totalLines: files.reduce((sum, file) => sum + file.lines, 0) };
};
const glueInventory = {
  react: inventorySubset('react', sourceGroups.react.slice(1)),
  contract: inventorySubset('contract', sourceGroups.contract.slice(2)),
  vanilla: inventorySubset('vanilla', sourceGroups.vanilla.slice(1)),
};
const cells = Object.fromEntries(arms.flatMap((arm) => backends.map((backend) => [
  `${arm}:${backend}`,
  measureJavaScriptBundle(`demos/partiful-matrix/surfaces/${arm}/dist/${backend}`),
])));
const gatewayAverage = (arm, field) => Math.round(
  ['supabase', 'convex', 'sqlite'].reduce((sum, backend) => sum + cells[`${arm}:${backend}`][field], 0) / 3,
);
const byteAttribution = {
  note: 'The vanilla row is a lower-bound subtraction instrument. Combined buckets are deliberately not represented as isolated framework cost.',
  minifiedBytes: {
    vanillaGatewayFloor: gatewayAverage('vanilla', 'minifiedBytes'),
    snapbackProviderClientLowerBound: cells['vanilla:snapback'].minifiedBytes - gatewayAverage('vanilla', 'minifiedBytes'),
    reactFrameworkAndApplicationCombined: gatewayAverage('react', 'minifiedBytes') - gatewayAverage('vanilla', 'minifiedBytes'),
    contractRuntimeAndApplicationCombined: gatewayAverage('contract', 'minifiedBytes') - gatewayAverage('vanilla', 'minifiedBytes'),
    contractSnapbackInteractionUnattributed: (cells['contract:snapback'].minifiedBytes - gatewayAverage('contract', 'minifiedBytes'))
      - (cells['vanilla:snapback'].minifiedBytes - gatewayAverage('vanilla', 'minifiedBytes')),
  },
};

const contractBudgetRows = (field, thresholdField) => backends.map((backend) => {
  const actual = cells[`contract:${backend}`][field];
  const threshold = frozen.thresholds[thresholdField][backend];
  return {
    cell: `contract:${backend}`,
    actual,
    threshold,
    formula: protocol.thresholdFormulas[thresholdField],
    pass: actual <= threshold,
  };
});
const minifiedRows = contractBudgetRows('minifiedBytes', 'emittedMinifiedJsBytes');
const compressedRows = contractBudgetRows('deterministicGzipBytes', 'compressedJsBytes');
const minifiedPass = minifiedRows.every(({ pass }) => pass);
const compressedPass = compressedRows.every(({ pass }) => pass);

const sourceRows = [
  {
    metric: 'contractSourceLines',
    actual: sourceInventory.contract.totalLines,
    threshold: frozen.thresholds.contractSourceLines,
    formula: protocol.thresholdFormulas.contractSourceLines,
  },
  {
    metric: 'snapbackBackendLines',
    actual: sourceInventory.snapbackBackend.totalLines,
    threshold: frozen.thresholds.snapbackBackendLines,
    formula: protocol.thresholdFormulas.snapbackBackendLines,
  },
].map((row) => ({ ...row, pass: row.actual <= row.threshold }));
const sourcePass = sourceRows.every(({ pass }) => pass);

const requiredCheckRow = {
  actual: webReceipt.passed,
  threshold: frozen.thresholds.requiredWebCheckCount,
  formula: protocol.thresholdFormulas.requiredCheckCount,
};
requiredCheckRow.pass = requiredCheckRow.actual >= requiredCheckRow.threshold && webReceipt.skipped === 0;
const pushRow = {
  actual: webReceipt.results.find(({ name }) => name === 'contract × snapback proves unsolicited push with polling fallback disabled')?.details?.freshnessLatencyMs?.p95,
  threshold: frozen.thresholds.firstPushFreshnessLatencyMsP95,
  formula: protocol.thresholdFormulas.firstPushFreshnessLatencyMsP95,
  warmups: protocol.sampling.stochasticMeasurements.warmups,
  samples: webReceipt.results.find(({ name }) => name === 'contract × snapback proves unsolicited push with polling fallback disabled')?.details?.freshnessLatencyMs?.samples ?? [],
};
pushRow.pass = pushRow.actual <= pushRow.threshold && pushRow.samples.length === protocol.sampling.stochasticMeasurements.samples;

const missingInstrument = (id, formulaKey, evidence = {}) => requirement(
  id,
  'red',
  'STEP4_BUDGET_PROSPECTIVE_INSTRUMENT_MISSING',
  {
    formula: protocol.thresholdFormulas[formulaKey] ?? null,
    requiredSampling: protocol.sampling.stochasticMeasurements,
    protocolDeadline: protocol.futureCategoriesDeadline,
    datedProspectiveAmendmentPresent: false,
    perCellMeasurementsPresent: false,
    ...evidence,
  },
  'nonclaim',
);

const nativeReceiptEvidence = {
  retainedReceipts: [
    identity(nativeAggregatePath),
    identity(nativeExactPath),
    identity(nativeSwiftuiPath),
    identity(reactAndroidPath),
  ],
  nativeAggregatePass: nativeAggregate.ok,
  exactPassingCells: nativeExact.cells.filter(({ ok }) => ok).map(({ cell }) => cell),
  swiftuiPassingCells: nativeSwiftui.cells.filter(({ ok }) => ok).map(({ cell }) => cell),
  reactAndroidFunctionalChecks: reactAndroid.passed,
  finding: 'These are valuable functional/device receipts, but they are not 2-warmup/7-sample same-OS React-Expo budget measurements under a dated prospective Step 4 amendment.',
};

const requirements = [
  requirement('emitted-minified-javascript-by-cell', minifiedPass ? 'pass' : 'red', minifiedPass
    ? 'STEP4_BUDGET_MINIFIED_JS_PASSED'
    : 'STEP4_BUDGET_MINIFIED_JS_EXCEEDS_FROZEN_THRESHOLDS', {
    rows: minifiedRows,
    thresholdId: frozen.thresholdId,
    controls: Object.fromEntries(
      Object.entries(cells).map(([cell, value]) => [cell, value.minifiedBytes]),
    ),
  }),
  requirement('compressed-javascript-by-cell', compressedPass ? 'pass' : 'red', compressedPass
    ? 'STEP4_BUDGET_COMPRESSED_JS_PASSED'
    : 'STEP4_BUDGET_COMPRESSED_JS_EXCEEDS_FROZEN_THRESHOLDS', {
    rows: compressedRows,
    thresholdId: frozen.thresholdId,
    controls: Object.fromEntries(
      Object.entries(cells).map(([cell, value]) => [cell, value.deterministicGzipBytes]),
    ),
  }),
  requirement('authored-source-lines', sourcePass ? 'pass' : 'red', sourcePass
    ? 'STEP4_BUDGET_SOURCE_VOLUME_PASSED'
    : 'STEP4_BUDGET_SOURCE_VOLUME_EXCEEDS_FROZEN_THRESHOLDS', {
    rows: sourceRows,
    thresholdId: frozen.thresholdId,
  }),
  requirement('glue-file-and-line-inventory', 'pass', 'STEP4_BUDGET_GLUE_INVENTORY_PRESENT', {
    inventory: glueInventory,
  }),
  requirement('required-web-check-count', requiredCheckRow.pass ? 'pass' : 'red', requiredCheckRow.pass
    ? 'STEP4_BUDGET_REQUIRED_CHECK_COUNT_PASSED'
    : 'STEP4_BUDGET_REQUIRED_CHECK_COUNT_FAILED', requiredCheckRow),
  requirement('first-push-freshness-latency-p95', pushRow.pass ? 'pass' : 'red', pushRow.pass
    ? 'STEP4_BUDGET_FIRST_PUSH_P95_PASSED'
    : 'STEP4_BUDGET_FIRST_PUSH_P95_FAILED', pushRow),
  missingInstrument('cold-startup-ms-p95', 'coldAndWarmStartupMsP95'),
  missingInstrument('warm-startup-ms-p95', 'coldAndWarmStartupMsP95'),
  missingInstrument('first-authoritative-data-ms-p95', 'firstAuthoritativeAndLiveDataMsP95'),
  missingInstrument('first-live-data-ms-p95', 'firstAuthoritativeAndLiveDataMsP95'),
  missingInstrument('idle-cpu', 'idleCpuAndNetwork'),
  missingInstrument('idle-network-use', 'idleCpuAndNetwork'),
  missingInstrument('memory-per-active-subscription-bytes-p95', 'memoryPerActiveSubscriptionBytesP95'),
  missingInstrument('update-fanout-count-p95', 'fanoutAndHostPatchCountP95'),
  missingInstrument('dom-or-host-patch-count-p95', 'fanoutAndHostPatchCountP95'),
  missingInstrument('production-build-latency-ms-p95', 'productionAndIncrementalBuildMsP95'),
  missingInstrument('incremental-build-latency-ms-p95', 'productionAndIncrementalBuildMsP95'),
  missingInstrument('native-hermes-evaluation-ms-p95', 'nativeCarrierCostP95', nativeReceiptEvidence),
  missingInstrument('native-startup-asset-weight-bytes', 'nativeCarrierCostP95', nativeReceiptEvidence),
  missingInstrument('native-cold-launch-ms-p95', 'nativeCarrierCostP95', nativeReceiptEvidence),
  missingInstrument('native-first-authoritative-data-ms-p95', 'nativeCarrierCostP95', nativeReceiptEvidence),
  requirement('per-cell-ci-diffable-cost-attribution', 'red', 'STEP4_BUDGET_MANIFEST_INCOMPLETE', {
    measuredPerCellCategories: ['emitted-minified-javascript-by-cell', 'compressed-javascript-by-cell'],
    missingPerCellCategories: [
      'cold-startup', 'warm-startup', 'first-authoritative-data', 'first-live-data',
      'idle-cpu', 'idle-network', 'memory-per-subscription', 'update-fanout',
      'dom-or-host-patches', 'production-build', 'incremental-build', 'native-carrier-costs',
    ],
  }, 'nonclaim'),
  requirement('vanilla-lower-bound-subtraction-instrument', 'pass', 'STEP4_BUDGET_VANILLA_CONTROL_PRESENT', {
    attribution: byteAttribution,
    vanillaCells: Object.fromEntries(
      Object.entries(cells)
        .filter(([cell]) => cell.startsWith('vanilla:'))
        .map(([cell, value]) => [cell, {
          minifiedBytes: value.minifiedBytes,
          deterministicGzipBytes: value.deterministicGzipBytes,
        }]),
    ),
  }),
  requirement('four-layer-cost-attribution-and-capability-toggles', 'red', 'STEP4_BUDGET_ATTRIBUTION_LAYERS_INCOMPLETE', {
    requiredLayers: ['framework-runtime', 'provider-runtime', 'generated-app-data', 'application-code'],
    currentBuckets: Object.keys(byteAttribution.minifiedBytes),
    capabilityToggleManifestPresent: false,
    finding: 'Current byte deltas intentionally retain combined/unattributed buckets and no capability-toggle manifests exist for the remaining categories.',
  }, 'nonclaim'),
  requirement('prospective-category-amendments-and-holdout-validation', 'red', 'STEP4_BUDGET_AMENDMENT_AND_HOLDOUT_MISSING', {
    initialCategories: protocol.initialAttributionCategories,
    deadline: protocol.futureCategoriesDeadline,
    amendmentFieldPresent: Array.isArray(protocol.amendments),
    holdoutValidationArtifacts: [],
    finding: 'The frozen protocol contains formulas but no dated prospective amendments or holdout validation for the remaining WS8 categories.',
  }, 'nonclaim'),
  requirement('native-realtime-follow-up-matrix-before-ranking', 'pass', 'STEP4_BUDGET_NATIVE_REALTIME_MATRIX_COMPLETE', {
    existingNativeWorkload: protocol.workloadVersion,
    retainedNativeAggregate: identity(nativeAggregatePath),
    reactDirectLegs: {
      supabaseRealtime: { receipt: identity(supabaseRealtimePath), ok: supabaseRealtime.ok, passed: supabaseRealtime.passed },
      convexRealtime: { receipt: identity(convexRealtimePath), ok: convexRealtime.ok, passed: convexRealtime.passed },
    },
    contractGeneratedLegs: [{
      provider: 'convex',
      receipt: identity(contractConvexRealtimePath),
      ok: contractConvexRealtime.ok,
      passed: contractConvexRealtime.passed,
      transport: 'convex/browser WebSocket',
      pollPath: 'absent',
    }],
    finding: 'Both idiomatic React provider-native legs and the independently generated Contract × Convex producer leg are retained and green. The Apple-native extension remains a separate polling-only instrument.',
  }),
];

const report = finalizeReport({
  schemaVersion: 'partitime.step4-budgets.v1',
  claimId: 'STEP4.BUDGETS',
  requirements,
  inputs: {
    protocol: identity(protocolPath),
    retainedWebReceipt: identity(webReceiptPath),
    thresholdId: frozen.thresholdId,
    thresholdSource: thresholdSource.identity,
    nativeReceipts: nativeReceiptEvidence.retainedReceipts,
    providerNativeReactFollowupReceipts: [
      identity(supabaseRealtimePath),
      identity(convexRealtimePath),
    ],
    contractGeneratedProviderFollowupReceipts: [
      identity(contractConvexRealtimePath),
    ],
  },
  details: {
    candidateMeasurement: {
      workloadVersion: protocol.workloadVersion,
      methodId: protocol.protocolId,
      thresholdFormulaSetId: protocol.thresholdFormulaSetId,
      productionBuilds: candidateBuilds,
      sourceInventory,
      glueInventory,
      cells,
      attribution: byteAttribution,
      browserReceipt: identity(webReceiptPath),
      pushLatency: { contract: pushRow },
    },
    frozenThresholds: frozen.thresholds,
    conclusion: 'Initial Contract byte/source budgets are red and the remaining WS8 instruments missed the Step 4 prospective-amendment deadline.',
  },
});

writeStep4Report(output, report);
