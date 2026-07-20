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
const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';
const reactAppPath = 'demos/partiful-matrix/surfaces/react/src/App.tsx';
const reactStylesPath = 'demos/partiful-matrix/surfaces/react/src/styles.css';
const contractFeedPath = 'demos/partiful-matrix/surfaces/contract/feed.contract';
const contractEventPath = 'demos/partiful-matrix/surfaces/contract/event.contract';
const contractMainPath = 'demos/partiful-matrix/surfaces/contract/main.ts';
const reactSourcePaths = [
  reactAppPath,
  'demos/partiful-matrix/surfaces/react/src/main.tsx',
  'demos/partiful-matrix/surfaces/react/src/provider.ts',
];
const contractSourcePaths = [
  contractFeedPath,
  contractEventPath,
  contractMainPath,
  'demos/partiful-matrix/surfaces/contract/provider.ts',
  'demos/partiful-matrix/surfaces/contract/helpers.ts',
  'demos/partiful-matrix/surfaces/contract/helpers.contract-meta.ts',
];

const webReceipt = readJson(webReceiptPath);
validateRetainedWebReceipt(webReceipt);

const reactApp = readText(reactAppPath);
const reactStyles = readText(reactStylesPath);
const contractFeed = readText(contractFeedPath);
const contractEvent = readText(contractEventPath);
const contractMain = readText(contractMainPath);
const contractSources = `${contractFeed}\n${contractEvent}\n${contractMain}`;
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

const requirements = [
  requirement('styles-and-design-tokens', 'red', 'STEP4_UI_REUSABLE_STYLE_SYSTEM_UNWITNESSED', {
    reactStylesheet: identity(reactStylesPath),
    reactClassCount: (reactApp.match(/className=/g) ?? []).length,
    contractLiteralColorCount: (contractSources.match(/#[0-9a-fA-F]{3,8}/g) ?? []).length,
    finding: 'The app has styling, but no Partitime witness proves reusable Contract styles/classes and shared design tokens.',
  }, 'nonclaim'),
  requirement('responsive-and-container-aware-layout', 'red', 'STEP4_UI_CONTRACT_RESPONSIVE_PARITY_MISSING', {
    reactMediaQueryCount: (reactStyles.match(/@media/g) ?? []).length,
    contractResponsiveConstructCount: (contractSources.match(/\b(?:media|container|breakpoint|responsive)\b/gi) ?? []).length,
    finding: 'React has a mobile breakpoint; the Contract tree uses fixed row layouts and has no responsive/container witness.',
  }, 'nonclaim'),
  requirement('transitions-animation-and-reduced-motion', 'red', 'STEP4_UI_REDUCED_MOTION_PARITY_MISSING', {
    reactTransitionCount: (reactStyles.match(/transition\s*:/g) ?? []).length,
    reducedMotionRuleCount: (reactStyles.match(/prefers-reduced-motion/g) ?? []).length,
    contractMotionConstructCount: (contractSources.match(/\b(?:transition|animate|animation|motion)\b/gi) ?? []).length,
  }, 'nonclaim'),
  requirement('overlays-portals-menus-sheets-and-focus-management', 'red', 'STEP4_UI_OVERLAY_FOCUS_SURFACE_UNEXERCISED', {
    partitimeSurfaceMatches: (contractSources.match(/\b(?:overlay|portal|menu|sheet|focus)\b/gi) ?? []).length,
    finding: 'Partitime contains no executable overlay/portal/menu/sheet/focus-management case.',
  }, 'nonclaim'),
  requirement('accessible-form-controls-and-validation-states', 'red', 'STEP4_UI_FORM_VALIDATION_ACCESSIBILITY_UNPROVEN', {
    reactAriaLabelCount: (reactApp.match(/aria-label=/g) ?? []).length,
    contractInputLabelCount: (contractSources.match(/\binput\s+label=/g) ?? []).length,
    finding: 'Both arms name inputs, but no screen-reader, validation-error association, IME, or focus-on-error witness exists for Partitime.',
  }, 'nonclaim'),
  requirement('virtualized-collections', 'red', 'STEP4_UI_VIRTUAL_COLLECTION_UNEXERCISED', {
    reactMatches: (reactApp.match(/virtual/gi) ?? []).length,
    contractMatches: (contractSources.match(/virtual/gi) ?? []).length,
  }, 'nonclaim'),
  requirement('query-backed-selectors-and-slot-local-transforms', 'red', 'STEP4_UI_SLOT_LOCAL_QUERY_TRANSFORM_UNWITNESSED', {
    contractQueryCount: (contractSources.match(/^\s*query\s+/gm) ?? []).length,
    appLocalRowHelpers: ['goingCount', 'myStatus'],
    finding: 'Queries and app-local row helpers exist, but the Exact 0265 slot-local transform obligation has no Partitime witness.',
  }, 'nonclaim'),
  requirement('typed-dom-custom-component-escape-hatch', 'red', 'STEP4_UI_TYPED_ESCAPE_HATCH_UNEXERCISED', {
    finding: 'The Partitime workload never exercises a typed custom DOM/component escape while retaining Contract verification.',
  }, 'nonclaim'),
  requirement('same-product-claims-react-and-contract', 'red', 'STEP4_UI_PARITY_MATRIX_INCOMPLETE', {
    inheritedProductionBrowserChecks: inheritedBrowserEvidence,
    missingDimensions: ['responsive', 'keyboard', 'focus', 'reduced-motion', 'screen-reader-oriented'],
    finding: 'The retained browser suite proves pointer-driven product flow, not the five mandatory parity dimensions.',
  }, 'nonclaim'),
  requirement('no-app-local-runtime-patch-or-untyped-dom-workaround', usesPublicRuntime && untypedEscapeCount === 0 ? 'pass' : 'red',
    usesPublicRuntime && untypedEscapeCount === 0
      ? 'STEP4_UI_NO_RUNTIME_PATCH_FOUND'
      : 'STEP4_UI_RUNTIME_PATCH_OR_UNTYPED_ESCAPE_FOUND', {
    contractRuntimeImports: ['@exact/contract/runtime', '@exact/renderer/web-host'],
    usesPublicRuntime,
    untypedEscapeCount,
    finding: 'The Contract view uses public runtime/host APIs and the audited app sources contain no untyped patch marker.',
  }),
  requirement('visual-variant-without-duplicate-tree', 'red', 'STEP4_UI_VISUAL_VARIANT_WITNESS_MISSING', {
    finding: 'No visual-variant input and single-tree structural witness is registered for either Partitime arm.',
  }, 'nonclaim'),
  requirement('theme-textarea-and-static-native-recipes', 'red', 'STEP4_UI_PRODUCT_RECIPE_SURFACES_MISSING', {
    reactTextareaCount: (reactApp.match(/<textarea\b/g) ?? []).length,
    contractTextareaCount: (contractSources.match(/^\s*textarea\b/gm) ?? []).length,
    themeVariantCount: (contractSources.match(/\btheme\b/gi) ?? []).length,
    finding: 'Theme, textarea, and documented static/native recipe acceptance are absent from the workload.',
  }, 'nonclaim'),
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
  requirement('partitime-forced-loading-error-empty-ready', 'red', 'STEP4_UI_PARTITIME_FORCED_DATA_STATES_MISSING', {
    declaredAsyncBranches: (contractSources.match(/^\s*(?:loading|error|empty|ready)\b/gm) ?? []).length,
    forcedStateFixtureCount: (contractSources.match(/forceQueryState|force.*(?:loading|error|empty|ready)/gi) ?? []).length,
    finding: 'The render branches exist, but Partitime has no command that forces all four states through the real Snapback provider.',
  }, 'nonclaim'),
  requirement('partitime-agent-explains-list-non-update', 'red', 'STEP4_UI_PARTITIME_AGENT_SESSION_MISSING', {
    upstreamOperation: 'exact_contract_bindings',
    partitimeAgentBootHookCount: (contractMain.match(/agent|contractBindings/gi) ?? []).length,
    finding: 'The upstream explanation API exists, but no mounted Partitime Agent session asks and answers why a list did not update.',
  }, 'nonclaim'),
  requirement('data-state-clauses-never-skip-silently', 'red', 'STEP4_UI_QUERY_RENDER_CLAUSES_UNREGISTERED', {
    partitimeQueryRenderClauseCount: (contractSources.match(/query\s+\w+\s+renders\s+(?:loading|error|empty|ready)/g) ?? []).length,
    finding: 'No Partitime query-state clauses or enforcement-status receipt exists; upstream interaction-clause reporting cannot substitute for this obligation.',
  }, 'nonclaim'),
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
    surfaces: [
      identity(reactAppPath),
      identity(reactStylesPath),
      identity(contractFeedPath),
      identity(contractEventPath),
      identity(contractMainPath),
    ],
  },
  details: {
    conclusion: 'React × Snapback remains the polished-web default because mandatory product-surface parity is not closed.',
  },
});

writeStep4Report(output, report);
