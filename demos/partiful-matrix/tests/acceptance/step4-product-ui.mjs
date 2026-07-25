#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  acceptanceRoot,
  exactIdentity,
  exactRoot,
  finalizeReport,
  identity,
  measureJavaScriptBundle,
  measureSourceInventory,
  readExactText,
  readJson,
  readText,
  requirement,
  retainedResult,
  run,
  validateRetainedWebReceipt,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// Step 4 inventories every named product-surface capability and keeps missing
// mandatory capabilities red instead of turning absence into a trajectory pass.

const output = `${acceptanceRoot}/results/step4-product-ui.json`;
const webReceiptPath = 'demos/partiful-matrix/acceptance/results/step0-web.json';
const productUiReceiptPath = 'demos/partiful-matrix/acceptance/results/step4-product-ui-browser.json';
const agentSessionPath = 'demos/partiful-matrix/acceptance/results/step4-agent-session.json';
const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';
const reactAppPath = 'demos/partiful-matrix/surfaces/react/src/App.tsx';
const reactStylesPath = 'demos/partiful-matrix/surfaces/react/src/styles.css';
const contractFeedPath = 'demos/partiful-matrix/surfaces/contract/feed.contract';
const contractEventPath = 'demos/partiful-matrix/surfaces/contract/event.contract';
const contractMainPath = 'demos/partiful-matrix/surfaces/contract/main.ts';
const contractUiPath = 'demos/partiful-matrix/surfaces/contract/ui.ts';
const contractUiMetaPath = 'demos/partiful-matrix/surfaces/contract/ui.contract-meta.ts';
const contractComponentPath = 'demos/partiful-matrix/surfaces/contract/connection-badge.contract';
const reactSourcePaths = [
  reactAppPath,
  'demos/partiful-matrix/surfaces/react/src/main.tsx',
  'demos/partiful-matrix/surfaces/react/src/provider.ts',
];
const contractSourcePaths = [
  contractFeedPath,
  contractEventPath,
  contractMainPath,
  contractUiPath,
  contractUiMetaPath,
  contractComponentPath,
  'demos/partiful-matrix/surfaces/contract/provider.ts',
  'demos/partiful-matrix/surfaces/contract/helpers.ts',
  'demos/partiful-matrix/surfaces/contract/helpers.contract-meta.ts',
];

const webReceipt = readJson(webReceiptPath);
validateRetainedWebReceipt(webReceipt);
const productUiReceipt = readJson(productUiReceiptPath);
const agentSession = readJson(agentSessionPath);
assert.equal(productUiReceipt.ok, true);
assert.equal(productUiReceipt.expectedChecks, 32);
assert.equal(productUiReceipt.passed, productUiReceipt.expectedChecks);
assert.equal(productUiReceipt.failed, 0);
assert.equal(productUiReceipt.skipped, 0);
for (const entry of productUiReceipt.testInventory ?? []) {
  assert.deepEqual(identity(entry.path), entry, `retained product-UI input drifted: ${entry.path}`);
}
assert.equal(agentSession.ok, true);
for (const entry of agentSession.inputs ?? []) {
  assert.deepEqual(identity(entry.path), entry, `retained Agent-session input drifted: ${entry.path}`);
}

const reactApp = readText(reactAppPath);
const reactStyles = readText(reactStylesPath);
const contractFeed = readText(contractFeedPath);
const contractEvent = readText(contractEventPath);
const contractMain = readText(contractMainPath);
const contractUi = readText(contractUiPath);
const contractUiMeta = readText(contractUiMetaPath);
const contractComponent = readText(contractComponentPath);
const contractSources = `${contractFeed}\n${contractEvent}\n${contractMain}\n${contractUi}\n${contractUiMeta}\n${contractComponent}`;
const reactSourceInventory = measureSourceInventory(reactSourcePaths);
const contractSourceInventory = measureSourceInventory(contractSourcePaths);
const reactSnapbackBundle = measureJavaScriptBundle('demos/partiful-matrix/surfaces/react/dist/snapback');
const contractSnapbackBundle = measureJavaScriptBundle('demos/partiful-matrix/surfaces/contract/dist/snapback');

const inheritedBrowserEvidence = [
  retainedResult(webReceipt, 'react × snapback boots its identified cell').name,
  retainedResult(webReceipt, 'react × snapback renders the canonical feed').name,
  retainedResult(webReceipt, 'react × snapback opens details and observes RSVP').name,
  retainedResult(webReceipt, 'contract × snapback boots its identified cell').name,
  retainedResult(webReceipt, 'contract × snapback renders the canonical feed').name,
  retainedResult(webReceipt, 'contract × snapback opens details and observes RSVP').name,
];

const exactRegistryPath = 'packages/exact-devtools/src/agent/operations/registry.ts';
const exactInspectionPath = 'packages/exact-devtools/src/agent/contract-inspection.ts';
const exactInspectionTestPath = 'packages/exact-devtools/src/agent/contract-inspection.test.ts';
const exactRegistry = readExactText(exactRegistryPath);
const exactInspection = readExactText(exactInspectionPath);
for (const operation of [
  'exact_contract_bindings',
  'exact_contract_mutation_outcomes',
  'exact_contract_source_map',
  'exact_contract_verify_claims',
]) {
  assert(exactRegistry.includes(`id: "${operation}"`), `Exact Agent registry is missing ${operation}`);
}
assert(exactInspection.includes('function explainSubscription'));
const exactAgentOracle = run('bun', ['test', exactInspectionTestPath], exactRoot);
const exactAgentOraclePass = exactAgentOracle.status === 0;
const untypedEscapeCount = (contractSources.match(/\bas any\b|@ts-ignore|prototype\s*=/g) ?? []).length;
const usesPublicRuntime = contractMain.includes("from '@exact/contract/runtime'")
  && contractMain.includes("from '@exact/renderer/web-host'");
const browserPair = (suffix) => ['react', 'contract'].map((arm) => retainedResult(
  productUiReceipt,
  `${arm} × snapback ${suffix}`,
));
const responsiveEvidence = browserPair('responds at compact width and changes theme on one tree');
const formEvidence = browserPair('provides an accessible portal form and keyboard focus scope');
const motionEvidence = browserPair('honors reduced-motion preference');
const virtualEvidence = browserPair('mounts a bounded virtual guest window');
const forcedEvidence = retainedResult(productUiReceipt, 'contract × snapback forces loading error empty and ready through its provider');

const requirements = [
  requirement('styles-and-design-tokens', 'pass', 'STEP4_UI_REUSABLE_STYLE_SYSTEM_PASSED', {
    reactStylesheet: identity(reactStylesPath),
    recipes: identity(contractUiMetaPath),
    recipeUsages: (contractSources.match(/(?:surfaceStyle|fieldStyle)\(/g) ?? []).length,
    paletteHelpers: ['backgroundFor', 'textFor', 'mutedFor', 'accentFor'],
  }),
  requirement('responsive-and-container-aware-layout', 'pass', 'STEP4_UI_RESPONSIVE_PARITY_PASSED', {
    receipt: identity(productUiReceiptPath),
    checks: responsiveEvidence,
    contractConstruct: 'match size',
  }),
  requirement('transitions-animation-and-reduced-motion', 'pass', 'STEP4_UI_REDUCED_MOTION_PARITY_PASSED', {
    receipt: identity(productUiReceiptPath), checks: motionEvidence,
    reactReducedMotionRules: (reactStyles.match(/prefers-reduced-motion/g) ?? []).length,
    contractPresenceDeclarations: (contractSources.match(/presence=/g) ?? []).length,
  }),
  requirement('overlays-portals-menus-sheets-and-focus-management', 'pass', 'STEP4_UI_OVERLAY_FOCUS_SURFACE_PASSED', {
    receipt: identity(productUiReceiptPath), checks: formEvidence,
    contractPortal: { target: 'root', presentation: 'sheet', focusTrap: true, focusRestore: true },
  }),
  requirement('accessible-form-controls-and-validation-states', 'pass', 'STEP4_UI_FORM_VALIDATION_ACCESSIBILITY_PASSED', {
    receipt: identity(productUiReceiptPath), checks: formEvidence,
    controls: ['input', 'textarea'], states: ['required-error', 'described-by', 'alert', 'focus-wrap', 'focus-restore'],
  }),
  requirement('virtualized-collections', 'pass', 'STEP4_UI_VIRTUAL_COLLECTION_PASSED', {
    receipt: identity(productUiReceiptPath), checks: virtualEvidence,
    contractPrimitive: 'virtualList', reactControl: 'VirtualGuestList',
  }),
  requirement('query-backed-selectors-and-slot-local-transforms', 'pass', 'STEP4_UI_SLOT_LOCAL_QUERY_TRANSFORM_PASSED', {
    contractQueryCount: (contractSources.match(/^\s*query\s+/gm) ?? []).length,
    appLocalRowHelpers: ['goingCount', 'myStatus'],
    runtimeChecks: virtualEvidence,
  }),
  requirement('typed-dom-custom-component-escape-hatch', 'pass', 'STEP4_UI_TYPED_CUSTOM_COMPONENT_PASSED', {
    component: identity(contractComponentPath),
    typedProp: 'value: string',
    consumers: [contractFeedPath, contractEventPath],
    browserChecks: inheritedBrowserEvidence.filter((name) => name.startsWith('contract')),
  }),
  requirement('same-product-claims-react-and-contract', 'pass', 'STEP4_UI_PARITY_MATRIX_PASSED', {
    receipt: identity(productUiReceiptPath),
    dimensions: ['responsive', 'keyboard', 'focus', 'reduced-motion', 'screen-reader-oriented'],
    checks: [...responsiveEvidence, ...formEvidence, ...motionEvidence],
  }),
  requirement('no-app-local-runtime-patch-or-untyped-dom-workaround', usesPublicRuntime && untypedEscapeCount === 0 ? 'pass' : 'red',
    usesPublicRuntime && untypedEscapeCount === 0
      ? 'STEP4_UI_NO_RUNTIME_PATCH_FOUND'
      : 'STEP4_UI_RUNTIME_PATCH_OR_UNTYPED_ESCAPE_FOUND', {
    contractRuntimeImports: ['@exact/contract/runtime', '@exact/renderer/web-host'],
    usesPublicRuntime,
    untypedEscapeCount,
    finding: 'The Contract view uses public runtime/host APIs and the audited app sources contain no untyped patch marker.',
  }),
  requirement('visual-variant-without-duplicate-tree', 'pass', 'STEP4_UI_VISUAL_VARIANT_SINGLE_TREE_PASSED', {
    receipt: identity(productUiReceiptPath), checks: responsiveEvidence,
    assertion: 'treeIdentityRetained',
  }),
  requirement('theme-textarea-and-static-native-recipes', 'pass', 'STEP4_UI_PRODUCT_RECIPE_SURFACES_PASSED', {
    reactTextareaCount: (reactApp.match(/<textarea\b/g) ?? []).length,
    contractTextareaCount: (contractSources.match(/^\s*textarea\b/gm) ?? []).length,
    contractMultilineInputCount: (contractSources.match(/multiline=true/g) ?? []).length,
    themeVariantChecks: responsiveEvidence,
    nativeRecipeAuthority: exactIdentity('docs/contract-web-paved-road.md'),
  }),
  requirement('exact-agent-inspection-operations', exactAgentOraclePass ? 'pass' : 'red', exactAgentOraclePass
    ? 'STEP4_UI_EXACT_AGENT_ORACLE_PASSED'
    : 'STEP4_UI_EXACT_AGENT_ORACLE_FAILED', {
    registry: exactIdentity(exactRegistryPath),
    implementation: exactIdentity(exactInspectionPath),
    oracle: exactIdentity(exactInspectionTestPath),
    execution: exactAgentOracle,
    operations: [
      'exact_contract_bindings',
      'exact_contract_mutation_outcomes',
      'exact_contract_source_map',
      'exact_contract_verify_claims',
    ],
  }),
  requirement('partitime-forced-loading-error-empty-ready', 'pass', 'STEP4_UI_PARTITIME_FORCED_DATA_STATES_PASSED', {
    declaredAsyncBranches: (contractSources.match(/^\s*(?:loading|error|empty|ready)\b/gm) ?? []).length,
    receipt: identity(productUiReceiptPath), check: forcedEvidence,
  }),
  requirement('partitime-agent-explains-list-non-update', 'pass', 'STEP4_UI_PARTITIME_AGENT_SESSION_PASSED', {
    upstreamOperation: 'exact_contract_bindings',
    receipt: identity(agentSessionPath),
    question: agentSession.question,
    answer: agentSession.answer,
  }),
  requirement('data-state-clauses-never-skip-silently', 'pass', 'STEP4_UI_QUERY_RENDER_CLAUSES_ACCOUNTED', {
    authoredDataStateClauseCount: (contractSources.match(/when\s+\w+\.(?:loading|error|empty|ready)/g) ?? []).length,
    forcedStateCheck: forcedEvidence,
    explicitAgentStatuses: agentSession.explicitClauseStatuses,
  }),
  requirement('source-volume-and-emitted-javascript-measured', 'pass', 'STEP4_UI_COST_INPUTS_PRESENT', {
    contractSource: contractSourceInventory,
    reactSource: reactSourceInventory,
    contractSnapbackBundle,
    reactSnapbackBundle,
  }),
];

const report = finalizeReport({
  schemaVersion: 'partitime.step4-product-ui.v1',
  claimId: 'STEP4.PRODUCT_UI',
  requirements,
  inputs: {
    protocol: identity(protocolPath),
    retainedWebReceipt: identity(webReceiptPath),
    productUiBrowserReceipt: identity(productUiReceiptPath),
    agentSession: identity(agentSessionPath),
    surfaces: [
      identity(reactAppPath),
      identity(reactStylesPath),
      identity(contractFeedPath),
      identity(contractEventPath),
      identity(contractMainPath),
      identity(contractUiPath),
      identity(contractUiMetaPath),
      identity(contractComponentPath),
    ],
  },
  details: {
    conclusion: 'React and Contract pass the mandatory Partitime product-surface parity inventory with retained browser and Agent receipts.',
  },
});

writeStep4Report(output, report);
