#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { stopChild } from '../../../_kit/server-process.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets —
// the strict citizenship gate needs real Mobile Safari focus and bfcache
// observations from both supported iOS channels; desktop Safari and Chromium
// emulation cannot stand in for either device row.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const surfaceRoot = join(demoRoot, 'surfaces', 'contract');
const installedNodeModulesRoot = join(surfaceRoot, 'node_modules');
const rendererInstallRoot = join(installedNodeModulesRoot, '@exact', 'renderer');
const contractInstallRoot = join(installedNodeModulesRoot, '@exact', 'contract');
const keyDown = (value) => ({ type: 'keyDown', value });
const keyUp = (value) => ({ type: 'keyUp', value });
const press = (value) => [keyDown(value), keyUp(value)];
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const requiredOption = (name) => {
  const value = option(name);
  if (value === null || value.trim() === '') throw new Error(`--${name} is required`);
  return value;
};

const deviceUdid = requiredOption('device-udid');
const channel = requiredOption('channel');
if (!['current', 'current-1'].includes(channel)) {
  throw new Error('--channel must be current or current-1');
}
const baseUrl = new URL(requiredOption('base-url'));
if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error('--base-url must be an HTTP(S) production candidate');
}
const receiptFile = resolve(requiredOption('receipt'));
const exactRoot = option('exact-root') === null ? null : resolve(option('exact-root'));
const environmentId = channel === 'current' ? 'ios-safari-current' : 'ios-safari-current-1';
const suite = createSuite(`Partitime / ${environmentId} WebDriver citizenship`, { expectedChecks: 2 });
const cleanups = [];

const command = (program, args, options = {}) => {
  try {
    return execFileSync(program, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    }).trim();
  } catch {
    return null;
  }
};
const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (path) => digestBytes(readFileSync(path));
const identity = (path) => ({
  path: relative(repoRoot, path),
  sha256: digest(path),
  bytes: readFileSync(path).length,
});
const pathIsWithin = (parent, child) => {
  const local = relative(parent, child);
  return local === '' || (!local.startsWith('..') && !isAbsolute(local));
};
const filesUnder = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
};
const treeIdentity = (root) => {
  if (!existsSync(root)) return null;
  const files = filesUnder(root);
  const ledger = files.map((path) => `${relative(root, path)}\0${digest(path)}`).join('\n');
  return {
    root: relative(repoRoot, root),
    fileCount: files.length,
    sha256: digestBytes(ledger),
    entry: existsSync(join(root, 'index.html')) ? identity(join(root, 'index.html')) : null,
  };
};

const rendererRoot = existsSync(rendererInstallRoot) ? realpathSync(rendererInstallRoot) : null;
const contractRoot = existsSync(contractInstallRoot) ? realpathSync(contractInstallRoot) : null;
const linkedExactSource = [rendererRoot, contractRoot].some(
  (path) => path !== null && !pathIsWithin(installedNodeModulesRoot, path),
);
const exactRevision = exactRoot === null ? null : command('git', ['rev-parse', 'HEAD'], { cwd: exactRoot });
const exactDirty = exactRoot === null ? null : command('git', ['status', '--porcelain=v1'], { cwd: exactRoot }) !== '';
const exactSourceBound = !linkedExactSource || (
  exactRoot !== null
  && exactRevision !== null
  && exactDirty === false
  && [rendererRoot, contractRoot].every((path) => path !== null && pathIsWithin(exactRoot, path))
);
const revision = command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
const dirty = command('git', ['status', '--porcelain=v1'], { cwd: repoRoot }) !== '';
const simctlDevices = JSON.parse(command('xcrun', ['simctl', 'list', 'devices', '-j']) ?? '{"devices":{}}');
const simulator = Object.entries(simctlDevices.devices ?? {})
  .flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })))
  .find((device) => device.udid === deviceUdid) ?? null;
const simulatorRuntime = command('xcrun', ['simctl', 'getenv', deviceUdid, 'SIMULATOR_RUNTIME_VERSION']);
const simulatorBuild = command('xcrun', ['simctl', 'getenv', deviceUdid, 'SIMULATOR_RUNTIME_BUILD_VERSION']);
const distRoot = join(surfaceRoot, 'dist', 'snapback');
const prerequisites = [
  '/usr/bin/safaridriver',
  rendererInstallRoot,
  contractInstallRoot,
  join(distRoot, 'index.html'),
];
const missing = prerequisites.filter((path) => !existsSync(path));
if (simulator === null) missing.push(`simulator:${deviceUdid}`);
const reportIdentity = {
  schemaVersion: 'partitime.ios-safari-webdriver-citizenship.v1',
  claimId: `STEP4.WEB_CITIZENSHIP.${environmentId.toUpperCase().replaceAll('-', '_')}`,
  recordedAt: new Date().toISOString(),
  repository: { revision, dirty },
  exactRepository: exactRoot === null
    ? null
    : { revision: exactRevision, dirty: exactDirty, path: relative(repoRoot, exactRoot) },
  candidatePackages: {
    source: linkedExactSource ? 'linked-source' : 'registry-install',
    sourceBound: exactSourceBound,
    rendererRoot: rendererRoot === null ? null : relative(repoRoot, rendererRoot),
    contractRoot: contractRoot === null ? null : relative(repoRoot, contractRoot),
    artifacts: [
      join(surfaceRoot, 'package.json'),
      join(surfaceRoot, 'bun.lock'),
      rendererRoot === null ? null : join(rendererRoot, 'package.json'),
      rendererRoot === null ? null : join(rendererRoot, 'src', 'web-host-direct.ts'),
      contractRoot === null ? null : join(contractRoot, 'package.json'),
    ].filter((path) => path !== null && existsSync(path)).map(identity),
  },
  candidateBuild: treeIdentity(distRoot),
  claimEligible: !dirty && missing.length === 0 && exactSourceBound,
  cells: ['contract:snapback'],
  environmentId,
  channel,
  environment: {
    node: process.version,
    os: `${platform()}-${release()}-${arch()}`,
    cpu: cpus()[0]?.model ?? null,
    browserName: 'Mobile Safari',
    browserVersion: null,
    platformName: 'iOS',
    platformVersion: simulatorRuntime,
    platformBuild: simulatorBuild,
    deviceName: simulator?.name ?? null,
    deviceUdid,
    simulatorRuntime: simulator?.runtime ?? null,
    simulatorState: simulator?.state ?? null,
    driver: '/usr/bin/safaridriver',
    driverVersion: command('/usr/bin/safaridriver', ['--version']),
  },
  baseUrl: baseUrl.href,
  testInventory: [
    join(repoRoot, 'demos', '_kit', 'harness.mjs'),
    join(repoRoot, 'demos', '_kit', 'server-process.mjs'),
    fileURLToPath(import.meta.url),
  ].map(identity),
  missingPrerequisites: missing.map((path) => path.startsWith('simulator:') ? path : relative(repoRoot, path)),
};

await runAcceptance(suite, async () => {
  if (missing.length > 0) {
    throw new Error(`required Mobile Safari prerequisites are missing: ${missing.join(', ')}`);
  }
  if (!exactSourceBound) {
    throw new Error('the linked Exact candidate is not bound to a clean --exact-root checkout');
  }
  const candidateResponse = await fetch(baseUrl, { signal: AbortSignal.timeout(10_000) });
  if (!candidateResponse.ok) throw new Error(`production candidate returned ${candidateResponse.status}`);

  const driver = await startDriver();
  cleanups.push(() => driver.stop());
  const session = await driver.newSession({
    browserName: 'safari',
    platformName: 'iOS',
    'safari:deviceUDID': deviceUdid,
    'safari:useSimulator': true,
  });
  cleanups.push(() => session.close());
  reportIdentity.environment.browserVersion = session.capabilities.browserVersion ?? null;
  reportIdentity.environment.platformVersion =
    session.capabilities.platformVersion ?? reportIdentity.environment.platformVersion;

  await loadFeed(session);

  await suite.check(`contract × snapback traps and restores focus in ${environmentId}`, async () => {
    await session.execute(`document.querySelector('[data-testid="create-event"]')?.focus()`);
    await session.keys([press('\uE007')]);
    await session.wait(
      `document.querySelector('[data-testid="create-overlay"]') && document.activeElement?.dataset?.testid === 'create-close'`,
      10_000,
    );
    const initial = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([keyDown('\uE008'), press('\uE004'), keyUp('\uE008')]);
    const reverseWrapped = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([press('\uE004')]);
    const forwardWrapped = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([press('\uE00C')]);
    await sleep(300);
    const afterEscape = await session.execute(`
      return {
        overlay: Boolean(document.querySelector('[data-testid="create-overlay"]')),
        active: document.activeElement?.dataset?.testid ?? null,
      };
    `);
    if (
      initial !== 'create-close'
      || reverseWrapped !== 'create-event-submit'
      || forwardWrapped !== 'create-close'
      || afterEscape.overlay
      || afterEscape.active !== 'create-event'
    ) {
      throw new Error(`focus scope mismatch: ${JSON.stringify({
        initial, reverseWrapped, forwardWrapped, afterEscape,
      })}`);
    }
    return {
      initial,
      reverseWrapped,
      forwardWrapped,
      restored: afterEscape.active,
      input: 'iOS Safari WebDriver key actions',
    };
  });

  await suite.check(`contract × snapback restores authored state from bfcache in ${environmentId}`, async () => {
    await session.click('[data-testid="open-event_sunset"]');
    await session.wait(
      `window.partifulMatrixReady && document.querySelector('[data-testid="event-page"]')?.textContent?.includes('Sunset Supper Club')`,
      15_000,
    );
    const draft = `bfcache-${channel}-draft`;
    await session.setValue('[data-testid="wall-input"]', draft);
    await session.wait(`document.querySelector('[data-testid="wall-input"]')?.value === ${JSON.stringify(draft)}`, 5_000);
    await session.execute(`
      window.__partitimeBfcachePageShow = [];
      addEventListener('pageshow', (event) => {
        window.__partitimeBfcachePageShow.push({
          persisted: event.persisted,
          href: location.href,
          draft: document.querySelector('[data-testid="wall-input"]')?.value ?? null,
        });
      });
    `);
    const eventUrl = await session.execute(`return location.href`);
    await session.navigate('about:blank');
    await session.back();
    await session.wait(
      `document.querySelector('[data-testid="event-page"]') && Array.isArray(window.__partitimeBfcachePageShow) && window.__partitimeBfcachePageShow.length > 0`,
      15_000,
    );
    const restored = await session.execute(`
      return {
        href: location.href,
        draft: document.querySelector('[data-testid="wall-input"]')?.value ?? null,
        pageShows: window.__partitimeBfcachePageShow,
        ready: Boolean(window.partifulMatrixReady),
      };
    `);
    await session.setValue('[data-testid="wall-input"]', '!');
    await session.wait(
      `document.querySelector('[data-testid="wall-input"]')?.value === ${JSON.stringify(`${draft}!`)}`,
      5_000,
    );
    await session.click('[data-testid="back"]');
    await session.wait(
      `window.partifulMatrixReady && document.querySelector('[data-testid="feed-ready"]')?.textContent?.includes('Sunset Supper Club')`,
      15_000,
    );
    const persisted = restored.pageShows?.at(-1)?.persisted === true;
    if (!persisted || restored.href !== eventUrl || restored.draft !== draft || restored.ready !== true) {
      throw new Error(`bfcache restore mismatch: ${JSON.stringify({ eventUrl, restored })}`);
    }
    return {
      route: 'feed -> event -> about:blank -> browser back -> feed',
      eventUrl,
      pageshowPersisted: persisted,
      retainedDraft: restored.draft,
      interactiveAfterRestore: true,
      input: 'iOS Safari WebDriver navigation and native history traversal',
    };
  });
}, { cleanups, reportFile: receiptFile, reportExtra: reportIdentity });

async function loadFeed(session) {
  const url = new URL(baseUrl);
  url.searchParams.set('user', 'eve');
  await session.navigate(url.href);
  await session.wait(
    `window.partifulMatrixReady && document.querySelector('[data-testid="feed-ready"]')?.textContent?.includes('Sunset Supper Club')`,
    30_000,
  );
}

async function waitUrl(url, child, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Keep waiting within the bounded deadline.
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

async function startDriver() {
  const port = await freePort();
  let log = '';
  const child = spawn('/usr/bin/safaridriver', ['-p', String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitUrl(`${origin}/status`, child, 'iOS Safari WebDriver');
  } catch (error) {
    await stopChild(child);
    throw new Error(`${error.message}: ${log.slice(-4000)}`);
  }
  let stopped = false;
  return {
    newSession: async (capabilities) => {
      const created = await webdriver(origin, 'POST', '/session', {
        capabilities: { alwaysMatch: capabilities },
      });
      const sessionId = created.sessionId;
      if (!sessionId) throw new Error('iOS Safari WebDriver did not return a session id');
      const endpoint = `/session/${sessionId}`;
      let closed = false;
      const elementId = async (selector) => {
        const element = await webdriver(origin, 'POST', `${endpoint}/element`, {
          using: 'css selector',
          value: selector,
        });
        const id = element['element-6066-11e4-a52e-4f735466cecf'];
        if (!id) throw new Error(`iOS Safari WebDriver did not return an element id for ${selector}`);
        return id;
      };
      return {
        capabilities: created.capabilities ?? {},
        navigate: (url) => webdriver(origin, 'POST', `${endpoint}/url`, { url }),
        back: () => webdriver(origin, 'POST', `${endpoint}/back`, {}),
        execute: (script, args = []) =>
          webdriver(origin, 'POST', `${endpoint}/execute/sync`, { script, args }),
        click: async (selector) => {
          const id = await elementId(selector);
          return webdriver(origin, 'POST', `${endpoint}/element/${id}/click`, {});
        },
        setValue: async (selector, text) => {
          const id = await elementId(selector);
          return webdriver(origin, 'POST', `${endpoint}/element/${id}/value`, {
            text,
            value: Array.from(text),
          });
        },
        keys: (actions) => webdriver(origin, 'POST', `${endpoint}/actions`, {
          actions: [{ type: 'key', id: 'keyboard', actions: actions.flat() }],
        }),
        wait: async (expression, timeout) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            if (await webdriver(origin, 'POST', `${endpoint}/execute/sync`, {
              script: `return Boolean(${expression})`,
              args: [],
            })) return;
            await sleep(100);
          }
          throw new Error(`browser condition timed out: ${expression}`);
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await webdriver(origin, 'DELETE', endpoint);
        },
      };
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopChild(child);
    },
  };
}

async function webdriver(origin, method, path, body = null) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === null ? undefined : { 'content-type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(
      `iOS Safari WebDriver ${method} ${path} failed: ${payload.value?.message ?? response.status}`,
    );
  }
  return payload.value;
}
