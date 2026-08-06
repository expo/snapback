import assert from 'node:assert/strict';
import {execFile, spawn, type ChildProcess} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';

import {
  launchChromeCdp,
  NO_PRIMARY_FAILURE,
  throwRunAndCleanupFailures,
} from '../../../../_kit/chrome-process.mjs';
import {ownProcessTree, startServer, stopChild} from '../../../../_kit/server-process.mjs';
import {bindActorsAgainstReadyFile} from '../../scripts/bind-actors.mts';
import {loadFixtureAgainstReadyFile} from '../../scripts/load-fixture.mts';
import {
  defaultListContext,
  loadOracleFixture,
  oracleIssueList,
  sourceID,
  type OracleRow,
} from '../lane3-oracle.mts';

type Check = Readonly<{id: string; status: 'pass'}>;
type OwnedProcess = Readonly<{child: ChildProcess; stop(): Promise<void>; output(): string}>;
type Gateway = OwnedProcess & Readonly<{origin: string}>;

const execFileAsync = promisify(execFile);
const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const REPO_ROOT = resolve(CONTROL_ROOT, '../../..');
const EXPECTED_CHECKS = 12;
const PAGE_SIZE = 40;
const CHROME_BIN = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms: number) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAuthNetworkUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname;
    return pathname.startsWith('/__snapback/auth/')
      || pathname.startsWith('/api/login/github')
      || pathname === '/api/auth/bootstrap';
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object');
      server.close(error => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

function spawnOwned(command: string, args: string[], options: Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
}>): OwnedProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const append = (chunk: unknown) => {log = `${log}${String(chunk)}`.slice(-64_000);};
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const ownership = ownProcessTree(child, () => stopChild(child));
  return {child, stop: () => ownership.stop(), output: () => log};
}

async function waitHttp(url: string, process: OwnedProcess, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'not ready';
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      throw new Error(`process exited before ${url} became ready:\n${process.output()}`);
    }
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1_000)});
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = errorText(error);
    }
    await sleep(50);
  }
  throw new Error(`${url} did not become ready: ${last}\n${process.output()}`);
}

async function configure(serverUrl: string, adminToken: string): Promise<void> {
  for (const [entry, value] of [
    ['loopsApiKey', 'lane6b-live-loops-v1'],
    ['discordWebhookToken', 'lane6b-live-discord-v1'],
    ['captureAdapterAuth', 'lane6b-live-capture-v1'],
  ]) {
    const response = await fetch(`${serverUrl}/_snapback/api/config/set`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-snapback-admin-token': adminToken},
      body: JSON.stringify({entry, value}),
    });
    assert.equal(response.status, 200, `${entry} configured before app data`);
    assert(!(await response.text()).includes(value), `${entry} response does not disclose its secret`);
  }
}

async function startGateway(options: Readonly<{
  port: number;
  actor: 'ordinary-user' | 'crew-admin';
  serverReadyFile: string;
  gatewayReadyFile: string;
  captureDir: string;
  redirectOrigins: readonly string[];
}>): Promise<Gateway> {
  await rm(options.gatewayReadyFile, {force: true});
  const origin = `http://127.0.0.1:${options.port}`;
  const child = spawnOwned(globalThis.process.execPath, ['composition/server.mts'], {
    cwd: CONTROL_ROOT,
    env: {
      ...globalThis.process.env,
      SNAPBACK_READY_FILE: options.serverReadyFile,
      ZERBUGS_GATEWAY_READY_FILE: options.gatewayReadyFile,
      ZERBUGS_CAPTURE_DIR: options.captureDir,
      ZERBUGS_GATEWAY_PORT: String(options.port),
      ZERBUGS_OAUTH_FIXTURE_ACTOR: options.actor,
      ZERBUGS_OAUTH_REDIRECT_ORIGINS: [origin, ...options.redirectOrigins].join(','),
    },
  });
  try {
    await waitHttp(`${origin}/health`, child);
    return {...child, origin};
  } catch (error) {
    await child.stop();
    throw error;
  }
}

function physicalUser(fixture: Awaited<ReturnType<typeof loadOracleFixture>>, id: unknown): OracleRow {
  const user = fixture.tables.user.find(row => row._id === id);
  assert(user, `fixture user ${String(id)} exists`);
  return user;
}

function labelForIssue(fixture: Awaited<ReturnType<typeof loadOracleFixture>>, issue: OracleRow): string | null {
  const edge = fixture.tables.issueLabel.find(row => row.issueID === issue._id);
  const label = edge && fixture.tables.label.find(row => row._id === edge.labelID);
  return typeof label?.name === 'string' ? label.name : null;
}

async function connectCdp(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  let nextId = 1;
  const traceStart = Date.now();
  const trace = (line: string) => {
    if (!globalThis.process.env.ZB6B_CDP_TRACE) return;
    globalThis.process.stderr.write(`[cdp +${Date.now() - traceStart}ms] ${line}\n`);
  };
  socket.addEventListener('message', async event => {
    if (!globalThis.process.env.ZB6B_CDP_TRACE) return;
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload) as {id?: number; method?: string; params?: any};
    if (message.id) {trace(`<- reply id=${message.id}`); return;}
    const method = message.method ?? '';
    if (/^(Page\.frame(Navigated|StartedLoading|StoppedLoading)|Runtime\.executionContext|Target\.|Inspector\.)/.test(method)) {
      const detail = method === 'Runtime.executionContextCreated'
        ? ` ctx=${message.params?.context?.id} origin=${message.params?.context?.origin}`
        : method === 'Runtime.executionContextDestroyed'
          ? ` ctx=${message.params?.executionContextId}`
          : method.startsWith('Page.frame')
            ? ` url=${message.params?.frame?.url ?? ''}`
            : '';
      trace(`event ${method}${detail}`);
    }
  });
  socket.addEventListener('message', async event => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload) as {id?: number; result?: unknown; error?: {message?: string}};
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? 'CDP command failed'));
    else entry.resolve(message.result ?? {});
  });
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(), {once: true});
    socket.addEventListener('error', () => rejectOpen(new Error('CDP socket failed')), {once: true});
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    const id = nextId++;
    trace(`-> id=${id} ${method}`);
    socket.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    return new Promise<any>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        trace(`!! timeout id=${id} ${method}`);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, {resolve: resolveCommand, reject: rejectCommand, timer});
    });
  };
  const consoleLog: string[] = [];
  socket.addEventListener('message', async event => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload) as {method?: string; params?: any};
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params?.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ');
      consoleLog.push(`[${message.params?.type}] ${text}`.slice(0, 300));
      if (consoleLog.length > 40) consoleLog.shift();
    }
    if (message.method === 'Network.requestWillBeSent') {
      const url = String(message.params?.request?.url ?? '');
      if (isAuthNetworkUrl(url)) {
        consoleLog.push(`[net>] ${message.params?.request?.method} ${url}`.slice(0, 200));
        if (consoleLog.length > 40) consoleLog.shift();
      }
    }
    if (message.method === 'Network.responseReceived') {
      const url = String(message.params?.response?.url ?? '');
      if (isAuthNetworkUrl(url)) {
        consoleLog.push(`[net<] ${message.params?.response?.status} ${url}`.slice(0, 200));
        if (consoleLog.length > 40) consoleLog.shift();
      }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleLog.push(`[exception] ${JSON.stringify(message.params?.exceptionDetails ?? {}).slice(0, 300)}`);
      if (consoleLog.length > 40) consoleLog.shift();
    }
  });
  let pausedFrames: unknown = null;
  socket.addEventListener('message', async event => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload) as {method?: string; params?: any};
    if (message.method === 'Debugger.paused') {
      pausedFrames = (message.params?.callFrames ?? []).slice(0, 14).map((f: any) => ({
        fn: f.functionName || '(anon)',
        url: String(f.url ?? '').split('/').slice(-2).join('/'),
        line: f.location?.lineNumber,
      }));
    }
  });
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  await Promise.all([
    send('Page.enable', {}, sessionId),
    send('Runtime.enable', {}, sessionId),
    send('DOM.enable', {}, sessionId),
    send('Network.enable', {}, sessionId),
  ]);
  const evaluate = async <T>(expression: string): Promise<T> => {
    // Coerce every result to JSON-safe primitives inside the page: deep or
    // cyclic values (DOM nodes, React fibers) make CDP's returnByValue fail
    // with "Object reference chain is too long". Await before coercion so
    // promise-valued checks keep their resolved value rather than becoming {}.
    const wrapped = `(async()=>{const __v=await (${expression});try{return __v===undefined?null:JSON.parse(JSON.stringify(__v))}catch{return String(__v)}})()`;
    const result = await send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value as T;
  };
  const page = {
    eval: evaluate,
    async pauseStack(): Promise<unknown> {
      pausedFrames = null;
      try {
        await send('Debugger.enable', {}, sessionId);
        send('Debugger.pause', {}, sessionId).catch(() => {});
        for (let i = 0; i < 60 && pausedFrames === null; i += 1) await sleep(100);
        send('Debugger.resume', {}, sessionId).catch(() => {});
      } catch { /* diagnostic only */ }
      return pausedFrames;
    },
    navigate: (target: string) => send('Page.navigate', {url: target}, sessionId),
    async wait(expression: string, label: string, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      let last: unknown = null;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last) return last;
        await sleep(50);
      }
      const datasets = await evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-window-phase],[data-list-state],.issue-list-scroll,[data-session-phase]')].map(el=>({tag:el.tagName,cls:el.className,ds:{...el.dataset}})))`,
      );
      throw new Error(`${label} timed out; last=${JSON.stringify(last)}; url=${await evaluate('location.href')}; datasets=${datasets}; console=${JSON.stringify(consoleLog.slice(-25))}; body=${await evaluate('document.body.innerText.slice(0, 400)')}`);
    },
    click(selector: string) {
      // The pinned Button fires onAction on primary-button mousedown, so a
      // bare element.click() never reaches it — dispatch the full sequence.
      return evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error('missing ${selector}'); element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,detail:1})); element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,detail:1})); element.click(); return true})()`);
    },
    clickText(text: string, scope = 'document') {
      return evaluate(`(() => {const root=${scope}; const element=[...root.querySelectorAll('button,a,[role="option"]')].find(value=>value.textContent.trim()===${JSON.stringify(text)}); if(!element) throw new Error('missing text ${text}'); element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,detail:1})); element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,detail:1})); element.click(); return true})()`);
    },
    setValue(selector: string, value: string) {
      return evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)}); if(!element) throw new Error('missing ${selector}'); const setter=Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(value)}})); element.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
    },
    async setFile(selector: string, path: string) {
      const {root} = await send('DOM.getDocument', {depth: -1, pierce: true}, sessionId);
      const {nodeId} = await send('DOM.querySelector', {nodeId: root.nodeId, selector}, sessionId);
      assert(nodeId, `file input ${selector} exists`);
      await send('DOM.setFileInputFiles', {nodeId, files: [path]}, sessionId);
    },
    rows: () => evaluate<string[]>(`[...document.querySelectorAll('[data-issue-id]')].map(row=>row.getAttribute('data-issue-id'))`),
    emulateLatency(latency: number) {
      return send('Network.emulateNetworkConditions', {
        offline: false,
        latency,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: 'other',
      }, sessionId);
    },
  };
  return {page, close: () => socket.close()};
}

async function waitRows(page: Awaited<ReturnType<typeof connectCdp>>['page'], expected: readonly string[], label: string) {
  await page.wait(`(() => {const got=[...document.querySelectorAll('[data-issue-id]')].map(row=>row.getAttribute('data-issue-id')); const expected=${JSON.stringify(expected)}; return got.length>=expected.length&&expected.every((id,index)=>got[index]===id)})()`, label);
}

async function chooseFilter(page: Awaited<ReturnType<typeof connectCdp>>['page'], heading: string, value: string) {
  await page.click('.add-filter');
  await page.wait(`document.querySelectorAll('.filter-modal-item').length===3`, 'filter popover');
  await page.eval(`(() => {const section=[...document.querySelectorAll('.filter-modal-item')].find(node=>node.querySelector('.filter-modal-label')?.textContent.trim()===${JSON.stringify(heading)}); const input=section?.querySelector('[role="combobox"]'); if(!input) throw new Error('missing ${heading} combobox'); input.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); input.focus(); return true})()`);
  await page.wait(`[...document.querySelectorAll('.filter-modal-item')].some(section=>section.querySelector('.filter-modal-label')?.textContent.trim()===${JSON.stringify(heading)}&&[...section.querySelectorAll('[role="option"]')].some(option=>option.textContent.trim()===${JSON.stringify(value)}))`, `${heading} option`);
  await page.eval(`(() => {const section=[...document.querySelectorAll('.filter-modal-item')].find(node=>node.querySelector('.filter-modal-label')?.textContent.trim()===${JSON.stringify(heading)}); const option=[...section.querySelectorAll('[role="option"]')].find(node=>node.textContent.trim()===${JSON.stringify(value)}); option.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return true})()`);
}

async function main(): Promise<void> {
  // realpath: macOS tmpdir lives behind a /var → /private/var symlink, and the
  // runtime's mechanical sibling-path check canonicalizes before comparing.
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'zerobugs-lane6b-live-')));
  const cleanup: Array<Readonly<{label: string; run(): Promise<void> | void}>> = [];
  const checks: Check[] = [];
  let primaryError: unknown = NO_PRIMARY_FAILURE;
  let gateway: Gateway | null = null;
  let receipt: Record<string, unknown> | null = null;

  const check = async (id: string, action: () => Promise<void>) => {
    await action();
    checks.push(Object.freeze({id, status: 'pass'}));
  };

  try {
    const schema = JSON.parse(await readFile(join(CONTROL_ROOT, 'snapback/generated/schema.manifest.json'), 'utf8'));
    const functions = JSON.parse(await readFile(join(CONTROL_ROOT, 'snapback/generated/functions.manifest.json'), 'utf8'));
    const startup = join(scratch, 'startup-artifacts.json');
    await writeFile(startup, `${JSON.stringify({formatVersion: 1, schema, functions})}\n`, {mode: 0o600});
    const server = await startServer({
      port: 0,
      db: join(scratch, 'zerobugs.sqlite'),
      cwd: REPO_ROOT,
      startupArtifacts: startup,
      captureImpersonationCapability: true,
      serverBinary: process.env.SNAPBACK_SERVER_BINARY ?? process.env.SNAPBACK_RUNTIME_BINARY ?? null,
      env: {SNAPBACK_OUTBOUND_ACTIONS: '1'},
    });
    cleanup.push({label: 'Snapback server', run: () => server.stop()});
    assert.equal(server.reused, false, 'Lane 6b owns a fresh server');
    assert(server.adminToken && server.impersonationCapability, 'server exposes owned acceptance credentials');

    const readyFile = join(scratch, 'server.ready.json');
    const adminTokenFile = join(scratch, 'admin.token');
    const impersonationFile = `${readyFile}.impersonation`;
    await writeFile(adminTokenFile, `${server.adminToken}\n`, {mode: 0o600});
    // Exact bounded bytes: the runtime's sidecar parser accepts no trailing
    // newline or alternate framing.
    await writeFile(impersonationFile, String(server.impersonationCapability), {mode: 0o600});
    // `session mint --ready-file` validates the full HostReadyDescriptor
    // shape (schemaVersion/descriptorKind/startupId/ready/serverUrl/host/
    // port/pid/target/database/startedAtMs/adminGated + diagnostics), not a
    // minimal synthesized stub.
    const serverPort = Number(new URL(server.baseUrl).port);
    await writeFile(readyFile, `${JSON.stringify({
      schemaVersion: 'snapback.v0',
      descriptorKind: 'snapbackHostReady',
      startupId: `srt-lane6b-${server.pid}`,
      ready: true,
      serverUrl: server.baseUrl,
      host: '127.0.0.1',
      port: serverPort,
      pid: server.pid,
      startupNonce: server.startupNonce,
      target: {
        appId: 'zerobugs-control',
        appRoot: null,
        targetProfile: 'local-dev-sqlite-ibex',
        serverUrl: server.baseUrl,
      },
      database: {mode: 'sqlite', path: join(scratch, 'zerobugs.sqlite')},
      startedAtMs: Date.now(),
      adminGated: true,
      adminTokenFile,
      impersonationCapabilityFile: impersonationFile,
      diagnostics: [],
    })}\n`, {mode: 0o600});
    await configure(server.baseUrl, server.adminToken);
    const loaded = await loadFixtureAgainstReadyFile(readyFile);
    assert.equal(loaded.counts.issue, 517);
    const bound = await bindActorsAgainstReadyFile(readyFile);
    cleanup.push({label: 'bound actor clients', run: () => bound.close()});

    const gatewayPort = await freePort();
    // The SPA origin must be in the OAuth redirect allowlist, so allocate the
    // vite port before the gateway starts.
    const vitePort = await freePort();
    const viteOrigin = `http://127.0.0.1:${vitePort}`;
    const gatewayReadyFile = join(scratch, 'gateway.ready.json');
    const gatewayOptions = {
      port: gatewayPort,
      serverReadyFile: readyFile,
      gatewayReadyFile,
      captureDir: join(scratch, 'captures'),
      redirectOrigins: [viteOrigin],
    };
    gateway = await startGateway({...gatewayOptions, actor: 'ordinary-user'});
    cleanup.push({label: 'gateway', run: async () => {if (gateway) await gateway.stop();}});

    await execFileAsync(process.execPath, ['run', 'build'], {
      cwd: CONTROL_ROOT,
      env: {...process.env, SNAPBACK_RELAY_ORIGIN: server.baseUrl, ZERBUGS_GATEWAY_ORIGIN: gateway.origin},
      maxBuffer: 8 * 1024 * 1024,
    });
    const vite = spawnOwned(join(CONTROL_ROOT, 'node_modules/.bin/vite'), [
      '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
    ], {
      cwd: CONTROL_ROOT,
      env: {...process.env, SNAPBACK_RELAY_ORIGIN: server.baseUrl, ZERBUGS_GATEWAY_ORIGIN: gateway.origin},
    });
    cleanup.push({label: 'Vite dev relay', run: () => vite.stop()});
    const origin = viteOrigin;
    await waitHttp(origin, vite, 60_000);

    const chrome = await launchChromeCdp({
      chromeBin: CHROME_BIN,
      userDataPrefix: 'zerobugs-lane6b-',
      ...(globalThis.process.env.ZERBUGS_CHROME_PROFILE
        ? {userDataDir: globalThis.process.env.ZERBUGS_CHROME_PROFILE}
        // The kit default is os.tmpdir(), which resolves to the long per-user
        // /var/folders path on macOS. Chrome failed to open IndexedDB there
        // under the supervising shell, while an otherwise identical /tmp
        // profile worked. Keep kit ownership/cleanup, but choose that short
        // root unless the supervisor supplies a retained profile explicitly.
        : {tempRoot: '/tmp'}),
      extraArgs: ['--disable-background-networking'],
    });
    cleanup.push({label: 'Chrome process/profile', run: () => chrome.stop()});
    const cdp = await connectCdp(chrome.ws);
    cleanup.push({label: 'CDP socket', run: () => cdp.close()});
    const page = cdp.page;
    const fixture = await loadOracleFixture();
    const openContext = defaultListContext({open: true});
    const openExpected = oracleIssueList(fixture, openContext, 'ordinary-user').map(sourceID);

    await page.navigate(`${origin}/p/zero`);
    await page.wait(`document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`, 'anonymous list boot');
    await page.clickText('Login');
    await page.wait(`document.querySelector('.logged-in-user-name')?.textContent.trim().length>0`, 'ordinary login');

    await check('bound-actor-list-renders-516-project-first-window-labels-and-view-state', async () => {
      await waitRows(page, openExpected.slice(0, PAGE_SIZE), 'ordinary first list window');
      // 516, not 517: the ordinary actor must not see the crew-only internal
      // policy-extension issue in any count-like UI (ZB4 existence-oracle
      // protection). The crew checks assert the 517 view separately.
      assert.equal(await page.eval(`document.querySelector('[data-project-issue-count]')?.getAttribute('data-project-issue-count')`), '516');
      assert(await page.eval(`document.querySelectorAll('.issue-taglist .pill.label').length>0`), 'first window contains labels');
      assert(await page.eval(`document.querySelectorAll('.view-state-dot').length>0`), 'bound actor view-state dots render');
    });

    await check('open-and-closed-filter-interactions-converge-to-oracle', async () => {
      await page.clickText('Closed', `document.querySelector('.section-tabs')`);
      const expected = oracleIssueList(fixture, defaultListContext({open: false}), 'ordinary-user').map(sourceID);
      await waitRows(page, expected.slice(0, PAGE_SIZE), 'closed filter first page');
      await page.clickText('Open', `document.querySelector('.section-tabs')`);
      await waitRows(page, openExpected.slice(0, PAGE_SIZE), 'open filter first page');
    });

    const creatorLogin = String(physicalUser(fixture, fixture.tables.issue.find(row => row.id === openExpected[0])?.creatorID).login);
    await check('creator-picker-filter-converges-to-oracle', async () => {
      await chooseFilter(page, 'Creator', creatorLogin);
      const expected = oracleIssueList(fixture, defaultListContext({open: true, creator: creatorLogin}), 'ordinary-user').map(sourceID);
      await waitRows(page, expected.slice(0, Math.min(PAGE_SIZE, expected.length)), 'creator filter first page');
      await page.click('[data-key="creator"]');
      await waitRows(page, openExpected.slice(0, PAGE_SIZE), 'creator filter cleared');
    });

    const labeledIssue = fixture.tables.issue.find(row => openExpected.includes(String(row.id)) && labelForIssue(fixture, row));
    assert(labeledIssue);
    const labelName = labelForIssue(fixture, labeledIssue);
    assert(labelName);
    await check('label-filter-interaction-converges-to-oracle', async () => {
      await chooseFilter(page, 'Label', labelName);
      const expected = oracleIssueList(fixture, defaultListContext({open: true, labels: [labelName]}), 'ordinary-user').map(sourceID);
      await waitRows(page, expected.slice(0, Math.min(PAGE_SIZE, expected.length)), 'label filter first page');
      await page.click('[data-key="label"]');
      await waitRows(page, openExpected.slice(0, PAGE_SIZE), 'label filter cleared');
    });

    const searchNeedle = String(fixture.tables.issue.find(row => row.id === openExpected[0])?.title).split(/\s+/u).find(word => word.length >= 5) ?? 'issue';
    await check('text-search-interaction-converges-to-oracle', async () => {
      await page.click('.search-toggle');
      await page.setValue('.search-input', searchNeedle);
      const expected = oracleIssueList(fixture, defaultListContext({open: true, textFilter: searchNeedle}), 'ordinary-user').map(sourceID);
      await waitRows(page, expected.slice(0, Math.min(PAGE_SIZE, expected.length)), 'text search first page');
      await page.setValue('.search-input', '');
      await waitRows(page, openExpected.slice(0, PAGE_SIZE), 'text search cleared');
    });

    await check('sort-flip-and-three-forward-windows-back-have-no-gaps-or-duplicates', async () => {
      await page.click('.sort-control');
      const sorted = oracleIssueList(fixture, defaultListContext({open: true, sortField: 'created'}), 'ordinary-user').map(sourceID);
      await waitRows(page, sorted.slice(0, PAGE_SIZE), 'created sort first page');
      for (let index = 0; index < 3; index += 1) {
        const before = (await page.rows()).length;
        await page.eval(`(() => {const list=document.querySelector('.issue-list-scroll'); list.scrollTop=list.scrollHeight; list.dispatchEvent(new Event('scroll',{bubbles:true})); return true})()`);
        await page.wait(`document.querySelectorAll('[data-issue-id]').length>${before}`, `forward window ${index + 1}`);
      }
      const keys = await page.rows();
      assert.deepEqual(keys, sorted.slice(0, keys.length));
      assert.equal(new Set(keys).size, keys.length);
      await page.eval(`(() => {const list=document.querySelector('.issue-list-scroll'); list.scrollTop=0; list.dispatchEvent(new Event('scroll',{bubbles:true})); return true})()`);
      assert.deepEqual(await page.rows(), keys);
    });

    const publicIssue = fixture.tables.issue.find(row => row.id === openExpected[0]);
    assert(publicIssue);
    await check('public-detail-renders-full-relational-graph-and-ordinary-internal-is-not-found', async () => {
      await page.navigate(`${origin}/p/zero/issue/${publicIssue.shortID ?? publicIssue.id}`);
      await page.wait(`document.querySelector('[data-relation-graph="project creator assignee labels emoji comments"]')`, 'public relation graph');
      assert(await page.eval(`document.querySelector('.issue-creator')?.textContent.trim().length>0`));
      await page.navigate(`${origin}/p/zero/issue/9183001`);
      await page.wait(`document.querySelector('[data-issue-not-found]')`, 'ordinary internal not found');
    });

    await check('full-reload-restores-authenticated-browser-custody', async () => {
      // The internal-issue not-found route does not render the nav. This full
      // page navigation intentionally reconstructs the app and coordinator;
      // the successor must adopt IndexedDB custody without another exchange.
      await page.navigate(`${origin}/p/zero`);
      await page.wait(
        `document.querySelector('[data-session-phase="authenticated"]')&&document.querySelector('.logout-button')`,
        'authenticated custody restores after full reload',
      );
      await page.wait(
        `document.querySelector('[data-project-issue-count]')?.getAttribute('data-project-issue-count')==='516'`,
        'ordinary list restores after authenticated reload',
      );
      assert.equal(
        await page.eval(`document.querySelector('[data-project-issue-count]')?.getAttribute('data-project-issue-count')`),
        '516',
      );
    });

    await check('logout-switch-blanks-predecessor-then-crew-renders-internal-detail', async () => {
      await page.wait(`document.querySelector('.logout-button')`, 'nav with logout renders');
      await page.click('.logout-button');
      await page.wait(`!document.querySelector('.logged-in-user-name')`, 'predecessor identity blanked');
      await gateway!.stop();
      gateway = await startGateway({...gatewayOptions, actor: 'crew-admin'});
      await page.clickText('Login');
      await page.wait(`document.querySelector('.logged-in-user-name')?.textContent.trim().length>0`, 'crew login');
      await page.wait(
        `document.querySelector('[data-project-issue-count]')?.getAttribute('data-project-issue-count')==='517'`,
        'crew sees complete project count',
      );
      await page.navigate(`${origin}/p/zero/issue/9183001`);
      await page.wait(`document.querySelector('[data-issue-detail="zbav1_internal_issue"]')`, 'crew internal detail');
      assert.equal(await page.eval(`document.querySelector('[data-issue-detail]')?.getAttribute('data-visibility')`), 'internal');
    });

    const protectedComment = fixture.tables.comment.find(row => row.issueID === 'issue_policy_extension_internal');
    const internalComment = protectedComment ?? fixture.tables.comment.find(row => row.body === 'policy-extension-v1 protected child comment');
    assert(internalComment);
    await check('comment-permalink-hydrates-target-window-and-scrolls-to-target', async () => {
      await page.navigate(`${origin}/p/zero/issue/9183001#comment-${internalComment.id}`);
      await page.wait(`document.querySelector('[data-vrow-key="${internalComment.id}"]')`, 'permalink comment row');
      // The scroll restore runs from an effect once the permalink window
      // settles, so the in-viewport fact is awaited rather than asserted
      // against the first frame that renders the row.
      await page.wait(`(() => {const row=document.querySelector('[data-vrow-key="${internalComment.id}"]'); if(!row) return false; const rect=row.getBoundingClientRect(); return rect.bottom>0&&rect.top<innerHeight})()`, 'permalink comment scrolled into view');
    });

    let createdUrl = '';
    await check('composer-paints-optimistically-settles-and-surfaces-a-real-duplicate-refusal', async () => {
      await page.navigate(`${origin}/p/zero`);
      await page.wait(`document.querySelector('.primary-cta')`, 'list after crew switch');
      // The composer CTA is login-checked; clicking before custody restore
      // settles opens the not-logged-in modal instead of the composer.
      await page.wait(`document.querySelector('[data-session-phase="authenticated"]')`, 'crew custody restored before composing');
      await page.eval(`Object.defineProperty(globalThis.crypto,'getRandomValues',{configurable:true,value(array){array.fill(7);return array}})`);
      await page.emulateLatency(900);
      await page.click('.primary-cta');
      await page.setValue('.new-issue-title', 'Lane 6b optimistic issue');
      await page.setValue('.new-issue-description', 'Created through the pinned composer');
      await page.clickText('Save Issue');
      await page.wait(`document.querySelector('[data-optimistic-status="pending"]')`, 'optimistic issue row', 5_000);
      await page.emulateLatency(0);
      await page.wait(`location.pathname.includes('/issue/')&&document.querySelector('[data-issue-detail]')`, 'authoritative create settlement');
      createdUrl = await page.eval(`location.href`);
      await page.clickText('Issues');
      await page.wait(`document.querySelector('.primary-cta')`, 'return to list');
      await page.click('.primary-cta');
      await page.setValue('.new-issue-title', 'Lane 6b duplicate refusal');
      await page.clickText('Save Issue');
      await page.wait(`document.querySelector('.mutation-refusal[role="alert"]')`, 'duplicate refusal surfaced');
      assert(!await page.eval(`document.querySelector('[data-optimistic-status="pending"]')`), 'refused optimistic layer rebased away');
    });

    await check('image-attach-presign-delivery-and-markdown-render-use-gateway-adapter', async () => {
      const imagePath = join(scratch, 'lane6b.png');
      await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLGCSAQANBAECv1AVswAAAABJRU5ErkJggg==', 'base64'));
      await page.navigate(createdUrl);
      await page.wait(`document.querySelector('.edit-button')`, 'created issue detail');
      await page.click('.edit-button');
      await page.setFile('.edit-description-container input[type="file"]', imagePath);
      await page.wait(`document.querySelector('.edit-description')?.value.includes('/assets/zba_')`, 'delivered image markdown inserted');
      await page.click('.save-button');
      await page.wait(`document.querySelector('.markdown-container img[src*="/assets/zba_"]')`, 'delivered image markdown rendered');
      assert.equal(await page.eval(`fetch(document.querySelector('.markdown-container img').src).then(response=>response.status)`), 200);
    });

    assert.equal(checks.length, EXPECTED_CHECKS);
    receipt = {
      schemaVersion: 'zerobugs-lane6b-live.v1',
      status: 'ok',
      expectedChecks: EXPECTED_CHECKS,
      executedChecks: checks.length,
      fixtureIssues: loaded.counts.issue,
      pageSize: PAGE_SIZE,
      checks,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const entry of cleanup.reverse()) {
      try {
        await entry.run();
      } catch (error) {
        cleanupErrors.push(new Error(`${entry.label} cleanup failed: ${errorText(error)}`, {cause: error}));
      }
    }
    try {
      await rm(scratch, {recursive: true, force: true});
    } catch (error) {
      cleanupErrors.push(new Error(`scratch cleanup failed: ${errorText(error)}`, {cause: error}));
    }
    throwRunAndCleanupFailures({label: 'zerobugs Lane 6b live', primaryError, cleanupErrors});
  }
  assert(receipt, 'successful Lane 6b run produced its receipt');
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

await main();
