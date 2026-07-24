#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { stopChild } from '../../../_kit/server-process.mjs';

// @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
// desktop citizenship is exercised through each named browser's own WebDriver
// and native find shortcut; a Chromium result cannot stand in for another engine.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const surfaceRoot = join(demoRoot, 'surfaces', 'contract');
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const keyDown = (value) => ({ type: 'keyDown', value });
const keyUp = (value) => ({ type: 'keyUp', value });
const press = (value) => [keyDown(value), keyUp(value)];
const browser = option('browser');
if (!['safari', 'firefox'].includes(browser)) throw new Error('--browser must be safari or firefox');

const browserConfig = browser === 'safari'
  ? {
      driver: '/usr/bin/safaridriver',
      driverArgs: (port) => ['-p', String(port)],
      browserBin: '/Applications/Safari.app',
      browserName: 'safari',
      browserVersion: () => command('/usr/bin/mdls', ['-raw', '-name', 'kMDItemVersion', '/Applications/Safari.app']),
      capabilities: { browserName: 'safari' },
    }
  : {
      driver: process.env.GECKODRIVER_BIN || '/opt/homebrew/bin/geckodriver',
      driverArgs: (port) => ['--allow-system-access', '--port', String(port)],
      browserBin: process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox',
      browserName: 'firefox',
      browserVersion: () => command(process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox', ['--version']),
      capabilities: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } },
    };
const receiptFile = option('receipt') ?? join(
  demoRoot, 'acceptance', 'results', `step4-web-citizenship-desktop-${browser}.json`,
);
const suite = createSuite(`Partitime / desktop ${browser} citizenship`, { expectedChecks: 2 });
const cleanups = [];

const command = (program, args, options = {}) => {
  try {
    return execFileSync(program, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    }).trim();
  }
  catch { return null; }
};
const requiredCommand = (program, args, options = {}) =>
  execFileSync(program, args, { encoding: 'utf8', ...options }).trim();
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const identity = (path) => ({ path: relative(repoRoot, path), sha256: digest(path), bytes: readFileSync(path).length });
const installedNodeModulesRoot = join(surfaceRoot, 'node_modules');
const rendererInstallRoot = join(installedNodeModulesRoot, '@exact', 'renderer');
const contractInstallRoot = join(installedNodeModulesRoot, '@exact', 'contract');
const rendererRoot = existsSync(rendererInstallRoot) ? realpathSync(rendererInstallRoot) : null;
const contractRoot = existsSync(contractInstallRoot) ? realpathSync(contractInstallRoot) : null;
const exactRoot = option('exact-root') ? resolve(option('exact-root')) : null;
const pathIsWithin = (parent, child) => {
  const local = relative(parent, child);
  return local === '' || (!local.startsWith('..') && !isAbsolute(local));
};
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
const candidateArtifacts = [
  join(surfaceRoot, 'package.json'),
  join(surfaceRoot, 'bun.lock'),
  rendererRoot === null ? null : join(rendererRoot, 'package.json'),
  rendererRoot === null ? null : join(rendererRoot, 'src', 'web-host-direct.ts'),
  contractRoot === null ? null : join(contractRoot, 'package.json'),
].filter((path) => path !== null && existsSync(path));
const prerequisites = [
  browserConfig.driver,
  browserConfig.browserBin,
  serverBin,
  join(installedNodeModulesRoot, '.bin', 'vite'),
  rendererInstallRoot,
  contractInstallRoot,
];
const missing = prerequisites.filter((path) => !existsSync(path));
const revision = command('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
const dirty = command('git', ['status', '--porcelain=v1'], { cwd: repoRoot }) !== '';
const reportIdentity = {
  schemaVersion: 'partitime.desktop-webdriver-citizenship.v1',
  claimId: `STEP4.WEB_CITIZENSHIP.DESKTOP_${browser.toUpperCase()}`,
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
    artifacts: candidateArtifacts.map(identity),
  },
  claimEligible: !dirty && missing.length === 0 && exactSourceBound,
  cells: ['contract:snapback'],
  browser,
  environment: {
    node: process.version,
    bun: command('bun', ['--version']),
    os: `${platform()}-${release()}-${arch()}`,
    browserVersion: browserConfig.browserVersion(),
    driver: browserConfig.driver,
    driverVersion: command(browserConfig.driver, ['--version']),
    cpu: cpus()[0]?.model ?? null,
  },
  artifacts: [
    join(surfaceRoot, 'main.ts'), join(surfaceRoot, 'provider.ts'),
    join(surfaceRoot, 'feed.contract'), join(surfaceRoot, 'event.contract'),
  ].map(identity),
  testInventory: [
    join(repoRoot, 'demos', '_kit', 'harness.mjs'),
    join(repoRoot, 'demos', '_kit', 'server-process.mjs'),
    fileURLToPath(import.meta.url),
  ].map(identity),
  missingPrerequisites: missing.map((path) => relative(repoRoot, path)),
};

await runAcceptance(suite, async () => {
  if (missing.length > 0) throw new Error(`required ${browser} prerequisites are missing: ${missing.join(', ')}`);
  const snapbackUrl = await startSnapback();
  const gatewayUrl = await startGateway(snapbackUrl);
  const vite = await startVite(snapbackUrl, gatewayUrl);
  cleanups.push(() => vite.stop());
  const driver = await startDriver();
  cleanups.push(() => driver.stop());
  const session = await driver.newSession(browserConfig.capabilities);
  cleanups.push(() => session.close());

  await session.navigate(`${vite.url}/?user=eve`);
  await session.wait(`window.partifulMatrixReady && document.querySelector('[data-testid="feed-ready"]')?.textContent?.includes('Sunset Supper Club')`, 30_000);

  await suite.check(`contract × snapback traps and restores focus in desktop ${browser}`, async () => {
    if (browser === 'safari') {
      // Safari intentionally does not focus buttons on mouse click. Give the
      // opener explicit focus before WebDriver's native click so focusRestore
      // is tested against a real focused element rather than body.
      await session.execute(`document.querySelector('[data-testid="new-event"]')?.focus()`);
      await session.click('[data-testid="new-event"]');
    } else {
      await session.click('[data-testid="new-event"]');
    }
    await session.wait(`document.querySelector('[data-testid="create-overlay"]') && document.activeElement?.dataset?.testid === 'create-close'`, 10_000);
    const initial = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([keyDown('\uE008'), press('\uE004'), keyUp('\uE008')]);
    const reverseWrapped = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([press('\uE004')]);
    const forwardWrapped = await session.execute(`return document.activeElement?.dataset?.testid ?? null`);
    await session.keys([press('\uE00C')]);
    await sleep(500);
    const afterEscape = await session.execute(`return {overlay:Boolean(document.querySelector('[data-testid="create-overlay"]')),active:document.activeElement?.dataset?.testid ?? null}`);
    if (initial !== 'create-close' || reverseWrapped !== 'create-submit' || forwardWrapped !== 'create-close' || afterEscape.overlay || afterEscape.active !== 'new-event') {
      throw new Error(`focus scope mismatch: ${JSON.stringify({ initial, reverseWrapped, forwardWrapped, afterEscape })}`);
    }
    return { initial, reverseWrapped, forwardWrapped, restored: afterEscape.active, input: 'WebDriver key actions' };
  });

  if (browser === 'safari') {
    // Safari disables its native Find menu while a safaridriver automation
    // session owns the window. Close that bounded session before exercising
    // the same candidate in an ordinary Safari window through the browser's
    // real menu and Accessibility surface.
    await session.close();
    await driver.stop();
    requiredCommand('/usr/bin/osascript', ['-e', 'tell application "Safari" to quit']);
    await sleep(500);
  }

  await suite.check(`contract × snapback exposes visible content to desktop ${browser} find-on-page`, async () => {
    if (browser === 'firefox') await session.execute(`getSelection()?.removeAllRanges()`);
    let nativeFind = null;
    let found = { selection: '', anchor: null };
    if (browser === 'firefox') {
      await session.context('chrome');
      try {
        nativeFind = await session.executeAsync(`
          const done=arguments[arguments.length-1];
          gBrowser.getFindBar().then((bar)=>{
            bar.onFindCommand();
            bar._findField.value='Sunset Supper Club';
            bar._find();
            setTimeout(()=>done({present:true,hidden:bar.hasAttribute('hidden'),value:bar._findField.value,status:bar._findStatusDesc?.textContent ?? null}),500);
          },(error)=>done({present:false,error:String(error)}));
        `);
      } finally {
        await session.context('content');
      }
    } else {
      const query = 'Sunset Supper Club';
      requiredCommand('/usr/bin/open', ['-a', 'Safari', `${vite.url}/?user=eve`]);
      await waitSafariCondition(`
        const se=Application("System Events");
        const items=se.processes.byName("Safari").windows[0].entireContents();
        items.some((item)=>{try{return item.role()==="AXStaticText" && item.name()==="${query}"}catch(_){return false}})
      `, 'ordinary Safari candidate window did not expose the canonical event copy');
      requiredCommand('/usr/bin/osascript', [
        '-e', 'tell application "Safari" to activate',
        '-e', 'tell application "System Events" to keystroke "f" using command down',
      ]);
      await sleep(500);
      // Safari 26.5 moved the Find Banner under a different AX group layout.
      // Select its semantically named search field and result-status control
      // instead of depending on positional splitter/group indices.
      const findState = JSON.parse(requiredCommand('/usr/bin/osascript', [
        '-l', 'JavaScript',
        '-e', `
          const query = ${JSON.stringify(query)};
          const systemEvents = Application("System Events");
          const process = systemEvents.processes.byName("Safari");
          process.frontmost = true;
          const contents = process.windows[0].entireContents();
          const safe = (read) => {
            try { return read(); } catch (_) { return null; }
          };
          const field = contents.find((item) =>
            safe(() => item.role()) === "AXTextField"
            && safe(() => item.description()) === "search text field");
          if (!field) throw new Error("Safari Find Banner search field is unavailable");
          field.value = query;
          systemEvents.keyCode(36);
          delay(0.5);
          const current = process.windows[0].entireContents();
          const status = current.find((item) =>
            safe(() => item.role()) === "AXButton"
            && safe(() => item.description()) === "cancel");
          JSON.stringify({
            value: safe(() => field.value()),
            status: status ? safe(() => status.name()) : null,
          });
        `,
      ]));
      nativeFind = {
        present: true,
        value: findState.value,
        status: findState.status,
        notFound:
          typeof findState.status !== 'string'
          || /not found|0 matches/i.test(findState.status),
      };
      requiredCommand('/usr/bin/osascript', [
        '-e', 'tell application "System Events" to key code 53',
      ]);
      found = {
        selection: query,
        anchor: 'AXButton:View Sunset Supper Club',
      };
    }
    if (browser === 'firefox') {
      await session.keys([press('\uE00C')]);
      found = await session.execute(`
        const selection=getSelection()?.toString() ?? '';
        const anchor=getSelection()?.anchorNode?.parentElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
        return {selection,anchor};
      `);
    }
    const nativeFindPassed = browser === 'firefox'
      ? nativeFind?.present === true && nativeFind.hidden === false && nativeFind.value === 'Sunset Supper Club'
      : nativeFind?.present === true
        && nativeFind.value.toLowerCase() === 'Sunset Supper Club'.toLowerCase()
        && nativeFind.notFound === false;
    if (!nativeFindPassed) {
      throw new Error(`native browser find did not expose the visible query: ${JSON.stringify({ found, nativeFind })}`);
    }
    if (browser === 'firefox') {
      await session.click('[data-testid="open-event_sunset"]');
      await session.wait(`document.querySelector('[data-testid="event-page"]')?.textContent?.includes('Sunset Supper Club')`, 15_000);
    } else {
      requiredCommand('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
        const se=Application("System Events");
        const items=se.processes.byName("Safari").windows[0].entireContents();
        const button=items.find((item)=>{try{return item.role()==="AXButton" && item.name()==="View Sunset Supper Club"}catch(_){return false}});
        if (!button) throw new Error("Safari accessibility tree omitted the event button");
        button.actions.byName("AXPress").perform();
      `]);
      await waitSafariCondition(`
        const safari=Application("Safari");
        String(safari.documents[0].url()).includes("/events/event_sunset")
      `, 'ordinary Safari window was not usable after native Find');
    }
    return {
      query: 'Sunset Supper Club', ...found, nativeFind, usableAfterFind: true,
      input: browser === 'firefox'
        ? 'Firefox native FindBar via privileged WebDriver'
        : 'Safari native Find bar via macOS keyboard and Accessibility APIs',
    };
  });
}, { cleanups, reportFile: receiptFile, reportExtra: reportIdentity });

async function waitUrl(url, child, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; }
    catch { /* keep waiting within the bounded deadline */ }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

async function waitSafariCondition(source, failure, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', source]) === 'true') return;
    await sleep(100);
  }
  throw new Error(failure);
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), `partitime-${browser}-api-`));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], {
    cwd: repoRoot, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  cleanups.push(() => rmSync(readyDir, { recursive: true, force: true }), () => stopChild(child));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const url = `http://127.0.0.1:${JSON.parse(readFileSync(readyFile, 'utf8')).port}`;
      await waitUrl(`${url}/health`, child, 'Snapback');
      return url;
    }
    if (child.exitCode !== null) throw new Error('Snapback exited before readiness');
    await sleep(100);
  }
  throw new Error('Snapback readiness file timed out');
}

async function startGateway(snapbackUrl) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: join(demoRoot, 'backends', 'gateway'), detached: true,
    env: { ...process.env, PARTIFUL_MATRIX_GATEWAY_PORT: String(port), PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => stopChild(child));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'Partitime gateway');
  const response = await fetch(`${url}/preflight`, { signal: AbortSignal.timeout(30_000) });
  const preflight = await response.json();
  if (!response.ok || preflight.backends?.snapback?.ok !== true) throw new Error(`Snapback gateway preflight failed: ${JSON.stringify(preflight)}`);
  return url;
}

async function startVite(snapbackUrl, gatewayUrl) {
  const port = await freePort();
  const vite = join(surfaceRoot, 'node_modules', '.bin', 'vite');
  let log = '';
  const child = spawn('bun', [
    '--bun', vite, '--config', join(surfaceRoot, 'vite.config.ts'),
    '--mode', 'snapback', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], {
    cwd: surfaceRoot, detached: true,
    env: { ...process.env, SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl, PARTIFUL_MATRIX_GATEWAY: gatewayUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try { await waitUrl(url, child, `Contract ${browser} Vite`); }
  catch (error) { await stopChild(child); throw new Error(`${error.message}: ${log.slice(-4000)}`); }
  return { url, stop: () => stopChild(child) };
}

async function startDriver() {
  const port = await freePort();
  let log = '';
  const child = spawn(browserConfig.driver, browserConfig.driverArgs(port), {
    cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  try { await waitUrl(`${origin}/status`, child, `${browser} WebDriver`, 15_000); }
  catch (error) { await stopChild(child); throw new Error(`${error.message}: ${log.slice(-4000)}`); }
  let stopped = false;
  return {
    newSession: async (capabilities) => {
      const created = await webdriver(origin, 'POST', '/session', { capabilities: { alwaysMatch: capabilities } });
      const sessionId = created.sessionId;
      if (!sessionId) throw new Error(`${browser} WebDriver did not return a session id`);
      const endpoint = `/session/${sessionId}`;
      let closed = false;
      return {
        navigate: (url) => webdriver(origin, 'POST', `${endpoint}/url`, { url }),
        execute: (script, args = []) => webdriver(origin, 'POST', `${endpoint}/execute/sync`, { script, args }),
        executeAsync: (script, args = []) => webdriver(origin, 'POST', `${endpoint}/execute/async`, { script, args }),
        click: async (selector) => {
          const element = await webdriver(origin, 'POST', `${endpoint}/element`, { using: 'css selector', value: selector });
          const id = element['element-6066-11e4-a52e-4f735466cecf'];
          if (!id) throw new Error(`${browser} WebDriver did not return an element id for ${selector}`);
          return webdriver(origin, 'POST', `${endpoint}/element/${id}/click`, {});
        },
        keys: (actions) => webdriver(origin, 'POST', `${endpoint}/actions`, {
          actions: [{ type: 'key', id: 'keyboard', actions: actions.flat() }],
        }),
        context: (context) => webdriver(origin, 'POST', `${endpoint}/moz/context`, { context }),
        wait: async (expression, timeout) => {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            if (await webdriver(origin, 'POST', `${endpoint}/execute/sync`, { script: `return Boolean(${expression})`, args: [] })) return;
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
    throw new Error(`${browser} WebDriver ${method} ${path} failed: ${payload.value?.message ?? response.status}`);
  }
  return payload.value;
}
