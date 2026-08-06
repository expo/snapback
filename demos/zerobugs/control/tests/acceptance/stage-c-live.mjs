import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {readdir, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';

import {launchChromeCdp} from '../../../../_kit/chrome-process.mjs';
import {ownProcessTree, stopChild} from '../../../../_kit/server-process.mjs';

import {CONTROL_ROOT} from './gate-support.mjs';

const CDP_TIMEOUT_MS = 30_000;
const PROCESS_LOG_LIMIT = 64_000;

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

// Timers below only pace bounded polling. Every caller waits for an observed
// state transition; elapsed time by itself is never accepted as proof.
function pollDelay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

export async function freeLoopbackPort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object', 'loopback listener has an address');
      server.close(error => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

export function spawnOwned(command, args, {cwd = CONTROL_ROOT, env = process.env} = {}) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const append = chunk => {
    output = `${output}${String(chunk)}`.slice(-PROCESS_LOG_LIMIT);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const ownership = ownProcessTree(child, () => stopChild(child));
  return Object.freeze({
    child,
    pid: child.pid,
    output: () => output,
    stop: () => ownership.stop(),
  });
}

export async function waitHttp(url, ownedProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not ready';
  while (Date.now() < deadline) {
    if (ownedProcess.child.exitCode !== null || ownedProcess.child.signalCode !== null) {
      throw new Error(`process exited before ${url} became ready:\n${ownedProcess.output()}`);
    }
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(1_000)});
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = errorText(error);
    }
    await pollDelay(50);
  }
  throw new Error(`${url} did not become ready: ${last}\n${ownedProcess.output()}`);
}

export async function runOwnedCommand(command, args, {
  cwd = CONTROL_ROOT,
  env = process.env,
  timeoutMs = 120_000,
} = {}) {
  const owned = spawnOwned(command, args, {cwd, env});
  const timeout = setTimeout(() => void owned.stop(), timeoutMs);
  try {
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      owned.child.once('error', rejectExit);
      owned.child.once('exit', code => resolveExit(code ?? 1));
    });
    assert.equal(exitCode, 0, `${command} ${args.join(' ')} failed:\n${owned.output()}`);
    return Object.freeze({exitCode, output: owned.output()});
  } finally {
    clearTimeout(timeout);
    await owned.stop().catch(() => undefined);
  }
}

export async function startStageCGateway(gate, stack, {
  gateName,
  port,
  actor = 'ordinary-user',
  redirectOrigins = [],
  captureDir = join(stack.scratch, `${gateName}-captures`),
} = {}) {
  const resolvedPort = port ?? await freeLoopbackPort();
  const origin = `http://127.0.0.1:${resolvedPort}`;
  const readyFile = join(stack.scratch, `${gateName}-gateway.ready.json`);
  await rm(readyFile, {force: true});
  const owned = spawnOwned(process.execPath, ['composition/server.mts'], {
    cwd: CONTROL_ROOT,
    env: {
      ...process.env,
      SNAPBACK_READY_FILE: stack.readyFile,
      SNAPBACK_OUTBOUND_ACTIONS: '1',
      ZERBUGS_TEST_DEFAULTS: '1',
      ZERBUGS_GATEWAY_PORT: String(resolvedPort),
      ZERBUGS_GATEWAY_READY_FILE: readyFile,
      ZERBUGS_CAPTURE_DIR: captureDir,
      ZERBUGS_OAUTH_FIXTURE_ACTOR: actor,
      ZERBUGS_OAUTH_REDIRECT_ORIGINS: [origin, ...redirectOrigins].join(','),
    },
  });
  try {
    await waitHttp(`${origin}/health`, owned);
  } catch (error) {
    await owned.stop().catch(() => undefined);
    throw error;
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await owned.stop();
  };
  gate.registerCleanup({
    label: `${gateName} gateway`,
    targets: [
      {kind: 'process', id: String(owned.pid ?? 'owned-child')},
      {kind: 'file', path: readyFile},
      {kind: 'directory', path: captureDir},
    ],
    run: stop,
  });
  return Object.freeze({
    origin,
    port: resolvedPort,
    readyFile,
    captureDir,
    pid: owned.pid,
    output: owned.output,
    stop,
  });
}

export async function startStageCVite(gate, stack, gateway, gateName, {
  port,
} = {}) {
  const resolvedPort = port ?? await freeLoopbackPort();
  const origin = `http://127.0.0.1:${resolvedPort}`;
  const env = {
    ...process.env,
    SNAPBACK_OUTBOUND_ACTIONS: '1',
    ZERBUGS_TEST_DEFAULTS: '1',
    SNAPBACK_RELAY_ORIGIN: stack.serverUrl,
    ZERBUGS_GATEWAY_ORIGIN: gateway.origin,
  };
  const buildStarted = performance.now();
  await runOwnedCommand(process.execPath, ['run', 'build'], {env});
  const buildDurationMs = performance.now() - buildStarted;
  const owned = spawnOwned(join(CONTROL_ROOT, 'node_modules/.bin/vite'), [
    '--host', '127.0.0.1', '--port', String(resolvedPort), '--strictPort',
  ], {cwd: CONTROL_ROOT, env});
  try {
    await waitHttp(origin, owned, 60_000);
  } catch (error) {
    await owned.stop().catch(() => undefined);
    throw error;
  }
  gate.registerCleanup({
    label: `${gateName} Vite dev relay`,
    targets: [{kind: 'process', id: String(owned.pid ?? 'owned-child')}],
    run: () => owned.stop(),
  });
  return Object.freeze({origin, port: resolvedPort, buildDurationMs, output: owned.output});
}

export async function launchStageCChrome(gate, gateName, {env = process.env} = {}) {
  const chromeBin = process.env.CHROME_BIN
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix: `${gateName}-`,
    tempRoot: '/tmp',
    env,
    extraArgs: ['--disable-background-networking'],
  });
  gate.registerCleanup({
    label: `${gateName} Chrome process/profile`,
    targets: [
      {kind: 'process', id: String(chrome.pid ?? 'owned-child')},
      {kind: 'directory', path: chrome.profilePath},
    ],
    run: () => chrome.stop(),
  });
  return chrome;
}

export async function connectCdpPage(gate, browserWs, label) {
  const socket = new WebSocket(browserWs);
  const pending = new Map();
  const traceStart = Date.now();
  const networkEvents = [];
  let nextId = 1;
  let closed = false;
  let targetClosed = false;

  const trace = line => {
    if (!process.env.ZB6B_CDP_TRACE) return;
    process.stderr.write(`[cdp ${label} +${Date.now() - traceStart}ms] ${line}\n`);
  };
  socket.addEventListener('message', async event => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(payload);
    if (message.id) {
      trace(`<- reply id=${message.id}`);
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message ?? 'CDP command failed'));
      else entry.resolve(message.result ?? {});
      return;
    }
    const method = message.method ?? '';
    if (/^(Page\.frame(Navigated|StartedLoading|StoppedLoading)|Runtime\.executionContext|Target\.|Inspector\.)/u.test(method)) {
      trace(`event ${method}`);
    }
    if (method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(String(message.params?.request?.url ?? ''));
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
          networkEvents.push({
            direction: 'request',
            method: String(message.params?.request?.method ?? ''),
            path: url.pathname,
          });
        }
      } catch {
        // Non-URL devtools events are irrelevant to the loopback inventory.
      }
    }
    if (method === 'Network.responseReceived') {
      try {
        const url = new URL(String(message.params?.response?.url ?? ''));
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
          networkEvents.push({
            direction: 'response',
            status: Number(message.params?.response?.status ?? 0),
            path: url.pathname,
          });
        }
      } catch {
        // See request inventory above.
      }
    }
    // No trimming: gate checks slice this inventory by absolute index, and a
    // Vite dev document load alone produces hundreds of loopback module
    // requests. The array lives for one gate run; memory is bounded by that.
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, {once: true});
    socket.addEventListener('error', () => rejectOpen(new Error('CDP socket failed')), {once: true});
  });
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    trace(`-> id=${id} ${method}`);
    socket.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, CDP_TIMEOUT_MS);
      pending.set(id, {resolve: resolveCommand, reject: rejectCommand, timer});
    });
  };
  const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  await Promise.all([
    send('Page.enable', {}, sessionId),
    send('Runtime.enable', {}, sessionId),
    send('DOM.enable', {}, sessionId),
    send('Network.enable', {}, sessionId),
  ]);
  const evaluate = async expression => {
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
    return result.result?.value;
  };
  const closeTarget = async () => {
    if (targetClosed) return;
    targetClosed = true;
    await send('Target.closeTarget', {targetId}).catch(() => undefined);
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    await closeTarget();
    socket.close();
  };
  gate.registerCleanup({
    label: `${label} CDP target/socket`,
    targets: [{kind: 'browser-target', id: String(targetId)}],
    run: close,
  });
  return Object.freeze({
    targetId,
    eval: evaluate,
    navigate: target => send('Page.navigate', {url: target}, sessionId),
    async wait(expression, waitLabel, timeoutMs = CDP_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last) return last;
        await pollDelay(50);
      }
      throw new Error(`${waitLabel} timed out; last=${JSON.stringify(last)}; url=${await evaluate('location.href')}; body=${await evaluate('document.body.innerText.slice(0,400)')}`);
    },
    click(selector) {
      return evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('missing ${selector}');element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,detail:1}));element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,detail:1}));element.click();return true})()`);
    },
    clickText(text, scope = 'document') {
      return evaluate(`(() => {const root=${scope};const element=[...root.querySelectorAll('button,a,[role="option"]')].find(value=>value.textContent.trim()===${JSON.stringify(text)});if(!element)throw new Error('missing text ${text}');element.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,detail:1}));element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,detail:1}));element.click();return true})()`);
    },
    setValue(selector, value) {
      return evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('missing ${selector}');const setter=Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(element,${JSON.stringify(value)});element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(value)}}));element.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    },
    rows: () => evaluate(`[...document.querySelectorAll('[data-issue-id]')].map(row=>row.getAttribute('data-issue-id'))`),
    setCacheDisabled(disabled) {
      return send('Network.setCacheDisabled', {cacheDisabled: disabled}, sessionId);
    },
    emulateLatency(latency) {
      return send('Network.emulateNetworkConditions', {
        offline: false,
        latency,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: 'other',
      }, sessionId);
    },
    networkEvents: () => networkEvents.map(event => ({...event})),
    closeTarget,
    close,
  });
}

export async function browserStorageInventory(page) {
  return await page.eval(`(async()=>{
    const databases=typeof indexedDB.databases==='function'?await indexedDB.databases():[];
    const rows=[];
    for(const info of databases){
      if(!info.name)continue;
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(info.name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      const stores=[];
      for(const name of [...db.objectStoreNames]){
        const count=await new Promise((resolve,reject)=>{const request=db.transaction(name,'readonly').objectStore(name).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        stores.push({name,count});
      }
      rows.push({name:info.name,version:db.version,stores});
      db.close();
    }
    const estimate=navigator.storage?.estimate?await navigator.storage.estimate():{};
    const resources=performance.getEntriesByType('resource');
    return {
      databases:rows,
      databaseCount:rows.length,
      objectStoreCount:rows.reduce((sum,row)=>sum+row.stores.length,0),
      recordCount:rows.reduce((sum,row)=>sum+row.stores.reduce((inner,store)=>inner+store.count,0),0),
      localStorageEntries:localStorage.length,
      sessionStorageEntries:sessionStorage.length,
      readableCookieNames:document.cookie.split(';').map(value=>value.trim()).filter(Boolean).length,
      storageEstimate:{usage:Number(estimate.usage??0),quota:Number(estimate.quota??0)},
      resourceCount:resources.length,
      transferBytes:resources.reduce((sum,row)=>sum+Number(row.transferSize??0),0),
      decodedBodyBytes:resources.reduce((sum,row)=>sum+Number(row.decodedBodySize??0),0),
      visibleIssueRows:document.querySelectorAll('[data-issue-id]').length
    };
  })()`);
}

export async function bundleInventory(root = join(CONTROL_ROOT, 'dist')) {
  const files = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push({path, bytes: (await stat(path)).size});
    }
  };
  await visit(root);
  return Object.freeze({
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    javascriptBytes: files.filter(file => /\.js$/u.test(file.path)).reduce((sum, file) => sum + file.bytes, 0),
    cssBytes: files.filter(file => /\.css$/u.test(file.path)).reduce((sum, file) => sum + file.bytes, 0),
  });
}

function cookiePair(setCookie, name) {
  assert(setCookie, `${name} cookie exists`);
  const match = String(setCookie).match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`, 'u'));
  assert(match, `${name} cookie has the expected name`);
  return `${name}=${match[1]}`;
}

export async function establishGatewaySession(origin) {
  const start = await fetch(`${origin}/api/login/github?redirect=%2Frecovery`, {redirect: 'manual'});
  assert.equal(start.status, 302, 'local OAuth fixture starts');
  const stateCookie = cookiePair(start.headers.get('set-cookie'), 'zerobugs-oauth-state');
  const callback = await fetch(String(start.headers.get('location')), {
    redirect: 'manual',
    headers: {cookie: stateCookie},
  });
  assert.equal(callback.status, 302, 'local OAuth fixture callback settles');
  return cookiePair(callback.headers.get('set-cookie'), 'zerobugs-session');
}

export async function queryGatewayWithCookie(origin, cookie) {
  return await fetch(`${origin}/api/query`, {
    method: 'POST',
    headers: {'content-type': 'application/json', cookie},
    body: JSON.stringify({
      version: 'zerobugs.query.v1',
      name: 'allProjects',
      args: {limit: 10, start: null},
    }),
  });
}
