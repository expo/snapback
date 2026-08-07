// Manual real-Chrome diagnostic for profile-path-dependent IndexedDB failures.
// One Node process supervises every variant so shell policy and environment
// remain identical across the matrix.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../chrome-process.mjs';

const chromeBin = process.env.CHROME_BIN
  ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');

const INDEXEDDB_EXPRESSION = `new Promise((resolve) => {
  const databaseName = 'snapback-profile-probe-' + crypto.randomUUID();
  const finish = (value) => resolve({ databaseName, ...value });
  let request;
  try {
    request = indexedDB.open(databaseName, 1);
  } catch (error) {
    finish({ ok: false, phase: 'open-sync', errorName: error?.name, message: error?.message });
    return;
  }
  request.onupgradeneeded = () => request.result.createObjectStore('records');
  request.onerror = () => finish({
    ok: false,
    phase: 'open-async',
    errorName: request.error?.name,
    message: request.error?.message,
  });
  request.onsuccess = () => {
    const database = request.result;
    const write = database.transaction('records', 'readwrite');
    write.objectStore('records').put('snapback', 'probe');
    write.onerror = () => finish({
      ok: false,
      phase: 'write',
      errorName: write.error?.name,
      message: write.error?.message,
    });
    write.oncomplete = () => {
      const read = database.transaction('records').objectStore('records').get('probe');
      read.onerror = () => finish({
        ok: false,
        phase: 'read',
        errorName: read.error?.name,
        message: read.error?.message,
      });
      read.onsuccess = () => {
        const value = read.result;
        database.close();
        const deletion = indexedDB.deleteDatabase(databaseName);
        deletion.onerror = () => finish({
          ok: false,
          phase: 'delete',
          errorName: deletion.error?.name,
          message: deletion.error?.message,
        });
        deletion.onsuccess = () => finish({
          ok: value === 'snapback',
          phase: 'complete',
          value,
        });
      };
    };
  };
})`;

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    return `<unavailable: ${error.message}>`;
  }
}

function pathFacts(path) {
  const stat = statSync(path);
  const link = lstatSync(path);
  return {
    path,
    realpath: realpathSync(path),
    spellingLength: path.length,
    realpathLength: realpathSync(path).length,
    mode: (stat.mode & 0o7777).toString(8).padStart(4, '0'),
    uid: stat.uid,
    gid: stat.gid,
    device: stat.dev,
    isSymlink: link.isSymbolicLink(),
    darwinStat: process.platform === 'darwin'
      ? commandOutput('/usr/bin/stat', [
        '-f', 'fs=%T device=%d mode=%Sp uid=%u gid=%g flags=%Sf mount=%m', path,
      ])
      : null,
    xattrs: process.platform === 'darwin'
      ? commandOutput('/usr/bin/xattr', ['-l', path]) || '<none>'
      : null,
  };
}

async function startOrigin() {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Snapback IndexedDB profile probe</title>');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (message) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(message));
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (!message.id || !pending.has(message.id)) return;
    const entry = settle(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
    });
  };
  return {
    close: () => socket.close(),
    async probe(origin) {
      const { targetId } = await send('Target.createTarget', { url: origin });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await Promise.all([
        send('Page.enable', {}, sessionId),
        send('Runtime.enable', {}, sessionId),
      ]);
      try {
        const ready = await send('Runtime.evaluate', {
          expression: `new Promise(resolve => {
            if (document.readyState === 'complete') resolve(true);
            else addEventListener('load', () => resolve(true), { once: true });
          })`,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId);
        if (ready.exceptionDetails) throw new Error(ready.exceptionDetails.text);
        const result = await send('Runtime.evaluate', {
          expression: INDEXEDDB_EXPRESSION,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId);
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
      } finally {
        await send('Target.closeTarget', { targetId });
      }
    },
  };
}

async function runVariant(variant, origin) {
  let chrome = null;
  let cdp = null;
  try {
    chrome = await launchChromeCdp({
      chromeBin,
      tempRoot: variant.tempRoot,
      userDataPrefix: variant.prefix,
      initialUrl: origin,
      extraArgs: ['--disable-background-networking'],
    });
    const profile = pathFacts(chrome.profilePath);
    cdp = await connectCdp(chrome.ws);
    const indexedDB = await cdp.probe(origin);
    return {
      name: variant.name,
      purpose: variant.purpose,
      tempRoot: pathFacts(variant.tempRoot),
      profile,
      chromeVersion: chrome.version?.Browser ?? null,
      indexedDB,
      passed: indexedDB?.ok === true,
    };
  } catch (error) {
    return {
      name: variant.name,
      purpose: variant.purpose,
      tempRoot: pathFacts(variant.tempRoot),
      profile: chrome?.profilePath ? pathFacts(chrome.profilePath) : null,
      chromeVersion: chrome?.version?.Browser ?? null,
      indexedDB: null,
      passed: false,
      harnessError: { name: error.name, message: error.message, code: error.code ?? null },
    };
  } finally {
    cdp?.close();
    if (chrome) await chrome.stop();
  }
}

async function main() {
  const osTemp = tmpdir().replace(/\/$/, '');
  const canonicalOsTemp = realpathSync(osTemp);
  const scratch = mkdtempSync('/tmp/snapback-idb-probe-roots-');
  chmodSync(scratch, 0o700);
  const longRoot = join(scratch, 'x'.repeat(120));
  mkdirSync(longRoot, { mode: 0o700 });
  const shortAlias = join('/tmp', `sb-idb-var-${process.pid}`);
  symlinkSync(canonicalOsTemp, shortAlias);
  const variants = [
    {
      name: 'kit-default-spelling',
      purpose: 'kit default os.tmpdir() spelling',
      tempRoot: osTemp,
      prefix: 'snapback-chrome-',
    },
    {
      name: 'kit-default-realpath',
      purpose: 'canonical spelling of the same macOS temp directory',
      tempRoot: canonicalOsTemp,
      prefix: 'snapback-chrome-',
    },
    {
      name: 'literal-tmp',
      purpose: 'literal short /tmp control',
      tempRoot: '/tmp',
      prefix: 'snapback-chrome-',
    },
    {
      name: 'private-tmp-realpath',
      purpose: 'canonical spelling of /tmp to test symlink spelling',
      tempRoot: realpathSync('/tmp'),
      prefix: 'snapback-chrome-',
    },
    {
      name: 'long-private-tmp',
      purpose: 'path-length and mode-0700 parent control under /private/tmp',
      tempRoot: longRoot,
      prefix: 'snapback-chrome-',
    },
    {
      name: 'short-name-var-folders',
      purpose: 'shortest practical generated profile name in the macOS per-user temp subtree',
      tempRoot: osTemp,
      prefix: 'z-',
    },
    {
      name: 'short-alias-to-var-folders',
      purpose: 'short /tmp symlink spelling backed by the macOS per-user temp subtree',
      tempRoot: shortAlias,
      prefix: 'z-',
    },
  ];
  const origin = await startOrigin();
  const results = [];
  try {
    for (const variant of variants) {
      const result = await runVariant(variant, origin.origin);
      results.push(result);
      console.error(`${result.passed ? 'PASS' : 'FAIL'} ${variant.name}: ${result.profile?.path ?? '<no profile>'}`);
    }
  } finally {
    await origin.close();
    unlinkSync(shortAlias);
    rmSync(scratch, { recursive: true, force: true });
  }
  const report = {
    schemaVersion: 'snapback.chrome-indexeddb-profile-probe.v1',
    supervisingPid: process.pid,
    probePath: fileURLToPath(import.meta.url),
    cwd: process.cwd(),
    node: process.version,
    chromeBin,
    chromeCliVersion: commandOutput(chromeBin, ['--version']),
    macOS: process.platform === 'darwin'
      ? commandOutput('/usr/bin/sw_vers', [])
      : null,
    origin: origin.origin,
    osTmpdir: osTemp,
    osTmpdirRealpath: canonicalOsTemp,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every((result) => result.passed) ? 0 : 2;
}

await main();
