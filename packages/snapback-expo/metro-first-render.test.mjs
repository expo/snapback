import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const fixtureRoot = join(packageRoot, 'fixtures', 'metro-first-render');
const installer = join(repoRoot, 'scripts', 'install-local-snapback-packages.mjs');
const temporary = mkdtempSync(join(tmpdir(), 'snapback-expo-packed-metro-'));
const externalApp = join(temporary, 'app');
const nodePath = `${dirname(process.execPath)}:${process.env.PATH ?? ''}`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    env: { ...process.env, PATH: nodePath, ...(options.env ?? {}) },
  });
}
function chromeLaunch() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(executable, 'packed Metro first-render proof requires a Chrome-family browser');
  return { chromeBin: executable, launchPrefixArgs: [] };
}

function mimeType(path) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  })[extname(path)] ?? 'application/octet-stream';
}

async function serve(directory) {
  const root = realpathSync(directory);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = normalize(join(root, relative));
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('refused');
      return;
    }
    const path = existsSync(candidate) && statSync(candidate).isDirectory()
      ? join(candidate, 'index.html')
      : candidate;
    if (!existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': mimeType(path),
      'cache-control': 'no-store',
    });
    response.end(readFileSync(path));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    }),
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const exceptions = [];
  let nextId = 1;
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params?.exceptionDetails?.exception?.description
        ?? message.params?.exceptionDetails?.text
        ?? 'unknown browser exception');
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectResult(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    });
  };
  return { socket, send, exceptions };
}

async function firstRender(browser, origin) {
  const cdp = await connectCdp(browser.ws);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: origin }, sessionId);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'document.querySelector(\'[data-testid="snapback-expo-first-render"]\')?.textContent ?? null',
        returnByValue: true,
      }, sessionId);
      const text = result.result?.value;
      if (typeof text === 'string') return text;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    const body = await cdp.send('Runtime.evaluate', {
      expression: 'document.body?.innerText ?? ""',
      returnByValue: true,
    }, sessionId);
    assert.fail(
      `Metro bundle did not reach the Expo first render; exceptions=${JSON.stringify(cdp.exceptions)} body=${JSON.stringify(body.result?.value)}`,
    );
  } finally {
    cdp.socket.close();
  }
}

let staticServer = null;
let browser = null;
try {
  cpSync(fixtureRoot, externalApp, { recursive: true });
  const installOutput = run(process.execPath, [installer, externalApp], {
    cwd: repoRoot,
    timeout: 600_000,
  });
  const receipt = JSON.parse(installOutput.trim().split('\n').at(-1));
  assert.equal(receipt.ok, true);
  for (const name of [
    '@expo/snapback-client',
    '@expo/snapback-expo',
    '@expo/snapback-react',
  ]) {
    const installed = join(externalApp, 'node_modules', ...name.split('/'));
    assert.ok(existsSync(installed), `${name} is installed in the clean external app`);
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} is materialized from a tarball`);
    assert.ok(
      !realpathSync(installed).startsWith(join(repoRoot, 'packages')),
      `${name} does not resolve into the source workspace`,
    );
  }

  const outputDirectory = join(externalApp, 'dist');
  run(join(externalApp, 'node_modules', '.bin', 'expo'), [
    'export',
    '--platform', 'web',
    '--output-dir', outputDirectory,
    '--clear',
  ], {
    cwd: externalApp,
    timeout: 300_000,
    env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
  });
  assert.ok(existsSync(join(outputDirectory, 'index.html')), 'Metro produced the Expo web export');

  staticServer = await serve(outputDirectory);
  const launch = chromeLaunch();
  browser = await launchChromeCdp({
    ...launch,
    headless: true,
    startupTimeoutMs: 60_000,
    extraArgs: ['--remote-allow-origins=*', '--disable-background-networking'],
  });
  const rendered = await firstRender(browser, staticServer.origin);
  assert.match(rendered, /^Snapback Expo first render:/u);
  console.log('metro-first-render.test.mjs: packed external Expo entrypoint bundles and reaches first render');
} finally {
  await browser?.stop();
  await staticServer?.close();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
