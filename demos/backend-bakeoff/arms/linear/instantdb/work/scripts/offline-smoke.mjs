import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { init } from '@instantdb/admin';

const root = resolve(import.meta.dirname, '..');
const armRoot = resolve(root, '..');
const runtimeDir = resolve(root, '.arm-runtime');
const evidenceDir = resolve(armRoot, 'evidence');
const target = JSON.parse(readFileSync(resolve(runtimeDir, 'target.json'), 'utf8'));
const actors = JSON.parse(readFileSync(resolve(runtimeDir, 'actors.json'), 'utf8'));
const acceptancePath = resolve(evidenceDir, 'acceptance-results.json');
const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8'));
const expectedAliceHash = acceptance.actorHashes.alice.idSha256;
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = resolve(runtimeDir, 'chrome-alice');
const admin = init({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});
mkdirSync(evidenceDir, { recursive: true });

const dev = spawn('npm', ['run', 'dev'], {
  cwd: root,
  env: { ...process.env, VITE_INSTANT_APP_ID: target.appId },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let devOutput = '';
dev.stdout.on('data', (chunk) => { devOutput += chunk; });
dev.stderr.on('data', (chunk) => { devOutput += chunk; });
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
for (let attempt = 0; attempt < 100 && !devOutput.includes('Local:'); attempt += 1) {
  if (dev.exitCode !== null) throw new Error('Vite exited before offline smoke');
  await sleep(100);
}

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: true,
  });
  let page = context.pages()[0] ?? await context.newPage();
  const url = `http://127.0.0.1:4325/?token=${encodeURIComponent(actors.alice.refreshToken)}`;
  await page.goto(url);
  const shell = page.locator('[data-testid="linear-shell"][data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="linear-shell"][data-connection="authenticated"]').waitFor({
    timeout: 30_000,
  });
  const principal = await shell.getAttribute('data-user-id');
  if (!principal || sha(principal) !== expectedAliceHash) {
    throw new Error('offline browser did not retain Alice identity');
  }
  const warmRows = Number(await shell.getAttribute('data-issue-count'));
  const first = page.locator('[data-issue-id]').first();
  const issueId = await first.getAttribute('data-issue-id');
  const selector = first.locator('select');
  const originalStatus = await selector.inputValue();
  if (!issueId) throw new Error('offline target issue missing');
  const queuedStatus = originalStatus === 'done' ? 'in_progress' : 'done';
  await context.close();
  context = undefined;

  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: true,
  });
  page = context.pages()[0] ?? await context.newPage();
  let providerTransportEnabled = false;
  let blockedProviderRequests = 0;
  let blockedProviderWebSockets = 0;
  await context.route(/instantdb\.com/, async (route) => {
    if (providerTransportEnabled) await route.continue();
    else {
      blockedProviderRequests += 1;
      await route.abort('internetdisconnected');
    }
  });
  await page.routeWebSocket(/instantdb\.com/, async (socket) => {
    if (providerTransportEnabled) {
      socket.connectToServer();
    } else {
      blockedProviderWebSockets += 1;
      await socket.close({ code: 1001, reason: 'LLP 0102 offline transport barrier' });
    }
  });
  await page.goto(url);
  const coldShell = page.locator('[data-testid="linear-shell"][data-ready="true"]');
  await coldShell.waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="linear-shell"][data-connection="closed"]').waitFor({
    timeout: 30_000,
  });
  const coldRows = Number(await coldShell.getAttribute('data-issue-count'));
  const offlineRow = page.locator(`[data-issue-id="${issueId}"]`);
  await offlineRow.locator('select').selectOption(queuedStatus);
  await page.locator(`[data-issue-id="${issueId}"][data-status="${queuedStatus}"]`).waitFor({
    timeout: 10_000,
  });
  const queueUi = await page.getByTestId('linear-offline-state').innerText();
  const indexedDbDatabaseCount = await page.evaluate(async () =>
    (await indexedDB.databases()).filter((database) => database.name).length,
  );
  providerTransportEnabled = true;
  await page.reload();
  await page.locator('[data-testid="linear-shell"][data-connection="authenticated"]').waitFor({
    timeout: 45_000,
  });
  await page.locator(`[data-issue-id="${issueId}"][data-status="${queuedStatus}"]`).waitFor({
    timeout: 45_000,
  });
  let authoritative;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    authoritative = (await admin.query({
      issues: { $: { where: { id: issueId } } },
    })).issues[0];
    if (authoritative?.status === queuedStatus) break;
    await sleep(200);
  }
  if (authoritative?.status !== queuedStatus) {
    throw new Error('offline queued edit did not settle authoritatively');
  }
  await admin.transact(admin.tx.issues[issueId].update({
    status: originalStatus,
    revision: authoritative.revision + 1,
    moveNonce: 'offline-restored',
    updatedAt: new Date(),
  }));

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      warmRows === 50 &&
      coldRows === 50 &&
      (blockedProviderRequests > 0 || blockedProviderWebSockets > 0) &&
      queueUi.toLowerCase().includes('queued') &&
      authoritative.status === queuedStatus,
    targetIdSha256: sha(target.appId),
    actorIdSha256: sha(principal),
    coldClient: {
      previousBrowserProcessClosed: true,
      persistentProfile: '.arm-runtime/chrome-alice',
      retainedRows: coldRows,
      retainedOrigin: 'InstantDB browser IndexedDB query cache',
      indexedDbDatabaseCount,
    },
    transportDisabled: {
      providerRequestsBlockedByChromium: blockedProviderRequests,
      providerWebSocketsClosedByPlaywright: blockedProviderWebSockets,
      routePattern: 'instantdb.com',
      localhostViteRemainedReachable: true,
      browserConnectionState: 'closed',
    },
    queuedEdit: {
      issueIdSha256: sha(issueId),
      originalStatus,
      queuedStatus,
      queueUi,
      optimisticVisibleOffline: true,
    },
    settlement: {
      reconnected: true,
      authoritativeStatus: authoritative.status,
      restoredAfterProof: true,
    },
    containsSecretValues: false,
  };
  writeFileSync(
    resolve(evidenceDir, 'offline-smoke.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { mode: 0o600 },
  );
  if (!receipt.ok) throw new Error(`offline evidence failed: ${JSON.stringify(receipt)}`);
  acceptance.scenarioResults.push({
    id: 'LINEAR-10-OFFLINE',
    result: 'PASS',
    summary: 'Cold browser retained 50 rows and queued one edit while provider transport was disabled, then reconciled.',
    evidence: {
      coldClient: receipt.coldClient,
      transportDisabled: receipt.transportDisabled,
      settlement: receipt.settlement,
      receipt: 'offline-smoke.json',
    },
  });
  const order = new Map(
    Array.from({ length: 14 }, (_, index) => [`LINEAR-${String(index + 1).padStart(2, '0')}`, index]),
  );
  acceptance.scenarioResults.sort((a, b) => {
    const aKey = a.id.split('-').slice(0, 2).join('-');
    const bKey = b.id.split('-').slice(0, 2).join('-');
    return (order.get(aKey) ?? 99) - (order.get(bKey) ?? 99);
  });
  acceptance.offlinePending = false;
  writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    ok: true,
    retainedRows: coldRows,
    providerRequestsBlockedByChromium: blockedProviderRequests,
    providerWebSocketsClosedByPlaywright: blockedProviderWebSockets,
  }) + '\n');
} finally {
  await context?.close().catch(() => {});
  dev.kill('SIGTERM');
}
process.exit(0);
