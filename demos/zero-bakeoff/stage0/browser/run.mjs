#!/usr/bin/env node

// @ref LLP 0155#stage-0--authority-reconciliation-and-baseline-freeze — the
// lead-time browser lane kills an owned real process, reuses its exact profile,
// and exercises two-tab store contention without making a React/server claim.
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import process from 'node:process';
import {chromium} from 'playwright-core';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const demoRoot = resolve(import.meta.dirname, '../..');
const runtimeRoot = resolve(demoRoot, '.runtime/stage0-browser');
const baselinePath = resolve(import.meta.dirname, '../baseline.v1.json');
const pageUrlPath = '/demos/zero-bakeoff/stage0/browser/index.html';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const options = {
  browser: process.env.SNAPBACK_BROWSER_EXECUTABLE ?? null,
  headed: false,
  receipt: resolve(runtimeRoot, 'browser-harness.latest.json'),
};
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--browser') options.browser = process.argv[++index];
  else if (arg === '--receipt') options.receipt = resolve(process.argv[++index]);
  else if (arg === '--headed') options.headed = true;
  else throw new Error(`unknown argument: ${arg}`);
}

const browserCandidates = process.platform === 'darwin'
  ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
  : process.platform === 'linux'
    ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    : [];
const browserExecutable = options.browser ?? browserCandidates.find((path) => existsSync(path));
if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('SNAPBACK_STAGE0_BROWSER_NOT_FOUND: set SNAPBACK_BROWSER_EXECUTABLE or pass --browser');
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const path = resolve(repoRoot, `.${decoded}`);
      const fromRoot = relative(repoRoot, path);
      if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
        response.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': contentTypes.get(extname(path)) ?? 'application/octet-stream',
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('static server did not bind TCP');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolveClose, rejectClose) => server.close((error) => (
        error ? rejectClose(error) : resolveClose()
      )));
    },
  };
}

const processGroupExists = (pid) => {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
};

async function waitForProcessGroupExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid)) {
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
  return true;
}

function signalOwnedProcessGroup(child, signal) {
  if (!Number.isInteger(child.pid) || child.pid <= 1) throw new Error('browser child pid unavailable');
  process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
}

async function launchBrowser(profilePath) {
  const activePortPath = resolve(profilePath, 'DevToolsActivePort');
  // Chrome leaves this locator behind on SIGKILL. Removing only the
  // process-owned locator (not profile data) prevents a relaunch from reading
  // the predecessor's dead port before the successor publishes its own.
  await rm(activePortPath, {force: true});
  const args = [
    `--user-data-dir=${profilePath}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    ...(options.headed ? [] : ['--headless=new', '--disable-gpu']),
    'about:blank',
  ];
  const child = spawn(browserExecutable, args, {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  const exit = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({code, signal})));
  const deadline = Date.now() + 20_000;
  let activePort = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`browser exited before CDP readiness (${child.exitCode ?? child.signalCode})`);
    }
    try {
      const [port] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
      if (/^[0-9]+$/u.test(port)) {
        activePort = Number(port);
        break;
      }
    } catch {
      // Chrome creates DevToolsActivePort only after the profile owns CDP.
    }
    await sleep(50);
  }
  if (activePort === null) {
    signalOwnedProcessGroup(child, 'SIGKILL');
    await exit;
    throw new Error('browser did not publish DevToolsActivePort');
  }
  let browser = null;
  let connectError = null;
  while (Date.now() < deadline && browser === null) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${activePort}`);
    } catch (error) {
      connectError = error;
      await sleep(50);
    }
  }
  if (browser === null) {
    signalOwnedProcessGroup(child, 'SIGKILL');
    await exit;
    throw connectError ?? new Error('browser CDP endpoint did not accept connections');
  }
  const context = browser.contexts()[0];
  if (!context) {
    signalOwnedProcessGroup(child, 'SIGKILL');
    await exit;
    await waitForProcessGroupExit(child.pid);
    throw new Error('CDP browser did not expose its persistent context');
  }
  return {browser, child, context, exit, pid: child.pid};
}

async function terminateBrowser(launch, signal = 'SIGKILL') {
  signalOwnedProcessGroup(launch.child, signal);
  const outcome = await Promise.race([
    launch.exit,
    sleep(10_000).then(() => null),
  ]);
  if (outcome === null) {
    signalOwnedProcessGroup(launch.child, 'SIGKILL');
    throw new Error(`browser process group did not exit after ${signal}`);
  }
  if (!(await waitForProcessGroupExit(launch.pid))) {
    throw new Error('owned browser process group still exists after root exit');
  }
  return {...outcome, pid: launch.pid, requestedSignal: signal, groupGone: true};
}

async function openHarnessPage(context, url) {
  const page = await context.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => typeof globalThis.snapbackStage0Browser?.open === 'function');
  return page;
}

const browserVersion = execFileSync(browserExecutable, ['--version'], {encoding: 'utf8'}).trim();
const sourcePaths = [
  'demos/zero-bakeoff/stage0/browser/index.html',
  'demos/zero-bakeoff/stage0/browser/page.mjs',
  'demos/zero-bakeoff/stage0/browser/run.mjs',
  'packages/snapback-client/rqs-store.mjs',
  'packages/snapback-client/rqs.mjs',
];
const sourceFiles = [];
for (const path of sourcePaths) {
  sourceFiles.push({path, sha256: sha256(await readFile(resolve(repoRoot, path)))});
}
const baselineSha256 = sha256(await readFile(baselinePath));
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repoRoot, encoding: 'utf8'}).trim();
const gitDirty = execFileSync('git', ['status', '--short'], {cwd: repoRoot, encoding: 'utf8'}).trim().length > 0;
const receipt = {
  schemaVersion: 'snapback.local-sync-stage0-browser-receipt.v1',
  startedAt: new Date().toISOString(),
  ok: false,
  expectedChecks: 9,
  checks: [],
  evidenceClass: 'standards-real-browser-process-indexeddb-and-web-locks',
  source: {gitCommit, gitDirty, baselineSha256, files: sourceFiles},
  browser: {
    executable: browserExecutable,
    executableSha256: sha256(await readFile(browserExecutable)),
    version: browserVersion,
    automation: 'playwright-core-connect-over-cdp',
  },
  carrier: {
    implementation: 'indexeddb-plus-web-locks',
    profileReusedAfterSigkill: false,
    databaseName: `snapback-stage0-${randomUUID()}`,
    storageFacts: null,
  },
  target: {
    scope: 'client-store-substrate-only',
    snapbackTargetProfile: 'not-exercised',
  },
  cleanup: {
    firstBrowser: null,
    finalBrowser: null,
    profileRemoved: false,
    profileDirectoriesRemaining: null,
    staticServerClosed: false,
  },
  nonclaims: [
    'No Snapback server or React surface runs in this substrate harness.',
    'No retained/current, full-resync-before-replay, settlement, observer-convergence, or auth-retention product claim follows.',
    'The open JS-arm browser/IndexedDB guide-gap ticket still requires its full resolution witness.',
  ],
};

const check = async (id, run) => {
  const startedAt = Date.now();
  try {
    const details = await run();
    receipt.checks.push({id, outcome: 'PASS', durationMs: Date.now() - startedAt, details: details ?? null});
  } catch (error) {
    receipt.checks.push({
      id,
      outcome: 'FAIL',
      durationMs: Date.now() - startedAt,
      error: String(error?.stack ?? error),
    });
    throw error;
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

await mkdir(runtimeRoot, {recursive: true});
const profilePath = await mkdtemp(resolve(runtimeRoot, 'profile-'));
const profileRelative = relative(runtimeRoot, profilePath);
assert(profileRelative.length > 0 && !profileRelative.startsWith(`..${sep}`), 'profile is outside owned runtime root');
receipt.carrier.profileId = sha256(profileRelative);
let staticServer = null;
let first = null;
let second = null;
let failure = null;

try {
  staticServer = await startStaticServer();
  const harnessUrl = `${staticServer.origin}${pageUrlPath}`;

  first = await launchBrowser(profilePath);
  const firstPage = await openHarnessPage(first.context, harnessUrl);
  await check('browser.standards-real-apis', async () => {
    const facts = await firstPage.evaluate((name) => globalThis.snapbackStage0Browser.open(name), receipt.carrier.databaseName);
    assert(facts.indexedDb === true, 'browser does not expose IndexedDB');
    assert(facts.webLocks === true, 'browser does not expose Web Locks');
    assert(facts.durability?.implementation === 'indexeddb' && facts.durability?.durable === true,
      'store did not report the durable IndexedDB carrier');
    return facts;
  });
  await check('browser.initial-single-writer', async () => {
    const writer = await firstPage.evaluate(() => globalThis.snapbackStage0Browser.waitForWriter());
    assert(writer === true, 'initial tab did not acquire the Web Lock');
    return {writer};
  });
  await check('browser.indexeddb-commit-before-kill', async () => {
    const committed = await firstPage.evaluate(() => globalThis.snapbackStage0Browser.commit(1, 'before-process-kill'));
    const loaded = await firstPage.evaluate(() => globalThis.snapbackStage0Browser.load());
    assert(committed.result?.persisted === true, 'initial writer did not persist');
    assert(loaded.verification?.ok === true, 'initial persisted entry did not verify');
    assert(loaded.persisted?.meta?.version === 1, 'initial persisted version mismatch');
    return {committed, version: loaded.persisted.meta.version};
  });
  await check('browser.full-process-sigkill', async () => {
    receipt.cleanup.firstBrowser = await terminateBrowser(first, 'SIGKILL');
    first = null;
    assert(receipt.cleanup.firstBrowser.groupGone === true, 'browser process group survived SIGKILL');
    return receipt.cleanup.firstBrowser;
  });

  second = await launchBrowser(profilePath);
  const writerTab = await openHarnessPage(second.context, harnessUrl);
  await writerTab.evaluate((name) => globalThis.snapbackStage0Browser.open(name), receipt.carrier.databaseName);
  await writerTab.evaluate(() => globalThis.snapbackStage0Browser.waitForWriter());
  await check('browser.relaunch-same-profile-indexeddb', async () => {
    const loaded = await writerTab.evaluate(() => globalThis.snapbackStage0Browser.load());
    assert(loaded.verification?.ok === true, 'relaunch entry did not verify');
    assert(loaded.persisted?.meta?.version === 1, 'relaunch did not recover version 1');
    assert(loaded.persisted?.rows?.[0]?.value === 'before-process-kill', 'relaunch row bytes moved');
    receipt.carrier.profileReusedAfterSigkill = true;
    return {version: loaded.persisted.meta.version, value: loaded.persisted.rows[0].value};
  });

  const readerTab = await openHarnessPage(second.context, harnessUrl);
  await readerTab.evaluate((name) => globalThis.snapbackStage0Browser.open(name), receipt.carrier.databaseName);
  await sleep(250);
  await check('browser.two-tab-single-writer-contention', async () => {
    const [writer, reader] = await Promise.all([
      writerTab.evaluate(() => globalThis.snapbackStage0Browser.info()),
      readerTab.evaluate(() => globalThis.snapbackStage0Browser.info()),
    ]);
    assert(writer.writer === true, 'first relaunch tab lost writer role early');
    assert(reader.writer === false, 'second tab incorrectly became a concurrent writer');
    return {writer: writer.writer, reader: reader.writer};
  });
  await check('browser.reader-adopts-and-refuses-write', async () => {
    const refused = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.commit(99, 'forbidden-reader-write'));
    const adopted = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.load());
    assert(refused.result?.persisted === false && refused.result?.reason === 'not_writer',
      'reader write did not refuse as not_writer');
    assert(adopted.verification?.ok === true && adopted.persisted?.meta?.version === 1,
      'reader did not adopt the writer entry');
    return {refused: refused.result, adoptedVersion: adopted.persisted.meta.version};
  });
  await writerTab.close();
  await check('browser.tab-death-transfers-web-lock', async () => {
    const becameWriter = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.waitForWriter());
    assert(becameWriter === true, 'surviving tab did not acquire the released Web Lock');
    return {becameWriter};
  });
  await check('browser.takeover-writer-commits', async () => {
    const committed = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.commit(2, 'after-tab-takeover'));
    const loaded = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.load());
    assert(committed.result?.persisted === true, 'takeover writer did not persist');
    assert(loaded.verification?.ok === true && loaded.persisted?.meta?.version === 2,
      'takeover entry did not verify at version 2');
    receipt.carrier.storageFacts = await readerTab.evaluate(() => globalThis.snapbackStage0Browser.storageFacts());
    return {version: loaded.persisted.meta.version, storageFacts: receipt.carrier.storageFacts};
  });
} catch (error) {
  failure = error;
} finally {
  if (first !== null) {
    try {
      receipt.cleanup.firstBrowser = await terminateBrowser(first, 'SIGKILL');
    } catch (error) {
      failure ??= error;
    }
  }
  if (second !== null) {
    try {
      receipt.cleanup.finalBrowser = await terminateBrowser(second, 'SIGTERM');
    } catch (error) {
      failure ??= error;
    }
  }
  if (staticServer !== null) {
    try {
      await staticServer.close();
      receipt.cleanup.staticServerClosed = true;
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    await rm(profilePath, {recursive: true});
    receipt.cleanup.profileRemoved = !existsSync(profilePath);
  } catch (error) {
    failure ??= error;
  }
  try {
    receipt.cleanup.profileDirectoriesRemaining = (await readdir(runtimeRoot, {withFileTypes: true}))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('profile-'))
      .map((entry) => entry.name)
      .sort();
    if (receipt.cleanup.profileDirectoriesRemaining.length > 0) {
      failure ??= new Error(
        `owned browser profiles remain: ${receipt.cleanup.profileDirectoriesRemaining.join(', ')}`,
      );
    }
  } catch (error) {
    failure ??= error;
  }
}

receipt.finishedAt = new Date().toISOString();
receipt.ok = failure === null
  && receipt.checks.length === receipt.expectedChecks
  && receipt.checks.every(({outcome}) => outcome === 'PASS')
  && receipt.cleanup.firstBrowser?.groupGone === true
  && receipt.cleanup.finalBrowser?.groupGone === true
  && receipt.cleanup.profileRemoved === true
  && receipt.cleanup.profileDirectoriesRemaining?.length === 0
  && receipt.cleanup.staticServerClosed === true;
if (failure !== null) receipt.error = String(failure?.stack ?? failure);
await mkdir(dirname(options.receipt), {recursive: true});
await writeFile(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  ok: receipt.ok,
  expectedChecks: receipt.expectedChecks,
  passed: receipt.checks.filter(({outcome}) => outcome === 'PASS').length,
  browser: receipt.browser.version,
  receipt: options.receipt,
  cleanup: receipt.cleanup,
})}\n`);
if (!receipt.ok) process.exitCode = 1;
