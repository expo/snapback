#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const surfaceRoot = join(demoRoot, 'surfaces', 'password');
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
if (!browserExecutable) throw new Error('password-auth browser acceptance requires Chrome or Chromium');

const scratch = await mkdtemp(join(tmpdir(), 'snapback-browser-password-'));
const carrier = join(scratch, 'startup-artifacts.json');
await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

let server = null;
let vite = null;
let lifecycle = null;
let browser = null;
const observedUrls = [];

async function waitForPhase(page, expected) {
  await page.waitForFunction(
    (phase) => globalThis.snapbackPasswordAuth?.snapshot?.().phase === phase,
    expected,
    { timeout: 20_000 },
  );
  return page.evaluate(() => globalThis.snapbackPasswordAuth.snapshot());
}

try {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: false,
    serverBinary: resolve(
      process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
    ),
  });
  const gateway = createBrowserAuthGateway({
    server,
    api,
    appId: schema.appId,
    passwordOnly: true,
  });
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
    userDataPrefix: 'snapback-browser-password-profile-',
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

  const email = 'password-browser@example.com';
  const password = 'password-browser-custody-123!';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await waitForPhase(page, 'anonymous');
  const signup = await page.evaluate(
    ([address, secret]) => globalThis.snapbackPasswordAuth.signup(address, secret),
    [email, password],
  );
  assert.equal(signup.phase, 'authenticated');
  const principal = signup.session.authority.userId;
  const signupCustody = await page.evaluate(() => globalThis.snapbackPasswordAuth.inspectCustody());
  assert.deepEqual(
    { phase: signupCustody.phase, bearerPresent: signupCustody.bearerPresent, userId: signupCustody.userId },
    { phase: 'settled', bearerPresent: true, userId: principal },
  );
  const signupCount = gateway.snapshot().publicRequests.filter(
    ({ key, outcome }) => key === 'POST /auth/password/signup' && outcome === 200,
  ).length;
  assert.equal(signupCount, 1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterSignupReload = await waitForPhase(page, 'authenticated');
  assert.equal(afterSignupReload.session.authority.userId, principal);
  assert.equal(
    gateway.snapshot().publicRequests.filter(({ key }) => key === 'POST /auth/password/signup').length,
    1,
    'reload repeated password signup instead of adopting IndexedDB custody',
  );

  await page.evaluate(() => globalThis.snapbackPasswordAuth.logout());
  await waitForPhase(page, 'anonymous');
  const anonymousCustody = await page.evaluate(() => globalThis.snapbackPasswordAuth.inspectCustody());
  assert.deepEqual(
    { phase: anonymousCustody.phase, bearerPresent: anonymousCustody.bearerPresent },
    { phase: 'settled', bearerPresent: false },
  );

  const signin = await page.evaluate(
    ([address, secret]) => globalThis.snapbackPasswordAuth.signin(address, secret),
    [email, password],
  );
  assert.equal(signin.phase, 'authenticated');
  assert.equal(signin.session.authority.userId, principal);
  assert.equal(
    gateway.snapshot().publicRequests.filter(
      ({ key, outcome }) => key === 'POST /auth/password/signin' && outcome === 200,
    ).length,
    1,
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterSigninReload = await waitForPhase(page, 'authenticated');
  assert.equal(afterSigninReload.session.authority.userId, principal);
  const signinCustody = await page.evaluate(() => globalThis.snapbackPasswordAuth.inspectCustody());
  assert.deepEqual(
    { phase: signinCustody.phase, bearerPresent: signinCustody.bearerPresent, userId: signinCustody.userId },
    { phase: 'settled', bearerPresent: true, userId: principal },
  );
  assert.equal(
    gateway.snapshot().publicRequests.filter(({ key }) => key === 'POST /auth/password/signin').length,
    1,
    'reload repeated password signin instead of adopting IndexedDB custody',
  );

  const browserModule = await readFile(join(surfaceRoot, 'main.mjs'), 'utf8');
  for (const forbidden of ['adminToken', 'impersonationCapability', 'auth.mintSession', '/auth/mailbox']) {
    assert.equal(browserModule.includes(forbidden), false, `password browser module contained ${forbidden}`);
  }
  assert.equal(observedUrls.some((url) => url.includes(password)), false, 'password crossed a browser URL');
  assert.equal(observedUrls.some((url) => url.startsWith(server.baseUrl)), false, 'browser reached private backend origin');
  assert.equal(observedUrls.some((url) => /sbs_[A-Za-z0-9._~-]+/u.test(url)), false, 'bearer crossed a browser URL');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 5,
    browser: browserExecutable,
    signupThroughPublicClient: true,
    signupReloadRestoredIndexedDbCustody: true,
    logoutSettledAnonymousCustody: true,
    signinThroughPublicClient: true,
    signinReloadRestoredIndexedDbCustody: true,
    signupRequests: 1,
    signinRequests: 1,
    browserHadAdminCarrier: false,
    browserHadImpersonationCarrier: false,
    passwordOrBearerInUrl: false,
  })}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (lifecycle) await lifecycle.stop().catch(() => {});
  if (vite) await vite.close().catch(() => {});
  if (server) await server.stop();
  await rm(scratch, { recursive: true, force: true });
}
