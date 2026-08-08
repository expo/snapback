#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { createBrowserAuthGateway } from '../../server/gateway.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const surfaceRoot = join(demoRoot, 'surfaces', 'web');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
const { default: api } = await import(pathToFileURL(join(generatedRoot, 'api.mjs')).href);

const browserCandidates = process.platform === 'darwin'
  ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
const browserExecutable = process.env.SNAPBACK_BROWSER_EXECUTABLE
  ?? browserCandidates.find((candidate) => existsSync(candidate));
if (!browserExecutable) throw new Error('browser-auth acceptance requires Chrome or Chromium');

const scratch = await mkdtemp(join(tmpdir(), 'snapback-browser-auth-'));
const carrier = join(scratch, 'startup-artifacts.json');
await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

let server = null;
let vite = null;
let lifecycle = null;
let browser = null;
let phase = 'startup';
const observedUrls = [];

async function waitForPhase(page, expected) {
  try {
    await page.waitForFunction((value) => (
      globalThis.snapbackBrowserAuth?.snapshot?.().phase === value
    ), expected, { timeout: 20_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      href: location.href,
      body: document.body.innerText,
      snapshot: globalThis.snapbackBrowserAuth?.snapshot?.() ?? null,
    })).catch((evaluateError) => ({ evaluateError: String(evaluateError) }));
    throw new Error(`${error.message}; page=${JSON.stringify(diagnostic)}`, { cause: error });
  }
  return page.evaluate(() => globalThis.snapbackBrowserAuth.snapshot());
}

async function login(page) {
  await page.click('#sign-in');
  return waitForPhase(page, 'authenticated');
}

async function logout(page) {
  await page.click('#logout');
  return waitForPhase(page, 'anonymous');
}

try {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
    serverBinary: process.env.SNAPBACK_RUNTIME_BINARY
      ? resolve(process.env.SNAPBACK_RUNTIME_BINARY)
      : null,
  });
  const gateway = createBrowserAuthGateway({ server, api, appId: schema.appId });

  phase = 'external assertion verifier contract';
  const nowMs = Date.now();
  const claims = {
    issuer: gateway.fixture.issuer,
    subject: 'fixture-alice-001',
    audience: gateway.fixture.audience,
    nonce: 'acceptance-nonce',
    email: 'mutable@fixture.invalid',
    displayName: 'Alice Fixture',
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
  };
  const signed = gateway.fixture.sign(claims);
  assert.equal(gateway.fixture.verify(signed, { expectedNonce: claims.nonce }).subject, claims.subject);
  const [signedPayload, signedSignature] = signed.split('.');
  const tamperedSignature = `${signedSignature.startsWith('A') ? 'B' : 'A'}${signedSignature.slice(1)}`;
  assert.throws(
    () => gateway.fixture.verify(`${signedPayload}.${tamperedSignature}`, { expectedNonce: claims.nonce }),
    /signature is invalid|claims are invalid/,
  );
  assert.throws(
    () => gateway.fixture.verify(signed, { expectedNonce: 'wrong-nonce' }),
    /claims are invalid/,
  );

  const webPort = await freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  vite = await createViteServer({
    root: surfaceRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [gateway.plugin],
    server: { host: '127.0.0.1', port: webPort, strictPort: true },
  });
  await vite.listen();

  lifecycle = await launchChromeCdp({
    chromeBin: resolve(browserExecutable),
    tempRoot: process.platform === 'darwin' ? '/tmp' : tmpdir(),
    userDataPrefix: 'snapback-browser-auth-profile-',
    headless: process.env.SNAPBACK_BROWSER_HEADED !== '1',
    extraArgs: ['--remote-allow-origins=*', '--disable-background-networking'],
  });
  browser = await chromium.connectOverCDP(lifecycle.ws);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome did not expose its persistent context');
  const page = await context.newPage();
  page.on('request', (request) => observedUrls.push(request.url()));
  page.on('console', (message) => process.stderr.write(`[browser console] ${message.type()}: ${message.text()}\n`));
  page.on('pageerror', (error) => process.stderr.write(`[browser pageerror] ${error.stack ?? error}\n`));

  phase = 'anonymous browser and public boundary';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await waitForPhase(page, 'anonymous');
  assert.equal(await page.locator('#protected-viewer').count(), 0);
  const refusals = await page.evaluate(async () => {
    const requests = [
      ['/__snapback/mutation/brokerBindPrincipal', 'POST'],
      ['/__snapback/mutation/brokerEnsureFixtureUsers', 'POST'],
      ['/__snapback/_snapback/api/auth/mailbox', 'GET'],
      ['/__snapback/_snapback/api/host/operations/auth.mintSession', 'POST'],
    ];
    return Promise.all(requests.map(async ([url, method]) => {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      return { url, status: response.status, body: await response.json() };
    }));
  });
  for (const refusal of refusals) {
    assert.equal(refusal.status, 403, JSON.stringify(refusal));
    assert.equal(refusal.body.diagnostic?.code, 'SNAPBACK_BROWSER_AUTH_ROUTE_REFUSED');
  }

  phase = 'Alice external sign-in and protected data';
  const alice = await login(page);
  assert.equal(alice.viewer.externalIssuer, gateway.fixture.issuer);
  assert.equal(alice.viewer.externalSubject, 'fixture-alice-001');
  assert.equal(alice.viewer.privateNote, 'alice-only: north star');
  assert.equal(await page.locator('#protected-viewer').getAttribute('data-principal'), alice.viewer.principal);
  const aliceCustody = await page.evaluate(() => globalThis.snapbackBrowserAuth.inspectCustody());
  assert.deepEqual(
    { phase: aliceCustody.phase, authorityKind: aliceCustody.authorityKind, bearerPresent: aliceCustody.bearerPresent },
    { phase: 'settled', authorityKind: 'session', bearerPresent: true },
  );
  const afterAliceLogin = gateway.snapshot();
  assert.equal(afterAliceLogin.bootstrapConsumes, 1);
  assert.equal(afterAliceLogin.externalCodeConsumes, 1);
  assert.equal(afterAliceLogin.bindings.length, 1);
  assert.equal(afterAliceLogin.bindings[0].principal, alice.viewer.principal);

  phase = 'full reload restores IndexedDB custody without exchange';
  const exchangeCountBeforeReload = afterAliceLogin.publicRequests.filter(({ key }) => key === 'POST /auth/exchange').length;
  const bootstrapCountBeforeReload = afterAliceLogin.bootstrapConsumes;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedAlice = await waitForPhase(page, 'authenticated');
  assert.equal(reloadedAlice.viewer.principal, alice.viewer.principal);
  assert.equal(reloadedAlice.viewer.privateNote, 'alice-only: north star');
  const afterReload = gateway.snapshot();
  assert.equal(
    afterReload.publicRequests.filter(({ key }) => key === 'POST /auth/exchange').length,
    exchangeCountBeforeReload,
  );
  assert.equal(afterReload.bootstrapConsumes, bootstrapCountBeforeReload);

  phase = 'browser bundle and request custody boundary';
  const browserModule = await (await fetch(`${origin}/main.mjs`)).text();
  for (const forbidden of [server.adminToken, server.impersonationCapability, server.baseUrl]) {
    assert.equal(browserModule.includes(forbidden), false, 'browser module contained a private server carrier');
  }
  assert.equal(observedUrls.some((url) => url.includes('/_snapback/api/auth/mailbox')), true,
    'the explicit negative boundary probe was not observed');
  assert.equal(observedUrls.some((url) => url.startsWith(server.baseUrl)), false,
    'browser contacted the private backend origin directly');
  assert.equal(observedUrls.some((url) => /sbs_[A-Za-z0-9._~-]+/u.test(url)), false,
    'a Snapback bearer crossed a browser URL');

  phase = 'logout blanks before revocation settles';
  const logoutGate = gateway.pauseNextLogout();
  await page.click('#logout');
  await logoutGate.entered;
  const duringLogout = await page.evaluate(() => globalThis.snapbackBrowserAuth.snapshot());
  assert.equal(duringLogout.phase, 'transitioning');
  assert.equal(duringLogout.viewer, null);
  assert.equal(await page.locator('#protected-viewer').count(), 0);
  logoutGate.release();
  await waitForPhase(page, 'anonymous');
  const anonymousCustody = await page.evaluate(() => globalThis.snapbackBrowserAuth.inspectCustody());
  assert.deepEqual(
    {
      phase: anonymousCustody.phase,
      authorityKind: anonymousCustody.authorityKind,
      bearerPresent: anonymousCustody.bearerPresent,
    },
    { phase: 'settled', authorityKind: 'anonymous', bearerPresent: false },
  );
  const protectedAfterLogout = await page.evaluate(async () => {
    try {
      await globalThis.snapbackBrowserAuth.queryViewer();
      return { allowed: true };
    } catch (error) {
      return {
        allowed: false,
        code: error?.diagnostic?.code ?? error?.code ?? null,
        message: error?.message ?? String(error),
      };
    }
  });
  assert.equal(protectedAfterLogout.allowed, false, JSON.stringify(protectedAfterLogout));

  phase = 'signed-out reload stays anonymous';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPhase(page, 'anonymous');
  assert.equal(await page.locator('#protected-viewer').count(), 0);

  phase = 'mutable email preserves issuer-subject binding';
  gateway.selectFixtureIdentity('alice', { email: 'alice.after@fixture.invalid' });
  const aliceAgain = await login(page);
  assert.equal(aliceAgain.viewer.principal, alice.viewer.principal);
  assert.equal(aliceAgain.viewer.externalSubject, alice.viewer.externalSubject);
  const bindingsAfterEmailChange = gateway.snapshot().bindings;
  assert.equal(bindingsAfterEmailChange.length, 2);
  assert.equal(bindingsAfterEmailChange[0].appUserId, bindingsAfterEmailChange[1].appUserId);
  assert.notEqual(bindingsAfterEmailChange[0].observedEmailDigest, bindingsAfterEmailChange[1].observedEmailDigest);
  await logout(page);

  phase = 'second external identity cannot see predecessor data';
  gateway.selectFixtureIdentity('bob');
  const bob = await login(page);
  assert.notEqual(bob.viewer.principal, alice.viewer.principal);
  assert.equal(bob.viewer.externalSubject, 'fixture-bob-002');
  assert.equal(bob.viewer.privateNote, 'bob-only: red kite');
  assert.equal((await page.locator('#protected-viewer').textContent()).includes('alice-only'), false);

  const finalFacts = gateway.snapshot();
  assert.equal(finalFacts.bootstrapConsumes, 3);
  assert.equal(finalFacts.externalCodeConsumes, 3);
  assert.equal(finalFacts.bindings.length, 3);
  assert.equal(
    finalFacts.publicRequests.filter(({ key, outcome }) => key === 'POST /auth/exchange' && outcome === 200).length,
    3,
  );
  assert.equal(
    finalFacts.publicRequests.filter(({ outcome }) => outcome === 'refused').length,
    4,
  );

  console.log('browser-auth acceptance: PASS');
  console.log('  signed assertion verification + one-use callback');
  console.log('  immutable issuer/subject binding + protected ctx.auth.userId query');
  console.log('  IndexedDB full-reload restoration with no second exchange');
  console.log('  logout blanking/revocation + anonymous reload + actor isolation');
  console.log('  public gateway omits binding, mailbox, and host-operation routes');
} catch (error) {
  error.message = `browser-auth acceptance failed during ${phase}: ${error.message}`;
  throw error;
} finally {
  const cleanup = [];
  if (browser) cleanup.push(browser.close());
  if (lifecycle) cleanup.push(lifecycle.stop());
  if (vite) cleanup.push(vite.close());
  if (server) cleanup.push(server.stop());
  await Promise.allSettled(cleanup);
  await rm(scratch, { recursive: true, force: true });
}
