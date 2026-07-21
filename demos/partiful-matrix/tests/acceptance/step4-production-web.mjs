#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  acceptanceRoot,
  exactIdentity,
  finalizeReport,
  identity,
  measureJavaScriptBundle,
  readExactText,
  readJson,
  requirement,
  retainedResult,
  validateRetainedWebReceipt,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// production-web authority comes from the immutable-artifact browser run and
// the residual real-browser/device release matrix, not source inspection.

const output = `${acceptanceRoot}/results/step4-production-web.json`;
const step0ReceiptPath = 'demos/partiful-matrix/acceptance/results/step0-web.json';
const productionReceiptPath = 'demos/partiful-matrix/acceptance/results/step4-production-web-browser.json';
const citizenshipReceiptPath = 'demos/partiful-matrix/acceptance/results/step4-web-citizenship.json';
const staticExportPath = 'demos/partiful-matrix/surfaces/contract/dist/snapback/static-export.json';
const feedHtmlPath = 'demos/partiful-matrix/surfaces/contract/dist/snapback/index.html';
const eventHtmlPath = 'demos/partiful-matrix/surfaces/contract/dist/snapback/events/event_sunset/index.html';
const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';

const step0Receipt = readJson(step0ReceiptPath);
validateRetainedWebReceipt(step0Receipt);
const productionReceipt = readJson(productionReceiptPath);
const citizenshipReceipt = existsSync(`${acceptanceRoot}/results/step4-web-citizenship.json`)
  ? readJson(citizenshipReceiptPath)
  : null;
const staticExport = readJson(staticExportPath);

assert.equal(productionReceipt.ok, true, 'retained production-web browser receipt is not green');
assert.equal(productionReceipt.passed, 9, 'production-web browser pass count drifted');
assert.equal(productionReceipt.total, 9, 'production-web browser check count drifted');
assert.equal(productionReceipt.failed, 0, 'production-web browser receipt contains failures');
assert.equal(productionReceipt.skipped, 0, 'production-web browser receipt contains skips');
assert.equal(productionReceipt.cleanupErrorCount, 0, 'production-web browser cleanup failed');
for (const entry of productionReceipt.testInventory ?? []) {
  assert.deepEqual(identity(entry.path), entry, `production-web input drifted: ${entry.path}`);
}
const citizenshipIssues = citizenshipReceipt === null
  ? ['receipt-missing']
  : [
      ...(citizenshipReceipt.ok === true ? [] : ['receipt-not-green']),
      ...(citizenshipReceipt.skipped === 0 ? [] : ['receipt-contains-skips']),
      ...(Array.isArray(citizenshipReceipt.rows) && citizenshipReceipt.rows.length > 0 ? [] : ['receipt-has-no-rows']),
    ];
const citizenshipPassed = citizenshipIssues.length === 0;

const result = (name) => retainedResult(productionReceipt, name);
const build = result('Contract production build emits immutable route artifacts');
const noJsFeed = result('Contract production feed is authoritative with JavaScript disabled');
const noJsEvent = result('Contract production event deep link is authoritative with route metadata and JavaScript disabled');
const feedHydration = result('Contract production feed adopts every node without replacement, stale flash, or duplicate subscription');
const eventHydration = result('Contract production event adopts every node with exactly three live query subscriptions');
const basepath = result('Contract production assets and deep links honor the non-root base path');
const history = result('Contract production history traverses feed and event without document reload');
const metadata = result('Contract production client metadata tracks the active route');
const push = result('Contract production hydrated event receives unsolicited Snapback push with polling disabled');

const exactVerifyPath = 'exact-verify.json';
const exactVerify = JSON.parse(readExactText(exactVerifyPath));
const exactCheckIds = new Set(exactVerify.checks.map(({ id }) => id));
const upstreamChecks = [
  'contract-web-host-csr',
  'contract-ssg-no-js',
  'contract-hydration-corpus',
  'web-citizenship-axe-delta',
  'web-bundle-budget',
  'web-citizenship-desktop-chrome',
  'web-citizenship-ime-forms',
];
const missingUpstreamChecks = upstreamChecks.filter((id) => !exactCheckIds.has(id));

const requirements = [
  requirement('production-build-artifact', 'pass', 'STEP4_WEB_PRODUCTION_BUILD_PASSED', {
    receipt: identity(productionReceiptPath),
    result: build.details,
    staticExport: identity(staticExportPath),
    pages: staticExport.pages,
    javascript: measureJavaScriptBundle('demos/partiful-matrix/surfaces/contract/dist/snapback'),
  }),
  requirement('browser-product-flow', 'pass', 'STEP4_WEB_BROWSER_FLOW_PASSED', {
    step0Receipt: identity(step0ReceiptPath),
    checks: [
      retainedResult(step0Receipt, 'contract × snapback boots its identified cell').name,
      retainedResult(step0Receipt, 'contract × snapback renders the canonical feed').name,
      retainedResult(step0Receipt, 'contract × snapback opens details and observes RSVP').name,
      retainedResult(step0Receipt, 'contract × snapback proves unsolicited push with polling fallback disabled').name,
    ],
  }),
  requirement('production-built-artifact-browser-execution', 'pass', 'STEP4_WEB_DIST_BROWSER_EXECUTION_PASSED', {
    receipt: identity(productionReceiptPath),
    servedMode: 'vite-preview-over-immutable-dist',
    checks: productionReceipt.results.map(({ name }) => name),
  }),
  requirement('browser-history', 'pass', 'STEP4_WEB_HISTORY_PASSED', history.details),
  requirement('deep-links', 'pass', 'STEP4_WEB_DEEP_LINKS_PASSED', {
    noJavaScriptEvent: noJsEvent.details,
    basepath: basepath.details,
    eventArtifact: identity(eventHtmlPath),
  }),
  requirement('ssr-ssg-authority', 'pass', 'STEP4_WEB_STATIC_AUTHORITY_PASSED', {
    feed: noJsFeed.details,
    event: noJsEvent.details,
    feedArtifact: identity(feedHtmlPath),
    eventArtifact: identity(eventHtmlPath),
  }),
  requirement('hydration-without-duplicates-or-stale-flash', 'pass', 'STEP4_WEB_HYDRATION_ADOPTION_PASSED', {
    feed: feedHydration.details,
    event: eventHydration.details,
  }),
  requirement('document-metadata', 'pass', 'STEP4_WEB_ROUTE_METADATA_PASSED', {
    staticEvent: noJsEvent.details,
    clientRoute: metadata.details,
  }),
  requirement('basepath', 'pass', 'STEP4_WEB_NON_ROOT_BASEPATH_PASSED', basepath.details),
  requirement('hydrated-push-without-polling', 'pass', 'STEP4_WEB_HYDRATED_PUSH_PASSED', push.details),
  requirement('exact-production-web-capabilities-registered', missingUpstreamChecks.length === 0 ? 'pass' : 'red',
    missingUpstreamChecks.length === 0
      ? 'STEP4_WEB_UPSTREAM_EXACT_CHECKS_REGISTERED'
      : 'STEP4_WEB_UPSTREAM_EXACT_CHECKS_MISSING', {
      registry: exactIdentity(exactVerifyPath),
      checks: upstreamChecks,
      missingChecks: missingUpstreamChecks,
    }),
  requirement(
    'residual-browser-device-ime-forms-matrix',
    citizenshipPassed ? 'pass' : 'red',
    citizenshipPassed ? 'STEP4_WEB_CITIZENSHIP_MATRIX_PASSED' : 'STEP4_WEB_CITIZENSHIP_MATRIX_MISSING_OR_RED',
    {
      receipt: citizenshipReceipt === null
        ? { path: citizenshipReceiptPath, missing: true }
        : identity(citizenshipReceiptPath),
      issues: citizenshipIssues,
      rows: citizenshipReceipt?.rows ?? [],
    },
  ),
];

const report = finalizeReport({
  schemaVersion: 'partitime.step4-production-web.v2',
  claimId: 'STEP4.PRODUCTION_WEB',
  requirements,
  inputs: {
    protocol: identity(protocolPath),
    step0WebReceipt: identity(step0ReceiptPath),
    productionBrowserReceipt: identity(productionReceiptPath),
    citizenshipReceipt: citizenshipReceipt === null
      ? { path: citizenshipReceiptPath, missing: true }
      : identity(citizenshipReceiptPath),
    staticExport: identity(staticExportPath),
    exactVerifyRegistry: exactIdentity(exactVerifyPath),
  },
  details: {
    conclusion: citizenshipPassed
      ? 'Partitime passes the immutable production-web, hydration, routing, metadata, push, and residual citizenship gates.'
      : 'Partitime passes the immutable production-web, hydration, routing, metadata, and push gates; the residual citizenship matrix remains red.',
  },
});

writeStep4Report(output, report);
