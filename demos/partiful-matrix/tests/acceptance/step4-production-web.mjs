#!/usr/bin/env node

import {
  acceptanceRoot,
  exactIdentity,
  finalizeReport,
  identity,
  measureJavaScriptBundle,
  readExactText,
  readJson,
  readText,
  requirement,
  retainedResult,
  validateRetainedWebReceipt,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// the production-web claim requires Partitime integration evidence for every
// named surface; generic Exact capability registrations are recorded separately.

const output = `${acceptanceRoot}/results/step4-production-web.json`;
const webReceiptPath = 'demos/partiful-matrix/acceptance/results/step0-web.json';
const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';
const contractHtmlPath = 'demos/partiful-matrix/surfaces/contract/dist/snapback/index.html';
const contractSourceHtmlPath = 'demos/partiful-matrix/surfaces/contract/index.html';
const contractMainPath = 'demos/partiful-matrix/surfaces/contract/main.ts';
const contractHelpersPath = 'demos/partiful-matrix/surfaces/contract/helpers.ts';
const reactAppPath = 'demos/partiful-matrix/surfaces/react/src/App.tsx';

const webReceipt = readJson(webReceiptPath);
validateRetainedWebReceipt(webReceipt);

const contractHtml = readText(contractHtmlPath);
const contractSourceHtml = readText(contractSourceHtmlPath);
const contractMain = readText(contractMainPath);
const contractHelpers = readText(contractHelpersPath);
const reactApp = readText(reactAppPath);
const contractBundle = measureJavaScriptBundle('demos/partiful-matrix/surfaces/contract/dist/snapback');

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
const manualImeCheck = exactVerify.checks.find(({ id }) => id === 'web-citizenship-ime-forms');
const deepLinkBootPresent = contractMain.includes("params.get('event')");
const deepLinkNavigationPresent = contractHelpers.includes("params.set('event', eventId)");

const browserFlow = [
  retainedResult(webReceipt, 'contract × snapback boots its identified cell').name,
  retainedResult(webReceipt, 'contract × snapback renders the canonical feed').name,
  retainedResult(webReceipt, 'contract × snapback opens details and observes RSVP').name,
  retainedResult(webReceipt, 'contract × snapback proves unsolicited push with polling fallback disabled').name,
];

const requirements = [
  requirement('production-build-artifact', 'pass', 'STEP4_WEB_PRODUCTION_BUILD_PRESENT', {
    html: identity(contractHtmlPath),
    javascript: contractBundle,
  }),
  requirement('browser-product-flow', 'pass', 'STEP4_WEB_BROWSER_FLOW_INHERITED', {
    receipt: identity(webReceiptPath),
    checks: browserFlow,
    caveat: 'The retained runner starts Vite source-mode servers; it is product-flow evidence, not a browser execution of dist/.',
  }),
  requirement('production-built-artifact-browser-execution', 'red', 'STEP4_WEB_DIST_BROWSER_RECEIPT_MISSING', {
    productionArtifactPresent: true,
    retainedBrowserServerMode: 'vite-source-mode',
    finding: 'No retained receipt serves the immutable Contract dist/snapback artifact and executes the product flow against it.',
  }, 'nonclaim'),
  requirement('browser-history', 'red', 'STEP4_WEB_HISTORY_MODEL_INCOMPLETE', {
    contractNavigation: 'location.assign with search parameters',
    contractHistoryApiCount: (contractHelpers.match(/history\.(?:pushState|replaceState)|popstate/g) ?? []).length,
    reactBrowserNavigationApiCount: (
      reactApp.match(/(?:window\.|globalThis\.)?location\.(?:assign|replace|href)|history\.(?:pushState|replaceState)|popstate/g) ?? []
    ).length,
    finding: 'Contract navigation reloads; React detail navigation is component state only. Back/forward history behavior has no executable parity witness.',
  }, 'nonclaim'),
  requirement('deep-links', deepLinkBootPresent && deepLinkNavigationPresent ? 'pass' : 'red',
    deepLinkBootPresent && deepLinkNavigationPresent
      ? 'STEP4_WEB_CONTRACT_QUERY_DEEP_LINK_FLOW_PASSED'
      : 'STEP4_WEB_CONTRACT_QUERY_DEEP_LINK_FLOW_MISSING', {
    bootReadsEventParameter: deepLinkBootPresent,
    navigationWritesEventParameter: deepLinkNavigationPresent,
    browserCheck: 'contract × snapback opens details and observes RSVP',
    caveat: 'This passes the Contract query-parameter route used by Partitime; React parity and path routing remain outside this item.',
  }),
  requirement('ssr-ssg-authority', 'red', 'STEP4_WEB_PARTITIME_SSR_SSG_MISSING', {
    rootMarkup: contractHtml.match(/<div id="exact-root">([\s\S]*?)<\/div>/)?.[1] ?? null,
    hasHydrationManifest: contractHtml.includes('exact-hydration-manifest'),
    finding: 'The production Partitime HTML has an empty root and a CSR module script; it contains no authoritative route content.',
  }, 'nonclaim'),
  requirement('hydration-without-duplicates-or-stale-flash', 'red', 'STEP4_WEB_PARTITIME_HYDRATION_WITNESS_MISSING', {
    mountCallCount: (contractMain.match(/\bmount\(/g) ?? []).length,
    hydrationCallCount: (contractMain.match(/\bhydrat|\badopt/gi) ?? []).length,
    finding: 'Partitime mounts into an empty root. No server DOM adoption, duplicate-subscription count, or stale-flash assertion runs.',
  }, 'nonclaim'),
  requirement('document-metadata', 'red', 'STEP4_WEB_ROUTE_METADATA_INCOMPLETE', {
    title: contractHtml.match(/<title>(.*?)<\/title>/)?.[1] ?? null,
    themeColor: contractHtml.match(/<meta name="theme-color" content="([^"]+)"/)?.[1] ?? null,
    canonicalCount: (contractHtml.match(/rel="canonical"/g) ?? []).length,
    descriptionCount: (contractHtml.match(/name="description"/g) ?? []).length,
    finding: 'The build has fixed shell metadata but no per-route title/description/canonical witness.',
  }, 'nonclaim'),
  requirement('basepath', 'red', 'STEP4_WEB_BASEPATH_UNWITNESSED', {
    absoluteAssetReferences: (contractHtml.match(/(?:src|href)="\//g) ?? []).length,
    sourceAbsoluteEntryReferences: (contractSourceHtml.match(/(?:src|href)="\//g) ?? []).length,
    basePathReferences: (contractMain.match(/basePath/g) ?? []).length,
    finding: 'The emitted asset URL is root-absolute and no non-root deployment/basePath acceptance exists.',
  }, 'nonclaim'),
  requirement('exact-production-web-capabilities-registered', missingUpstreamChecks.length === 0 ? 'pass' : 'red',
    missingUpstreamChecks.length === 0
      ? 'STEP4_WEB_UPSTREAM_EXACT_CHECKS_REGISTERED'
      : 'STEP4_WEB_UPSTREAM_EXACT_CHECKS_MISSING', {
    registry: exactIdentity(exactVerifyPath),
    checks: upstreamChecks,
    missingChecks: missingUpstreamChecks,
    caveat: 'Registry presence establishes reusable upstream surfaces only; it does not make the Partitime integration rows pass.',
  }),
  requirement('residual-browser-device-ime-forms-matrix', 'red', 'STEP4_WEB_MANUAL_DEVICE_MATRIX_PENDING', {
    exactCheckId: manualImeCheck?.id ?? null,
    manual: manualImeCheck?.manual ?? null,
    notes: manualImeCheck?.notes ?? null,
    finding: 'The governing Exact check is explicitly a pending manual release/support gate and Partitime has no passed device report.',
  }, 'nonclaim'),
];

const report = finalizeReport({
  schemaVersion: 'partitime.step4-production-web.v1',
  claimId: 'STEP4.PRODUCTION_WEB',
  requirements,
  inputs: {
    protocol: identity(protocolPath),
    retainedWebReceipt: identity(webReceiptPath),
    surface: [
      identity(contractHtmlPath),
      identity(contractSourceHtmlPath),
      identity(contractMainPath),
      identity(contractHelpersPath),
      identity(reactAppPath),
    ],
    exactVerifyRegistry: exactIdentity(exactVerifyPath),
  },
  details: {
    conclusion: 'The Contract × Snapback CSR product flow works, but Partitime has not earned the production-web claim.',
  },
});

writeStep4Report(output, report);
