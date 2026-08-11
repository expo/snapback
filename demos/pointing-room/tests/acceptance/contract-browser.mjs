// Pointing Room — real browser smoke for the compiled Contract surface.
//
// Owns an isolated sessions server, Vite, and headless Chrome. The browser
// signs in through the serve-only local mailbox seam, starts a round through
// the Contract action, casts a card, then switches rooms through Contract
// state. Server inspection proves both keyed subscriptions are replaced; the
// rendered rows and presence move to the new room without a remount.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { readGeneratedJson } from '../../../_kit/generated-artifacts.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { ownProcessTree, startServer, stopChild } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const surfaceDir = join(demoRoot, 'surfaces', 'contract');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const serverBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const chromeBin = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viteBinary = join(surfaceDir, 'node_modules', '.bin', 'vite');

assert(existsSync(serverBinary), `prebuilt Snapback binary missing: ${serverBinary}`);
assert(existsSync(chromeBin), `Chrome missing: ${chromeBin}`);
assert(existsSync(viteBinary), `Vite missing; run bun install in ${surfaceDir}`);

const schema = readGeneratedJson(generatedRoot, 'schema.manifest.json');
const functions = readGeneratedJson(generatedRoot, 'functions.manifest.json');
const seed = JSON.parse(readFileSync(join(demoRoot, 'snapback', 'seed.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'pointing-room-browser-'));
const carrier = join(scratch, 'startup-artifacts.json');
writeFileSync(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

const cleanups = [];
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function waitForUrl(url, child, log, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Vite exited before readiness:\n${log()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Vite did not become ready at ${url}:\n${log()}`);
}

async function waitForKeyedSubscriptions(admin, accept, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const inspection = await admin.inspect();
    last = inspection.subscriptions.filter((subscription) => (
      subscription.function === 'liveRound' || subscription.function === 'liveTally'
    ));
    if (accept(last)) return last;
    await sleep(50);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

try {
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    serverBinary,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  cleanups.push(() => server.stop());

  const admin = new SnapbackClient(server.baseUrl, {
    authClientProtocol: 1,
    custody: 'anonymous-public',
    adminToken: server.adminToken,
  });
  await admin.reset(seed);
  cleanups.push(() => admin.dispose?.());

  const vitePort = await freePort();
  let viteLog = '';
  const vite = spawn(
    'bun',
    [
      '--bun',
      'node_modules/.bin/vite',
      '--config',
      'vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(vitePort),
      '--strictPort',
    ],
    {
      cwd: surfaceDir,
      env: {
        ...process.env,
        SNAPBACK_POINTING_API: server.baseUrl,
        SNAPBACK_POINTING_ADMIN_TOKEN: server.adminToken,
        SNAPBACK_POINTING_IMPERSONATION_CAPABILITY: server.impersonationCapability,
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  vite.stdout.on('data', (chunk) => { viteLog += chunk; });
  vite.stderr.on('data', (chunk) => { viteLog += chunk; });
  const viteOwner = ownProcessTree(vite, () => stopChild(vite));
  cleanups.push(() => viteOwner.stop());
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  await waitForUrl(viteUrl, vite, () => viteLog);

  // macOS 26 aborts a directly spawned app bundle while registering it with
  // CoreServices. `open -W` performs that registration and remains alive until
  // Browser.close, preserving the launcher's process/profile cleanup ordering.
  const chrome = await launchChromeCdp({
    chromeBin: process.platform === 'darwin' ? '/usr/bin/open' : chromeBin,
    launchPrefixArgs: process.platform === 'darwin'
      ? ['-n', '-W', '/Applications/Google Chrome.app', '--args']
      : [],
    userDataPrefix: 'pointing-room-contract-',
    tempRoot: process.platform === 'darwin' ? '/tmp' : tmpdir(),
  });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.closeBrowser());
  const page = await cdp.newPage();
  await page.navigate(`${viteUrl}/?email=browser%40pointing-room.local&name=Ada%20Browser`);
  const ready = await page.eval(`(async () => {
    const deadline = Date.now() + 30000;
    while (!window.pointingRoomReady) {
      if (Date.now() > deadline) throw new Error('pointingRoomReady was never installed');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const facts = await window.pointingRoomReady;
    return { userId: facts.userId, initialRoomId: facts.initialRoomId };
  })()`);
  assert.equal(typeof ready.userId, 'string');
  assert.equal(ready.initialRoomId, 'room_planning');
  assert.equal(await page.exists('pointing-room'), true);
  assert.equal(await page.text('active-room-id'), 'room_planning');
  assert.match(await page.pollText('presence-line', '1 here', 10_000), /1 here/);
  assert.equal(await page.exists('round-empty'), true);

  const initialSubscriptions = await waitForKeyedSubscriptions(
    admin,
    (subscriptions) => subscriptions.length === 2,
    'initial keyed Planning subscriptions were not established',
  );
  assert.deepEqual(
    initialSubscriptions.map(({ function: name }) => name).sort(),
    ['liveRound', 'liveTally'],
  );
  const initialSubscriptionIds = new Set(initialSubscriptions.map(({ id }) => id));

  await page.setValue('next-topic-input', 'Planning browser story');
  await page.click('start-next-round');
  assert.match(await page.pollText('round-topic', 'Planning browser story', 10_000), /Planning browser story/);
  await page.click('vote-card-5');
  assert.equal(await page.pollText('revealed-vote-value', '^5$', 10_000), '5');
  assert.equal(await page.exists('participant-card'), true);

  await page.click('room-platform');
  assert.equal(await page.pollText('active-room-id', '^room_platform$', 10_000), 'room_platform');
  assert.match(await page.pollText('presence-line', '1 here', 10_000), /1 here/);
  assert.match(await page.pollText('round-empty', 'No round yet', 10_000), /No round yet/);
  assert.equal(await page.exists('participant-card'), false, 'Planning tally did not survive the room switch');

  const platformSubscriptions = await waitForKeyedSubscriptions(
    admin,
    (subscriptions) => subscriptions.length === 2
      && subscriptions.every(({ id }) => !initialSubscriptionIds.has(id)),
    'Platform switch did not replace both keyed subscriptions',
  );
  assert.equal(
    platformSubscriptions.some(({ id }) => initialSubscriptionIds.has(id)),
    false,
    'old Planning subscriptions were torn down',
  );
  const platformSubscriptionIds = new Set(platformSubscriptions.map(({ id }) => id));

  await page.setValue('next-topic-input', 'Platform browser story');
  await page.click('start-next-round');
  assert.match(await page.pollText('round-topic', 'Platform browser story', 10_000), /Platform browser story/);
  await page.click('vote-card-8');
  assert.equal(await page.pollText('revealed-vote-value', '^8$', 10_000), '8');

  await page.click('room-planning');
  assert.equal(await page.pollText('active-room-id', '^room_planning$', 10_000), 'room_planning');
  assert.match(await page.pollText('round-topic', 'Planning browser story', 10_000), /Planning browser story/);
  assert.equal(await page.pollText('revealed-vote-value', '^5$', 10_000), '5');
  assert.match(await page.pollText('presence-line', '1 here', 10_000), /1 here/);

  const planningReturnSubscriptions = await waitForKeyedSubscriptions(
    admin,
    (subscriptions) => subscriptions.length === 2
      && subscriptions.every(({ id }) => !platformSubscriptionIds.has(id)),
    'Planning return did not replace both Platform subscriptions',
  );
  assert.equal(
    planningReturnSubscriptions.some(({ id }) => platformSubscriptionIds.has(id)),
    false,
    'old Platform subscriptions were torn down',
  );

  console.log('PASS pointing-room Contract browser');
  console.log(JSON.stringify({
    viteUrl,
    apiUrl: server.baseUrl,
    userId: ready.userId,
    subscriptionIds: {
      planning: [...initialSubscriptionIds],
      platform: [...platformSubscriptionIds],
      planningReturn: planningReturnSubscriptions.map(({ id }) => id),
    },
  }));
} finally {
  const failures = [];
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'pointing-room browser cleanup failed');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const request = pending.get(id);
    if (request) clearTimeout(request.timer);
    pending.delete(id);
    return request;
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (!message.id || !pending.has(message.id)) return;
    const request = settle(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error('CDP socket closed'));
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP socket failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectRequest(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    });
  };
  return {
    close: () => socket.close(),
    closeBrowser: async () => {
      try { await send('Browser.close'); } catch { /* Chrome can close before replying. */ }
      if (socket.readyState === WebSocket.CLOSED) return;
      await Promise.race([
        new Promise((resolveClose) => socket.addEventListener('close', resolveClose, { once: true })),
        sleep(5_000),
      ]);
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    },
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evaluate = async (expression) => {
        const result = await send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true, userGesture: true },
          sessionId,
        );
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
      };
      const selector = (testId) => `[data-testid="${testId}"]`;
      return {
        eval: evaluate,
        navigate: async (pageUrl) => {
          await send('Page.navigate', { url: pageUrl }, sessionId);
          await sleep(200);
        },
        exists: (testId) => evaluate(`!!document.querySelector('${selector(testId)}')`),
        text: (testId) => evaluate(`document.querySelector('${selector(testId)}')?.textContent.trim() ?? null`),
        click: (testId) => evaluate(`(() => {
          const element = document.querySelector('${selector(testId)}');
          if (!element) throw new Error('missing element ${testId}');
          element.click();
          return true;
        })()`),
        setValue: (testId, value) => evaluate(`(() => {
          const element = document.querySelector('${selector(testId)}');
          if (!element) throw new Error('missing input ${testId}');
          const target = element.matches('input, textarea') ? element : element.querySelector('input, textarea');
          if (!target) throw new Error('no input inside ${testId}');
          const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, ${JSON.stringify(value)});
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`),
        pollText: (testId, pattern, timeoutMs) => evaluate(`(async () => {
          const deadline = Date.now() + ${timeoutMs};
          let value = null;
          while (Date.now() < deadline) {
            value = document.querySelector('${selector(testId)}')?.textContent.trim() ?? null;
            if (value !== null && new RegExp(${JSON.stringify(pattern)}).test(value)) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return value;
        })()`),
      };
    },
  };
}
