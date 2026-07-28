#!/usr/bin/env node

// @ref LLP 0041#acceptance — prove the published package closure from a fresh
// external project: tarball install, offline codegen, packaged CLI discovery,
// remote publication, and a browser-only adapter bundle.
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// repository-local imports and sibling source checkouts are forbidden here.

import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { release as osRelease, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundedSerializeBrowserValue,
  browserAssetsContainSecretCanary,
  createBoundedAsyncTaskPool,
  createBoundedByteAccumulator,
  createBoundedBrowserSurfaceCollector,
  digestBoundedBrowserFilesystem,
  measureGitCheckoutIdentity,
  parseArguments,
  PUBLIC_NPM_REGISTRY,
  resolveInstalledBrowserDistribution,
  runAsync,
  usage,
  validateColdInstallBrowserEvidence,
  validateLatestRootResolution,
  validatePublicPublicationLedger,
  validateStagedPublicationLedger,
} from './snapback-package-cold-install-lib.mjs';
import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_PACKAGE_VERSION = '1.62.0';
const BROWSER_MAX_SURFACE_BYTES = 16 * 1024 * 1024;
const BROWSER_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const BROWSER_MAX_SURFACES = 20_000;
const BROWSER_MAX_ASYNC_TASKS = 10_000;
const BROWSER_MAX_CONCURRENCY = 8;
const BROWSER_MAX_STORAGE_ENTRIES = 10_000;
const BROWSER_MAX_VALUE_DEPTH = 10;
const BROWSER_MAX_VALUE_NODES = 20_000;
const BROWSER_MAX_VALUE_PROPERTIES = 20_000;
const BROWSER_MAX_FILES = 50_000;
const BROWSER_MAX_FILE_BYTES = 512 * 1024 * 1024;
const BROWSER_MAX_FILES_TOTAL_BYTES = 1024 * 1024 * 1024;

function fail(message) {
  console.error(`snapback-package-cold-install: ${message}`);
  process.exit(1);
}

let parsedArgs;
try {
  parsedArgs = parseArguments(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}
if (parsedArgs.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const ledgerPath = resolve(parsedArgs.ledger ?? join(root, 'dist-publish', 'publish-ledger.json'));
const installSource = parsedArgs.installSource;
const registry = parsedArgs.registry;
const receiptPath = parsedArgs.receipt;
const keep = parsedArgs.keep;
const rootSelector = parsedArgs.rootSelector;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function runAsyncOrFail(command, commandArgs, options = {}) {
  try {
    return await runAsync(command, commandArgs, options);
  } catch (error) {
    fail(error.message);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function digest(path, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding);
}

async function startStagedRegistry(ledgerDirectory, ledger) {
  const records = new Map();
  for (const entry of ledger.packages ?? []) {
    const tarballPath = join(ledgerDirectory, entry.tarball);
    const manifest = JSON.parse(run('tar', ['-xzOf', tarballPath, 'package/package.json']));
    records.set(entry.name, {
      entry,
      manifest,
      tarballPath,
      shasum: digest(tarballPath, 'sha1', 'hex'),
      integrity: `sha512-${digest(tarballPath, 'sha512', 'base64')}`,
    });
  }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/tarballs/')) {
      const filename = decodeURIComponent(pathname.slice('/tarballs/'.length));
      const record = [...records.values()].find((candidate) => candidate.entry.tarball === filename);
      if (!record) {
        response.writeHead(404).end('missing tarball');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(readFileSync(record.tarballPath));
      return;
    }
    const name = decodeURIComponent(pathname.slice(1));
    const record = records.get(name);
    if (!record) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found', reason: `staged package ${name} is absent` }));
      return;
    }
    const address = server.address();
    const tarball = `http://127.0.0.1:${address.port}/tarballs/${encodeURIComponent(record.entry.tarball)}`;
    const versionManifest = {
      ...record.manifest,
      dist: { tarball, shasum: record.shasum, integrity: record.integrity },
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      _id: name,
      name,
      'dist-tags': { [ledger.tag ?? 'latest']: record.entry.version, latest: record.entry.version },
      versions: { [record.entry.version]: versionManifest },
    }));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function provePackagedDevLoop({ cli, scaffoldRoot }) {
  const readyFile = join(scaffoldRoot, '.snapback', 'dev.ready.json');
  const database = join(scaffoldRoot, '.snapback', 'dev.sqlite3');
  const functionsPath = join(scaffoldRoot, 'snapback', 'functions.mjs');
  const child = spawn(cli, ['dev', 'snapback'], {
    cwd: scaffoldRoot,
    env: process.env,
    // Watch mode owns a machine-readable stdin control channel. Keep it open
    // for the proof lifetime: EOF is intentionally interpreted as "stop".
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const events = () => stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  const waitFor = async (predicate, label, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = events().find(predicate);
      if (match) return match;
      if (child.exitCode !== null) {
        fail(`${label}: dev process exited ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    fail(`${label}: timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  };
  try {
    await waitFor((event) => event.state === 'generated-and-loaded' && event.managed === true, 'initial managed dev load');
    if (!existsSync(readyFile)) fail('managed dev did not publish its ready-file descriptor');
    const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
    const health = await fetch(`${descriptor.serverUrl}/health`).then((response) => response.json());
    if (health?.ok !== true || health?.binary?.startupNonce !== descriptor.startupNonce) {
      fail(`managed dev ready-file did not identify the live server: ${JSON.stringify(health)}`);
    }

    const mismatch = spawnSync(cli, [
      'dev', 'snapback', '--attach', '--no-watch',
      '--ready-file', readyFile,
      '--db', join(scaffoldRoot, '.snapback', 'different.sqlite3'),
    ], { cwd: scaffoldRoot, encoding: 'utf8', timeout: 30_000 });
    if (mismatch.status === 0 || !`${mismatch.stdout}\n${mismatch.stderr}`.includes('SNAPBACK_DEV_SERVER_TARGET_MISMATCH')) {
      fail(`mismatched attach did not fail closed: ${mismatch.stdout}\n${mismatch.stderr}`
        + `\nmanaged exit=${child.exitCode} readyFile=${existsSync(readyFile)}`
        + `\nmanaged stdout:\n${stdout}\nmanaged stderr:\n${stderr}`);
    }

    writeFileSync(functionsPath, `${readFileSync(functionsPath, 'utf8')}\n// packaged watch proof\n`);
    await waitFor(
      (event) => event.state === 'generated-and-loaded' && event.changed === 'functions.mjs',
      'watched regeneration and server load',
    );
  } finally {
    if (child.exitCode === null) child.kill('SIGINT');
    const deadline = Date.now() + 15_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (existsSync(readyFile)) fail('managed dev stop left a stale ready-file descriptor');
  return { readyFile, database };
}

async function inspectBrowserStorage(page) {
  return page.evaluate(async ({
    maxDepth,
    maxNodes,
    maxProperties,
    maxSurfaces,
    maxSurfaceBytes,
    maxTotalBytes,
    maxEntries,
  }) => {
    const encoder = new TextEncoder();
    const surfaces = [];
    let totalBytes = 0;
    let storageEntries = 0;
    const assertSurfaceSlot = () => {
      if (surfaces.length >= maxSurfaces) {
        throw new Error('browser storage surface count exceeded its scan bound');
      }
    };
    const admitBytes = (byteLength) => {
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxSurfaceBytes) {
        throw new Error('browser storage surface exceeded its scan bound');
      }
      totalBytes += byteLength;
      if (totalBytes > maxTotalBytes) {
        throw new Error('browser storage surfaces exceeded their aggregate scan bound');
      }
    };
    const encodeBase64 = (bytes) => {
      let binary = '';
      for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    };
    const addText = (kind, text) => {
      assertSurfaceSlot();
      const byteLength = encoder.encode(text).byteLength;
      admitBytes(byteLength);
      surfaces.push({ kind, text });
    };
    const addBinary = (kind, bytes) => {
      assertSurfaceSlot();
      admitBytes(bytes.byteLength);
      surfaces.push({ kind, base64: encodeBase64(bytes) });
    };
    const countEntry = () => {
      storageEntries += 1;
      if (storageEntries > maxEntries) {
        throw new Error('browser storage entry count exceeded its scan bound');
      }
    };
    const normalizeReadableValue = async (value, state, depth = 0) => {
      state.nodes += 1;
      if (state.nodes > maxNodes) {
        throw new Error('browser storage value exceeded its node bound');
      }
      if (depth > maxDepth) {
        throw new Error('browser storage value exceeded its depth bound');
      }
      const chargeProperty = () => {
        state.properties += 1;
        if (state.properties > maxProperties) {
          throw new Error('browser storage value exceeded its property bound');
        }
      };
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (typeof value === 'undefined') return { $type: 'undefined' };
      if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
      if (typeof value === 'symbol') return { $type: 'symbol', value: value.description ?? '' };
      if (value instanceof Date) return { $type: 'date', value: value.toISOString() };
      if (value instanceof RegExp) return { $type: 'regexp', source: value.source, flags: value.flags };
      if (value instanceof URL) return { $type: 'url', value: value.href };
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if (bytes.byteLength > maxSurfaceBytes) {
          throw new Error('IndexedDB binary value exceeded its scan bound');
        }
        state.binaryBytes += bytes.byteLength;
        if (state.binaryBytes > maxSurfaceBytes) {
          throw new Error('IndexedDB record binary values exceeded their scan bound');
        }
        state.binaryParts.push(bytes);
        return {
          $type: value.constructor?.name ?? 'bytes',
          byteLength: bytes.byteLength,
          part: state.binaryParts.length - 1,
        };
      }
      if (value instanceof Blob) {
        if (value.size > maxSurfaceBytes) {
          throw new Error('IndexedDB Blob exceeded its scan bound');
        }
        const bytes = new Uint8Array(await value.arrayBuffer());
        state.binaryBytes += bytes.byteLength;
        if (state.binaryBytes > maxSurfaceBytes) {
          throw new Error('IndexedDB record Blob values exceeded their scan bound');
        }
        state.binaryParts.push(bytes);
        return {
          $type: 'blob',
          byteLength: bytes.byteLength,
          contentType: value.type,
          part: state.binaryParts.length - 1,
        };
      }
      if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) {
        const metadata = {
          $type: 'crypto-key',
          algorithm: value.algorithm,
          extractable: value.extractable,
          type: value.type,
          usages: value.usages,
        };
        if (value.extractable) {
          try {
            metadata.exportedJwk = await crypto.subtle.exportKey('jwk', value);
          } catch {
            metadata.exportRefused = true;
          }
        }
        return metadata;
      }
      if (typeof value !== 'object') return { $type: typeof value, value: String(value) };
      if (state.seen.has(value)) return { $ref: state.seen.get(value) };
      const identity = state.seen.size;
      state.seen.set(value, identity);
      if (Array.isArray(value)) {
        if (value.length > maxProperties - state.properties) {
          throw new Error('browser storage array exceeded its property bound');
        }
        return {
          $id: identity,
          $type: 'array',
          values: await Promise.all(value.map((entry) => {
            chargeProperty();
            return normalizeReadableValue(entry, state, depth + 1);
          })),
        };
      }
      if (value instanceof Map) {
        const entries = [];
        for (const [key, entry] of value.entries()) {
          chargeProperty();
          entries.push([
            await normalizeReadableValue(key, state, depth + 1),
            await normalizeReadableValue(entry, state, depth + 1),
          ]);
        }
        return { $id: identity, $type: 'map', entries };
      }
      if (value instanceof Set) {
        const values = [];
        for (const entry of value.values()) {
          chargeProperty();
          values.push(await normalizeReadableValue(entry, state, depth + 1));
        }
        return { $id: identity, $type: 'set', values };
      }
      const properties = {};
      for (const key of Reflect.ownKeys(value)) {
        chargeProperty();
        const renderedKey = typeof key === 'symbol' ? `symbol:${key.description ?? ''}` : key;
        try {
          properties[renderedKey] = await normalizeReadableValue(
            Reflect.get(value, key),
            state,
            depth + 1,
          );
        } catch (error) {
          if (error?.message?.includes('bound')) throw error;
          properties[renderedKey] = { $type: 'unreadable', reason: error?.name ?? 'error' };
        }
      }
      return {
        $id: identity,
        $type: value.constructor?.name ?? 'object',
        properties,
      };
    };
    const renderRecord = async (record) => {
      const state = {
        binaryBytes: 0,
        binaryParts: [],
        nodes: 0,
        properties: 0,
        seen: new Map(),
      };
      const normalized = await normalizeReadableValue(record, state);
      const text = JSON.stringify(normalized);
      const textBytes = encoder.encode(text);
      const byteLength = textBytes.byteLength + state.binaryBytes + state.binaryParts.length;
      if (byteLength > maxSurfaceBytes) {
        throw new Error('IndexedDB record exceeded its combined scan bound');
      }
      const combined = new Uint8Array(byteLength);
      combined.set(textBytes, 0);
      let offset = textBytes.byteLength;
      for (const bytes of state.binaryParts) {
        combined[offset] = 0;
        offset += 1;
        combined.set(bytes, offset);
        offset += bytes.byteLength;
      }
      return combined;
    };
    const estimateKeyBytes = (value, depth = 0) => {
      if (depth > maxDepth) throw new Error('IndexedDB key exceeded its depth bound');
      if (typeof value === 'string') return encoder.encode(value).byteLength;
      if (typeof value === 'number' || value instanceof Date) return 16;
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
      if (Array.isArray(value)) {
        if (value.length > maxProperties) {
          throw new Error('IndexedDB key exceeded its property bound');
        }
        return value.reduce((sum, entry) => sum + estimateKeyBytes(entry, depth + 1), 0);
      }
      throw new Error('IndexedDB returned an unsupported key type');
    };
    const readStream = async (stream, label) => {
      if (stream === null) return new Uint8Array(0);
      const reader = stream.getReader();
      const chunks = [];
      let byteLength = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) {
            throw new Error(`${label} yielded a non-binary chunk`);
          }
          byteLength += value.byteLength;
          if (byteLength > maxSurfaceBytes) {
            await reader.cancel('browser evidence byte bound exceeded');
            throw new Error(`${label} exceeded its scan bound`);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const output = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    };

    let cacheEntriesObserved = 0;
    if ('caches' in globalThis) {
      const cacheNames = await caches.keys();
      if (cacheNames.length > maxEntries - storageEntries) {
        throw new Error('Cache Storage cache count exceeded its scan bound');
      }
      addText('cache-metadata', JSON.stringify({ cacheNames }));
      for (const cacheName of cacheNames) {
        countEntry();
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        if (requests.length > maxEntries - storageEntries) {
          throw new Error('Cache Storage request count exceeded its scan bound');
        }
        for (const request of requests) {
          countEntry();
          cacheEntriesObserved += 1;
          const response = await cache.match(request);
          if (!response) throw new Error('Cache Storage entry disappeared during inspection');
          addText('cache-metadata', JSON.stringify({
            cacheName,
            request: {
              url: request.url,
              method: request.method,
              headers: [...request.headers.entries()],
            },
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: [...response.headers.entries()],
            },
          }));
          const declaredLength = response.headers.get('content-length');
          if (
            declaredLength !== null
            && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxSurfaceBytes)
          ) {
            throw new Error('Cache Storage body declared an out-of-bounds length');
          }
          addBinary('cache-body', await readStream(response.clone().body, 'Cache Storage body'));
        }
      }
    } else {
      addText('cache-metadata', JSON.stringify({ unavailable: true }));
    }

    let indexedDbRecordsObserved = 0;
    if ('indexedDB' in globalThis && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      if (databases.length > maxEntries - storageEntries) {
        throw new Error('IndexedDB database count exceeded its scan bound');
      }
      addText('indexeddb-metadata', JSON.stringify({ databases }));
      for (const descriptor of databases) {
        if (typeof descriptor.name !== 'string') continue;
        countEntry();
        const database = await new Promise((resolveOpen, rejectOpen) => {
          const request = indexedDB.open(descriptor.name);
          request.onerror = () => rejectOpen(request.error ?? new Error('IndexedDB open failed'));
          request.onsuccess = () => resolveOpen(request.result);
          request.onupgradeneeded = () => {
            request.transaction?.abort();
            rejectOpen(new Error('IndexedDB changed during inspection'));
          };
        });
        try {
          if (database.objectStoreNames.length > maxEntries - storageEntries) {
            throw new Error('IndexedDB object-store count exceeded its scan bound');
          }
          for (const storeName of database.objectStoreNames) {
            countEntry();
            const { keys, metadata } = await new Promise((resolveRecords, rejectRecords) => {
              const outputKeys = [];
              let keyBytes = 0;
              const transaction = database.transaction(storeName, 'readonly');
              const store = transaction.objectStore(storeName);
              const storeMetadata = {
                autoIncrement: store.autoIncrement,
                indexNames: [...store.indexNames],
                indexes: [...store.indexNames].map((indexName) => {
                  const index = store.index(indexName);
                  return {
                    name: index.name,
                    keyPath: index.keyPath,
                    multiEntry: index.multiEntry,
                    unique: index.unique,
                  };
                }),
                keyPath: store.keyPath,
              };
              const cursorRequest = store.openKeyCursor();
              cursorRequest.onerror = () => rejectRecords(
                cursorRequest.error ?? new Error('IndexedDB cursor failed'),
              );
              cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) return;
                try {
                  countEntry();
                } catch (error) {
                  rejectRecords(error);
                  transaction.abort();
                  return;
                }
                try {
                  keyBytes += estimateKeyBytes(cursor.primaryKey);
                  if (keyBytes > maxTotalBytes - totalBytes) {
                    throw new Error('IndexedDB keys exceeded the remaining scan bound');
                  }
                } catch (error) {
                  rejectRecords(error);
                  transaction.abort();
                  return;
                }
                outputKeys.push({ key: cursor.key, primaryKey: cursor.primaryKey });
                cursor.continue();
              };
              transaction.oncomplete = () => resolveRecords({
                keys: outputKeys,
                metadata: storeMetadata,
              });
              transaction.onerror = () => rejectRecords(
                transaction.error ?? new Error('IndexedDB transaction failed'),
              );
              transaction.onabort = () => rejectRecords(
                transaction.error ?? new Error('IndexedDB transaction aborted'),
              );
            });
            addText('indexeddb-metadata', JSON.stringify({
              database: descriptor.name,
              version: database.version,
              storeName,
              ...metadata,
              recordCount: keys.length,
            }));
            for (const key of keys) {
              const value = await new Promise((resolveValue, rejectValue) => {
                const transaction = database.transaction(storeName, 'readonly');
                const request = transaction.objectStore(storeName).get(key.primaryKey);
                request.onerror = () => rejectValue(
                  request.error ?? new Error('IndexedDB get failed'),
                );
                request.onsuccess = () => resolveValue(request.result);
                transaction.onabort = () => rejectValue(
                  transaction.error ?? new Error('IndexedDB get aborted'),
                );
              });
              indexedDbRecordsObserved += 1;
              addBinary('indexeddb-record', await renderRecord({
                key: key.key,
                primaryKey: key.primaryKey,
                value,
              }));
            }
          }
        } finally {
          database.close();
        }
      }
    } else {
      addText('indexeddb-metadata', JSON.stringify({ unavailable: true }));
    }
    return {
      surfaces,
      coverage: {
        cacheEntriesObserved,
        indexedDbRecordsObserved,
      },
    };
  }, {
    maxDepth: BROWSER_MAX_VALUE_DEPTH,
    maxNodes: BROWSER_MAX_VALUE_NODES,
    maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
    maxSurfaces: BROWSER_MAX_SURFACES,
    maxSurfaceBytes: BROWSER_MAX_SURFACE_BYTES,
    maxTotalBytes: BROWSER_MAX_TOTAL_BYTES,
    maxEntries: BROWSER_MAX_STORAGE_ENTRIES,
  });
}

async function inspectWorker(worker) {
  const handle = await worker.evaluateHandle(() => {
    const snapshot = {
      location: globalThis.location?.href ?? null,
      globals: {},
    };
    for (const key of Reflect.ownKeys(globalThis)) {
      const renderedKey = typeof key === 'symbol' ? `symbol:${key.description ?? ''}` : key;
      try {
        const value = Reflect.get(globalThis, key);
        const prototype = (
          value !== null && (typeof value === 'object' || typeof value === 'function')
        ) ? Object.getPrototypeOf(value) : null;
        const dataLike = (
          value === null
          || !['object', 'function'].includes(typeof value)
          || Array.isArray(value)
          || value instanceof Map
          || value instanceof Set
          || value instanceof ArrayBuffer
          || ArrayBuffer.isView(value)
          || value instanceof Blob
          || value instanceof Date
          || value instanceof RegExp
          || value instanceof URL
          || prototype === Object.prototype
          || prototype === null
        );
        snapshot.globals[renderedKey] = dataLike
          ? value
          : { $hostType: value.constructor?.name ?? typeof value };
      } catch (error) {
        snapshot.globals[renderedKey] = {
          $unreadable: error?.name ?? 'error',
          message: error?.message ?? '',
        };
      }
    }
    return snapshot;
  });
  try {
    return await handle.evaluate(boundedSerializeBrowserValue, {
      maxBytes: BROWSER_MAX_SURFACE_BYTES,
      maxDepth: BROWSER_MAX_VALUE_DEPTH,
      maxNodes: BROWSER_MAX_VALUE_NODES,
      maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
    });
  } finally {
    await handle.dispose();
  }
}

async function proveOneCommandReactStarter(scaffoldRoot, sourceIdentity) {
  const playwrightBrowsersPath = '0';
  const playwrightCli = join(scaffoldRoot, 'node_modules', 'playwright', 'cli.js');
  const browserInstallArgs = [
    playwrightCli,
    'install',
    ...(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
      ? ['--with-deps']
      : []),
    '--only-shell',
    'chromium',
  ];
  await runAsyncOrFail(process.execPath, browserInstallArgs, {
    cwd: scaffoldRoot,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath },
    timeout: 600_000,
  });
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
  const requireFromScaffold = createRequire(join(scaffoldRoot, 'package.json'));
  const { chromium } = requireFromScaffold('playwright');
  const playwrightManifest = requireFromScaffold('playwright/package.json');
  if (playwrightManifest.version !== BROWSER_PACKAGE_VERSION) {
    fail(`real-browser proof resolved Playwright ${playwrightManifest.version}, expected ${BROWSER_PACKAGE_VERSION}`);
  }
  const localBrowserRoot = join(
    scaffoldRoot,
    'node_modules',
    'playwright-core',
    '.local-browsers',
  );
  if (
    !existsSync(localBrowserRoot)
    || !readdirSync(localBrowserRoot).some((name) => name.startsWith('chromium_headless_shell-'))
  ) {
    fail('real-browser proof did not materialize its headless browser inside the fresh package install');
  }
  const installedBrowser = resolveInstalledBrowserDistribution(localBrowserRoot);
  const browserExecutablePath = installedBrowser?.executablePath ?? null;
  if (
    browserExecutablePath === null
    || !existsSync(browserExecutablePath)
    || !lstatSync(browserExecutablePath).isFile()
  ) {
    fail('real-browser proof could not resolve its installed browser executable');
  }
  let browserSupportIdentity;
  let browserDistributionIdentity;
  const measureBrowserFilesystemIdentity = async () => ({
    support: await digestBoundedBrowserFilesystem({
      domain: 'snapback-browser-support-files-v1',
      roots: [
        ['playwright', dirname(requireFromScaffold.resolve('playwright/package.json'))],
        ['playwright-core', dirname(requireFromScaffold.resolve('playwright-core/package.json'))],
      ],
      exclude: (logicalRoot, relativePath) => (
        logicalRoot === 'playwright-core'
        && (relativePath === '.local-browsers' || relativePath.startsWith('.local-browsers/'))
      ),
      maxEntries: BROWSER_MAX_FILES,
      maxTotalBytes: BROWSER_MAX_FILES_TOTAL_BYTES,
      maxFileBytes: BROWSER_MAX_FILE_BYTES,
    }),
    distribution: await digestBoundedBrowserFilesystem({
      domain: 'snapback-browser-distribution-v1',
      roots: [['chromium-headless-shell', installedBrowser.distributionRoot]],
      executablePath: browserExecutablePath,
      maxEntries: BROWSER_MAX_FILES,
      maxTotalBytes: BROWSER_MAX_FILES_TOTAL_BYTES,
      maxFileBytes: BROWSER_MAX_FILE_BYTES,
    }),
  });
  try {
    const measured = await measureBrowserFilesystemIdentity();
    browserSupportIdentity = measured.support;
    browserDistributionIdentity = measured.distribution;
  } catch (error) {
    fail(`real-browser filesystem identity refused: ${error.message}`);
  }

  const browserSecretCanary = `snapback-cold-canary-${randomBytes(24).toString('hex')}`;
  const child = spawn('npm', ['run', 'dev'], {
    cwd: scaffoldRoot,
    env: {
      ...process.env,
      // Vite would inline this exact value if the browser graph accidentally
      // consumed its admin-token-shaped environment. It is not the runtime's
      // actual admin credential.
      VITE_SNAPBACK_ADMIN_TOKEN: browserSecretCanary,
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const output = () => `${stdout}\n${stderr}`.replaceAll(/\u001b\[[0-9;]*m/gu, '');
  const waitFor = async (predicate, label, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate(output());
      if (value) return value;
      if (child.exitCode !== null) {
        fail(`${label}: one-command starter exited ${child.exitCode}\n${output()}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    fail(`${label}: timed out\n${output()}`);
  };
  try {
    await waitFor(
      (text) => text.includes('"state":"client-started"'),
      'one-command starter client arm',
    );
    const origin = await waitFor((text) => {
      const match = /http:\/\/localhost:\d+\//u.exec(text);
      return match?.[0] ?? null;
    }, 'one-command starter Vite origin');
    const htmlResponse = await fetch(origin);
    const html = await htmlResponse.text();
    if (!htmlResponse.ok || !html.includes('/src/main.tsx')) {
      fail(`one-command starter did not serve its React entry: ${htmlResponse.status}`);
    }
    const moduleResponse = await fetch(new URL('/src/main.tsx', origin));
    const moduleText = await moduleResponse.text();
    if (!moduleResponse.ok || !moduleText.includes('virtual:snapback/dev')) {
      fail(`one-command starter did not transform the relative Snapback client seam: ${moduleResponse.status}`);
    }
    const healthResponse = await fetch(new URL('/__snapback/health', origin));
    const health = await healthResponse.json();
    if (!healthResponse.ok || health?.ok !== true) {
      fail(`one-command starter relay did not reach Snapback: ${JSON.stringify(health)}`);
    }

    const readyFile = join(scaffoldRoot, '.snapback', 'dev.ready.json');
    const descriptor = await waitFor(() => {
      if (!existsSync(readyFile)) return null;
      try {
        return JSON.parse(readFileSync(readyFile, 'utf8'));
      } catch {
        return null;
      }
    }, 'one-command starter ready descriptor');
    if (typeof descriptor?.serverUrl !== 'string' || descriptor.serverUrl.length === 0) {
      fail('one-command starter ready descriptor omitted the private backend origin');
    }
    if (
      typeof descriptor.adminTokenFile !== 'string'
      || !existsSync(descriptor.adminTokenFile)
    ) {
      fail('one-command starter did not retain an owner-only admin token for leak checking');
    }
    const adminToken = readFileSync(descriptor.adminTokenFile, 'utf8').trim();
    if (adminToken.length < 32) {
      fail('one-command starter admin token is too short for an exact leak sentinel');
    }

    // @ref LLP 0030#validation-requirements — qualification must run the
    // actual relative-proxy browser path, observe the live socket, and prove
    // user data survives a browser reload. A Node fetch or adapter import is
    // not equivalent evidence.
    // @ref LLP 0041#acceptance — the browser and its driver are installed in
    // this fresh external package project; repository or ambient browsers do
    // not satisfy the packed-loop gate.
    const browserCaptureStartedAtMs = Date.now();
    const browser = await chromium.launch({
      executablePath: browserExecutablePath,
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable', {
      maxPostDataSize: BROWSER_MAX_SURFACE_BYTES,
      maxResourceBufferSize: BROWSER_MAX_SURFACE_BYTES,
      maxTotalBufferSize: BROWSER_MAX_TOTAL_BYTES,
    });
    const surfaceCollector = createBoundedBrowserSurfaceCollector({
      maxSurfaceBytes: BROWSER_MAX_SURFACE_BYTES,
      maxTotalBytes: BROWSER_MAX_TOTAL_BYTES,
      maxSurfaces: BROWSER_MAX_SURFACES,
    });
    const evidenceTasks = createBoundedAsyncTaskPool({
      maxTasks: BROWSER_MAX_ASYNC_TASKS,
      maxConcurrency: BROWSER_MAX_CONCURRENCY,
    });
    const asyncEvidence = [];
    const consoleErrors = [];
    const pageErrors = [];
    const observedWorkers = new Map();
    const networkResponses = new Map();
    let captureFailure = null;
    let networkResourcesObserved = 0;
    let responseBodiesObserved = 0;
    let responseBodiesScanned = 0;
    let requestBodiesObserved = 0;
    let requestBodiesScanned = 0;
    let consoleMessagesObserved = 0;
    let consoleArgumentsObserved = 0;
    let consoleArgumentsScanned = 0;
    let webSocketHandshakesObserved = 0;
    let webSocketHandshakesScanned = 0;
    let webSocketFramesObserved = 0;
    let webSocketFramesScanned = 0;
    let liveFrames = 0;
    const captureSurface = (kind, value) => {
      if (captureFailure) return;
      try {
        surfaceCollector.add(kind, value);
      } catch (error) {
        captureFailure = error;
      }
    };
    const scheduleEvidence = (task) => {
      const promise = evidenceTasks.add(task).catch((error) => {
        captureFailure ??= error;
        return false;
      });
      asyncEvidence.push(promise);
      return promise;
    };
    const assertNetworkResourceSlot = () => {
      networkResourcesObserved += 1;
      if (networkResourcesObserved > BROWSER_MAX_ASYNC_TASKS) {
        throw new RangeError(
          `browser network resources exceeded the ${BROWSER_MAX_ASYNC_TASKS}-resource bound`,
        );
      }
    };
    const observeWorker = (worker, kind) => {
      if (observedWorkers.has(worker)) return;
      const inspection = scheduleEvidence(async () => {
        const state = await inspectWorker(worker);
        captureSurface(kind, state);
        return true;
      })
        .then((result) => {
          if (result !== true) return false;
          return true;
        }).catch((error) => {
          captureFailure ??= new Error(`could not inspect ${kind}: ${error.message}`);
          return false;
        });
      observedWorkers.set(worker, { kind, inspection });
    };
    page.on('worker', (worker) => observeWorker(worker, 'worker-state'));
    context.on('serviceworker', (worker) => observeWorker(worker, 'service-worker-state'));
    cdp.on('Network.requestWillBeSent', (event) => {
      try {
        assertNetworkResourceSlot();
        const request = event.request;
        captureSurface('request', JSON.stringify({
          documentURL: event.documentURL,
          frameId: event.frameId,
          hasPostData: request.hasPostData === true,
          headers: request.headers,
          initiator: event.initiator,
          method: request.method,
          mixedContentType: request.mixedContentType,
          redirectHasExtraInfo: event.redirectHasExtraInfo,
          requestId: event.requestId,
          resourceType: event.type,
          url: request.url,
        }));
        if (request.hasPostData === true) {
          requestBodiesObserved += 1;
          const contentLength = Object.entries(request.headers ?? {}).find(
            ([name]) => name.toLowerCase() === 'content-length',
          )?.[1];
          if (
            contentLength !== undefined
            && (!/^\d+$/u.test(String(contentLength))
              || Number(contentLength) > BROWSER_MAX_SURFACE_BYTES)
          ) {
            throw new RangeError('browser request declared an out-of-bounds body');
          }
          scheduleEvidence(async () => {
            let bytes;
            if (Array.isArray(request.postDataEntries) && request.postDataEntries.length > 0) {
              const accumulator = createBoundedByteAccumulator({
                label: 'browser request body',
                maxBytes: BROWSER_MAX_SURFACE_BYTES,
                maxChunks: BROWSER_MAX_SURFACES,
              });
              for (const { bytes: encoded } of request.postDataEntries) {
                if (typeof encoded !== 'string') {
                  throw new Error('browser request body entry omitted binary bytes');
                }
                accumulator.add(Buffer.from(encoded, 'base64'));
              }
              bytes = accumulator.finish();
            } else if (typeof request.postData === 'string') {
              bytes = Buffer.from(request.postData);
            } else {
              const result = await cdp.send('Network.getRequestPostData', {
                requestId: event.requestId,
              });
              bytes = Buffer.from(result.postData);
            }
            captureSurface('request-body', bytes);
            requestBodiesScanned += 1;
            return true;
          });
        }
      } catch (error) {
        captureFailure ??= error;
      }
    });
    cdp.on('Network.requestWillBeSentExtraInfo', (event) => {
      captureSurface('request-headers', JSON.stringify({
        associatedCookies: event.associatedCookies,
        clientSecurityState: event.clientSecurityState,
        connectTiming: event.connectTiming,
        headers: event.headers,
        requestId: event.requestId,
        siteHasCookieInOtherPartition: event.siteHasCookieInOtherPartition,
      }));
    });
    cdp.on('Network.responseReceived', (event) => {
      responseBodiesObserved += 1;
      networkResponses.set(event.requestId, {
        dataEvents: 0,
        decodedDataLength: 0,
        status: event.response.status,
        url: event.response.url,
      });
      captureSurface('response-metadata', JSON.stringify({
        frameId: event.frameId,
        hasExtraInfo: event.hasExtraInfo,
        requestId: event.requestId,
        resourceType: event.type,
        response: event.response,
      }));
    });
    cdp.on('Network.responseReceivedExtraInfo', (event) => {
      captureSurface('response-headers', JSON.stringify({
        blockedCookies: event.blockedCookies,
        cookiePartitionKey: event.cookiePartitionKey,
        cookiePartitionKeyOpaque: event.cookiePartitionKeyOpaque,
        exemptedCookies: event.exemptedCookies,
        headers: event.headers,
        headersText: event.headersText,
        requestId: event.requestId,
        resourceIPAddressSpace: event.resourceIPAddressSpace,
        statusCode: event.statusCode,
      }));
    });
    cdp.on('Network.dataReceived', (event) => {
      const response = networkResponses.get(event.requestId);
      if (!response || captureFailure) return;
      try {
        response.dataEvents += 1;
        if (response.dataEvents > BROWSER_MAX_SURFACES) {
          throw new RangeError(`browser response chunk count exceeded its bound: ${response.url}`);
        }
        if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) {
          throw new RangeError(`browser response reported an unsafe chunk size: ${response.url}`);
        }
        response.decodedDataLength += event.dataLength;
        if (
          !Number.isSafeInteger(response.decodedDataLength)
          || response.decodedDataLength > BROWSER_MAX_SURFACE_BYTES
        ) {
          throw new RangeError(
            `browser response exceeded its decoded scan bound while loading: ${response.url}`,
          );
        }
      } catch (error) {
        captureFailure ??= error;
      }
    });
    cdp.on('Network.loadingFinished', (event) => {
      const response = networkResponses.get(event.requestId);
      if (!response) return;
      scheduleEvidence(async () => {
        if (
          !Number.isFinite(event.encodedDataLength)
          || event.encodedDataLength < 0
          || event.encodedDataLength > BROWSER_MAX_SURFACE_BYTES
          || response.decodedDataLength > BROWSER_MAX_SURFACE_BYTES
        ) {
          throw new RangeError(
            `browser response exceeded its encoded scan bound: ${response.url}`,
          );
        }
        let result;
        try {
          result = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
        } catch (error) {
          const status = response.status;
          if (
            status === 101
            || status === 204
            || status === 205
            || status === 304
            || (status >= 300 && status < 400)
          ) {
            result = { body: '', base64Encoded: false };
          } else {
            throw new Error(
              `could not capture browser-readable response bytes ${response.url}: ${error.message}`,
            );
          }
        }
        const body = result.base64Encoded
          ? Buffer.from(result.body, 'base64')
          : Buffer.from(result.body);
        if (body.byteLength > BROWSER_MAX_SURFACE_BYTES) {
          throw new RangeError(`browser response exceeded its decoded scan bound: ${response.url}`);
        }
        captureSurface('response-body', body);
        responseBodiesScanned += 1;
        networkResponses.delete(event.requestId);
        return true;
      });
    });
    cdp.on('Network.loadingFailed', (event) => {
      if (!networkResponses.has(event.requestId)) return;
      captureFailure ??= new Error(
        `browser response failed before complete capture: ${event.errorText}`,
      );
    });
    page.on('console', (message) => {
      consoleMessagesObserved += 1;
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
      captureSurface('console', JSON.stringify({
        location: message.location(),
        text: message.text(),
        type: message.type(),
      }));
      const argumentsList = message.args();
      consoleArgumentsObserved += argumentsList.length;
      for (const argument of argumentsList) {
        scheduleEvidence(async () => {
          const rendered = await argument.evaluate(boundedSerializeBrowserValue, {
            maxBytes: BROWSER_MAX_SURFACE_BYTES,
            maxDepth: BROWSER_MAX_VALUE_DEPTH,
            maxNodes: BROWSER_MAX_VALUE_NODES,
            maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
          });
          captureSurface('console-arg', rendered);
          consoleArgumentsScanned += 1;
          return true;
        });
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
      captureSurface('page-error', JSON.stringify({
        message: error.message,
        name: error.name,
        stack: error.stack,
      }));
    });
    cdp.on('Network.webSocketCreated', (event) => {
      captureSurface('websocket-url', JSON.stringify(event));
    });
    cdp.on('Network.webSocketWillSendHandshakeRequest', (event) => {
      try {
        webSocketHandshakesObserved += 1;
        if (webSocketHandshakesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser WebSocket handshake count exceeded its bound');
        }
        captureSurface('websocket-handshake-request', JSON.stringify(event));
      } catch (error) {
        captureFailure ??= error;
      }
    });
    cdp.on('Network.webSocketHandshakeResponseReceived', (event) => {
      captureSurface('websocket-handshake-response', JSON.stringify(event));
      webSocketHandshakesScanned += 1;
    });
    cdp.on('Network.webSocketFrameReceived', (event) => {
      try {
        webSocketFramesObserved += 1;
        if (webSocketFramesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser WebSocket frame count exceeded its bound');
        }
        liveFrames += 1;
        const payload = event.response.opcode === 2
          ? Buffer.from(event.response.payloadData, 'base64')
          : event.response.payloadData;
        captureSurface(
          'websocket-frame-received',
          payload,
        );
        webSocketFramesScanned += 1;
      } catch (error) {
        captureFailure ??= error;
      }
    });
    cdp.on('Network.webSocketFrameSent', (event) => {
      try {
        webSocketFramesObserved += 1;
        if (webSocketFramesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser WebSocket frame count exceeded its bound');
        }
        const payload = event.response.opcode === 2
          ? Buffer.from(event.response.payloadData, 'base64')
          : event.response.payloadData;
        captureSurface(
          'websocket-frame-sent',
          payload,
        );
        webSocketFramesScanned += 1;
      } catch (error) {
        captureFailure ??= error;
      }
    });

    let browserJourney;
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Snapback todos' }).waitFor();
      await page.getByText('Connection: live', { exact: true }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Build with Snapback' }).waitFor();
      const initialSeededTodoCount = await page.getByRole('listitem').count();
      if (initialSeededTodoCount !== 1) {
        fail(`real browser expected one seeded todo, observed ${initialSeededTodoCount}`);
      }

      const framesBeforeMutation = liveFrames;
      await page.getByRole('button', { name: 'Add todo' }).click();
      await page.getByRole('listitem').filter({ hasText: 'Todo 2' }).waitFor();
      const postMutationTodoCount = await page.getByRole('listitem').count();
      if (postMutationTodoCount !== 2) {
        fail(`real browser expected two todos after mutation, observed ${postMutationTodoCount}`);
      }
      await waitFor(
        () => liveFrames > framesBeforeMutation,
        'one-command starter native live WebSocket delivery',
      );
      const liveFramesAfterMutation = liveFrames - framesBeforeMutation;

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('Connection: live', { exact: true }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Build with Snapback' }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Todo 2' }).waitFor();
      const reloadedTodoCount = await page.getByRole('listitem').count();
      if (reloadedTodoCount !== 2) {
        fail(`real browser reload did not preserve the mutation: ${reloadedTodoCount} todos`);
      }

      const browserState = await page.evaluate(() => ({
        dom: document.documentElement.outerHTML,
        cookie: document.cookie,
        localStorage: Object.fromEntries(
          Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .filter((key) => key !== null)
            .map((key) => [key, localStorage.getItem(key)]),
        ),
        sessionStorage: Object.fromEntries(
          Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
            .filter((key) => key !== null)
            .map((key) => [key, sessionStorage.getItem(key)]),
        ),
        resourceUrls: performance.getEntriesByType('resource').map((entry) => entry.name),
        windowStrings: Object.getOwnPropertyNames(globalThis).flatMap((name) => {
          try {
            return typeof globalThis[name] === 'string' ? [`${name}=${globalThis[name]}`] : [];
          } catch {
            return [];
          }
        }),
        userAgent: navigator.userAgent,
      }));
      captureSurface('page-state', JSON.stringify(browserState));
      for (const worker of page.workers()) observeWorker(worker, 'worker-state');
      for (const worker of context.serviceWorkers()) {
        observeWorker(worker, 'service-worker-state');
      }
      const workerResults = await Promise.all(
        [...observedWorkers.values()].map(({ inspection }) => inspection),
      );
      let settledTaskCount = -1;
      while (settledTaskCount !== asyncEvidence.length) {
        settledTaskCount = asyncEvidence.length;
        await evidenceTasks.settle();
        await Promise.all(asyncEvidence.slice());
        await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));
      }
      if (networkResponses.size !== 0) {
        throw new Error(
          `browser response capture remained incomplete for ${networkResponses.size} resources`,
        );
      }
      const storageInspection = await inspectBrowserStorage(page);
      for (const surface of storageInspection.surfaces) {
        captureSurface(
          surface.kind,
          Object.hasOwn(surface, 'text')
            ? surface.text
            : Buffer.from(surface.base64, 'base64'),
        );
      }
      if (captureFailure) {
        throw captureFailure;
      }
      const runtimePath = join(
        scaffoldRoot,
        'node_modules',
        ...hostRuntime.split('/'),
        'bin',
        process.platform === 'win32' ? 'snapback.exe' : 'snapback',
      );
      const forbiddenMarkers = [
        { kind: 'admin-token', value: adminToken },
        { kind: 'admin-token-file', value: descriptor.adminTokenFile },
        { kind: 'backend-origin', value: descriptor.serverUrl },
        { kind: 'browser-secret-canary', value: browserSecretCanary },
        { kind: 'database-path', value: descriptor.database?.path },
        { kind: 'ready-file', value: readyFile },
        { kind: 'repository-path', value: realpathSync(root) },
        { kind: 'runtime-path', value: realpathSync(runtimePath) },
        { kind: 'secret-read-root-file', value: descriptor.secretReadRootFile },
        {
          kind: 'impersonation-capability-file',
          value: descriptor.impersonationCapabilityFile,
        },
      ].filter(({ value }) => typeof value === 'string' && value.length > 0);
      const leaks = surfaceCollector.findLeaks(forbiddenMarkers);
      if (leaks.length > 0) {
        fail(`real browser exposed private marker classes: ${leaks.join(', ')}`);
      }
      if (consoleErrors.length > 0 || pageErrors.length > 0) {
        fail(`real browser emitted errors: ${[...consoleErrors, ...pageErrors].join('; ')}`);
      }

      const forbiddenMarkerKindsChecked = [
        ...new Set(forbiddenMarkers.map(({ kind }) => kind)),
      ].sort();
      const sanitizedCapture = surfaceCollector.sanitizedSummary();
      const workers = [...observedWorkers.values()];
      const browserCapture = {
        schemaVersion: 'snapback.package-browser-capture.v1',
        sourceRevision: sourceIdentity.revision,
        sourceDirty: sourceIdentity.dirty,
        startedAtMs: browserCaptureStartedAtMs,
        completedAtMs: Date.now(),
        maxSurfaceBytes: sanitizedCapture.maxSurfaceBytes,
        maxTotalBytes: sanitizedCapture.maxTotalBytes,
        maxSurfaces: sanitizedCapture.maxSurfaces,
        totalBytesScanned: sanitizedCapture.totalBytesScanned,
        surfaceManifest: sanitizedCapture.surfaceManifest,
        coverage: {
          asyncTasksObserved: evidenceTasks.stats().admitted,
          asyncTasksPeakConcurrency: evidenceTasks.stats().peakActive,
          consoleArgumentsObserved,
          consoleArgumentsScanned,
          consoleMessagesObserved,
          networkResourcesObserved,
          requestBodiesObserved,
          requestBodiesScanned,
          responseBodiesObserved,
          responseBodiesScanned,
          workersObserved: workers.filter(({ kind }) => kind === 'worker-state').length,
          workersScanned: workers.filter(
            ({ kind }, index) => kind === 'worker-state' && workerResults[index] === true,
          ).length,
          serviceWorkersObserved:
            workers.filter(({ kind }) => kind === 'service-worker-state').length,
          serviceWorkersScanned: workers.filter(
            ({ kind }, index) => (
              kind === 'service-worker-state' && workerResults[index] === true
            ),
          ).length,
          cacheEntriesObserved: storageInspection.coverage.cacheEntriesObserved,
          cacheEntriesScanned: storageInspection.coverage.cacheEntriesObserved,
          indexedDbRecordsObserved: storageInspection.coverage.indexedDbRecordsObserved,
          indexedDbRecordsScanned: storageInspection.coverage.indexedDbRecordsObserved,
          webSocketFramesObserved,
          webSocketFramesScanned,
          webSocketHandshakesObserved,
          webSocketHandshakesScanned,
          scanTruncated: false,
        },
        browser: {
          packageVersion: playwrightManifest.version,
          packageTreeSha256: browserSupportIdentity.sha256,
          packageTreeEntries: browserSupportIdentity.entryCount,
          packageTreeBytes: browserSupportIdentity.totalBytes,
          distributionSha256: browserDistributionIdentity.sha256,
          distributionEntries: browserDistributionIdentity.entryCount,
          distributionBytes: browserDistributionIdentity.totalBytes,
          executableSha256: browserDistributionIdentity.executableSha256,
          executableBytes: browserDistributionIdentity.executableBytes,
        },
        forbiddenMarkerKindsChecked,
        captureSanitized: true,
        forbiddenValueRetention: 'none',
      };
      browserJourney = {
        schemaVersion: 'snapback.package-browser-journey.v1',
        browserPackage: 'playwright',
        browserPackageVersion: playwrightManifest.version,
        engine: 'chromium',
        engineVersion: browser.version(),
        headless: true,
        initialSeededTodoCount,
        postMutationTodoCount,
        reloadedTodoCount,
        liveFramesAfterMutation,
        browserReadableSurfaceCount: sanitizedCapture.surfaceManifest.length,
        forbiddenMarkerKindsChecked,
        capture: browserCapture,
        captureSha256: sha256Hex(canonicalJcs(browserCapture)),
        checks: {
          realBrowserRendered: true,
          renderedSeededTodo: true,
          generatedMutationPerformed: true,
          nativeLiveUpdateObserved: true,
          webSocketLiveFrameObserved: true,
          reloadPreservedMutation: true,
          browserReadableBackendOriginAbsent: true,
          browserReadableAdminTokenAbsent: true,
          browserReadableFilesystemPathsAbsent: true,
          browserReadableCanaryAbsent: true,
        },
      };
    } finally {
      await context.close();
      await browser.close();
    }
    let finalBrowserFilesystemIdentity;
    try {
      finalBrowserFilesystemIdentity = await measureBrowserFilesystemIdentity();
    } catch (error) {
      fail(`real-browser final filesystem identity refused: ${error.message}`);
    }
    if (
      finalBrowserFilesystemIdentity.support.sha256 !== browserSupportIdentity.sha256
      || finalBrowserFilesystemIdentity.distribution.sha256
        !== browserDistributionIdentity.sha256
    ) {
      fail('real-browser filesystem identity changed across the browser journey');
    }
    return {
      relativeBasePath: '/__snapback',
      browserJourney,
    };
  } finally {
    if (child.exitCode === null) child.stdin.end();
    const deadline = Date.now() + 15_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (child.exitCode === null) child.kill('SIGTERM');
    const hardDeadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < hardDeadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

if (!existsSync(ledgerPath)) fail(`publication ledger is missing: ${ledgerPath}`);
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
if (![
  'snapback.package-publication.v1',
  'snapback.package-candidate-ledger.v1',
  'snapback.package-qualified-staging-ledger.v1',
].includes(ledger.schemaVersion)) fail('unsupported publication ledger');
if (installSource === 'staged') {
  try {
    validateStagedPublicationLedger(ledger);
  } catch (error) {
    fail(error.message);
  }
}
const checkoutIdentity = measureGitCheckoutIdentity(root);
if (checkoutIdentity.revision !== ledger.revision) {
  fail(
    `measured checkout HEAD ${checkoutIdentity.revision} does not match ledger revision ${ledger.revision}`,
  );
}
if (checkoutIdentity.dirty) {
  fail('cold-install qualification refuses a dirty measured checkout');
}
const ledgerDirectory = dirname(ledgerPath);
const dependencies = { react: '19.2.3', esbuild: '0.28.1' };
const runtimePackages = new Map([
  ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
  ['linux-x64', '@snapback/runtime-linux-x64'],
]);
const hostPlatform = `${process.platform}-${process.arch}`;
const hostRuntime = runtimePackages.get(hostPlatform);
if (!hostRuntime) fail(`cold-install proof has no runtime package for ${hostPlatform}`);
const allExpectedPackages = [
  ...runtimePackages.values(),
  '@snapback/contract',
  '@snapback/client',
  '@snapback/codegen',
  '@snapback/vite',
  '@snapback/react',
  '@snapback/app-cli',
  '@snapback/cli',
];
let publicEntries = null;
if (installSource === 'public') {
  try {
    publicEntries = validatePublicPublicationLedger(ledger, allExpectedPackages);
  } catch (error) {
    fail(error.message);
  }
  if (registry !== ledger.registry) {
    fail(`public install registry differs from publication ledger: ${registry}`);
  }
}
const tarballs = [];
const exactDependencies = { ...dependencies };
for (const entry of ledger.packages ?? []) {
  const runtimePlatform = [...runtimePackages.entries()]
    .find(([, packageName]) => packageName === entry.sourceName)?.[0];
  if (runtimePlatform && runtimePlatform !== hostPlatform) continue;
  if (installSource === 'public') {
    exactDependencies[entry.sourceName] = `npm:${entry.name}@${entry.version}`;
  } else {
    const tarball = join(ledgerDirectory, entry.tarball);
    if (!existsSync(tarball)) fail(`tarball is missing: ${tarball}`);
    if (sha256(tarball) !== entry.sha256) fail(`tarball digest mismatch: ${entry.tarball}`);
    exactDependencies[entry.sourceName] = `file:${tarball}`;
    tarballs.push(tarball);
  }
}
if (rootSelector === 'latest') {
  dependencies['@snapback/cli'] = 'npm:@ccheever/snapback-cli@latest';
} else {
  Object.assign(dependencies, exactDependencies);
}

const expectedPackages = [
  hostRuntime,
  '@snapback/contract',
  '@snapback/client',
  '@snapback/codegen',
  '@snapback/vite',
  '@snapback/react',
  '@snapback/app-cli',
  '@snapback/cli',
];
for (const name of expectedPackages) {
  if (!exactDependencies[name]) fail(`publication closure omits ${name}`);
}

const temporary = mkdtempSync(join(tmpdir(), 'snapback-package-cold-'));
const registryTarballs = [];
if (installSource === 'public') {
  const downloadRoot = join(temporary, 'registry-tarballs');
  mkdirSync(downloadRoot, { recursive: true });
  for (const sourceName of allExpectedPackages) {
    const entry = publicEntries.get(sourceName);
    const packed = JSON.parse(run('npm', [
      'pack',
      `${entry.name}@${entry.version}`,
      '--pack-destination', downloadRoot,
      '--json',
      '--ignore-scripts',
      '--registry', registry,
    ], { cwd: temporary, timeout: 360_000 }))[0];
    const downloaded = join(downloadRoot, packed.filename);
    if (sha256(downloaded) !== entry.registrySha256) {
      fail(`public registry tarball digest mismatch for ${entry.name}@${entry.version}`);
    }
    const manifest = JSON.parse(run('tar', ['-xzOf', downloaded, 'package/package.json']));
    if (manifest.name !== entry.name || manifest.version !== entry.version) {
      fail(`public registry package identity drift for ${entry.name}@${entry.version}`);
    }
    registryTarballs.push({
      sourceName,
      publishedName: entry.name,
      version: entry.version,
      sha256: entry.registrySha256,
    });
  }
}
const stagedRegistry = installSource === 'staged'
  ? await startStagedRegistry(ledgerDirectory, ledger)
  : null;
const installRegistry = stagedRegistry?.url ?? registry;
const appRoot = join(temporary, 'partitime-external');
const backendRoot = join(appRoot, 'snapback');
mkdirSync(backendRoot, { recursive: true });

try {
  writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'partitime-external-package-proof',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`);
  writeFileSync(
    join(appRoot, '.npmrc'),
    `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
  );
  // Materialize the real Partitime backend source into the external checkout.
  // From this point onward the proof runs only against that copy and tarballs.
  for (const file of ['schema.mjs', 'functions.mjs', 'seed.json']) {
    cpSync(join(root, 'demos', 'partiful-matrix', 'snapback', file), join(backendRoot, file));
  }
  writeFileSync(join(backendRoot, 'remote-service.publication.json'), `${JSON.stringify({
    profileId: 'remote-service-sqlite-ibex',
    targetProfileId: 'remote-service-sqlite-ibex',
    authCapabilityId: 'snapback.auth.partitime-external',
    dataCapabilityId: 'snapback.data.partitime-external',
    operations: ['createEvent', 'rsvp', 'postMessage'],
  }, null, 2)}\n`);
  writeFileSync(join(appRoot, 'generate.mjs'), `
import { readFileSync } from 'node:fs';
import { generate } from '@snapback/codegen';
for (const targetProfile of ['local-dev-sqlite-ibex', 'remote-service-sqlite-ibex']) {
  const result = await generate(new URL('./snapback', import.meta.url).pathname, { targetProfile });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
}
const profile = JSON.parse(readFileSync(new URL('./snapback/generated-remote-service/remote-service.profile.json', import.meta.url), 'utf8'));
if (profile.publication.profilePath.includes('node_modules')) throw new Error('package-install path leaked into publication');
if (profile.publication.profilePath !== 'snapback/generated-remote-service/remote-service.profile.json') {
  throw new Error(\`unexpected publication path: \${profile.publication.profilePath}\`);
}
if (profile.dataTier.caseCount < 29) throw new Error('bundled data-tier corpus is incomplete');
`);
  writeFileSync(join(appRoot, 'browser-entry.mjs'), `
import { createMemorySnapbackClientStore } from '@snapback/contract';
import { SnapbackClient } from '@snapback/client';
import { useSnapbackQuery } from '@snapback/react';
globalThis.__snapbackPackageProof = [createMemorySnapbackClientStore, SnapbackClient, useSnapbackQuery];
`);
  writeFileSync(join(appRoot, 'bundle.mjs'), `
import { build } from 'esbuild';
await build({
  entryPoints: ['browser-entry.mjs'],
  outfile: 'dist/browser-entry.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'silent',
});
`);

  run('git', ['init', '--quiet'], { cwd: appRoot });
  await runAsyncOrFail('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--registry', PUBLIC_NPM_REGISTRY,
    ...tarballs,
  ], {
    cwd: appRoot,
    timeout: 360_000,
  });
  let latestRootResolution = null;
  if (rootSelector === 'latest') {
    const latestTree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: appRoot }));
    const tagVector = {};
    for (const entry of ledger.packages) {
      const tags = JSON.parse(run('npm', [
        'view',
        entry.name,
        'dist-tags',
        '--json',
        '--registry',
        registry,
      ], { cwd: appRoot }));
      tagVector[entry.name] = tags.latest ?? null;
    }
    try {
      latestRootResolution = validateLatestRootResolution({
        tree: latestTree,
        ledger,
        hostRuntime,
        tagVector,
      });
    } catch (error) {
      fail(error.message);
    }
    // Retain the root-only observation above, then expand this same fresh
    // directory to the exact candidate vector for the complete product proof.
    const expandedManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
    expandedManifest.dependencies = {
      ...expandedManifest.dependencies,
      ...exactDependencies,
    };
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(expandedManifest, null, 2)}\n`,
    );
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
    ], {
      cwd: appRoot,
      timeout: 360_000,
    });
    Object.assign(dependencies, exactDependencies);
  }
  for (const name of expectedPackages) {
    const installPath = join(appRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installPath) || lstatSync(installPath).isSymbolicLink()) {
      fail(`${name} is not a materialized tarball install`);
    }
  }

  // Installation may use the network. Generation itself must not.
  run(process.execPath, ['generate.mjs'], {
    cwd: appRoot,
    env: { ...process.env, npm_config_offline: 'true' },
  });
  const cli = join(appRoot, 'node_modules', '.bin', 'snapback-app');
  chmodSync(cli, 0o755);
  const introspection = JSON.parse(run(cli, [
    '--artifacts', join(backendRoot, 'generated'), 'introspect',
  ], { cwd: appRoot }));
  if (introspection.appId !== 'partitime-external') fail(`unexpected CLI app id ${introspection.appId}`);
  if (!introspection.functions.some((entry) => entry.name === 'createEvent')) {
    fail('packaged CLI did not discover Partitime createEvent');
  }
  const developerCli = join(appRoot, 'node_modules', '.bin', 'snapback');
  chmodSync(developerCli, 0o755);
  const doctor = JSON.parse(run(developerCli, ['doctor', '--json'], { cwd: appRoot }));
  if (
    !doctor.ok
    || doctor.probe !== 'vertical-slice'
    || doctor.checks?.[0]?.code !== 'SNAPBACK_RUNTIME_LAUNCH_OK'
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_BUNDLE_LOAD_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_QUERY_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_MUTATION_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_LIVE_OK')
    || !doctor.checks.some((check) => check.code === 'SNAPBACK_DOCTOR_SHUTDOWN_OK')
  ) {
    fail(`packaged runtime doctor failed: ${JSON.stringify(doctor)}`);
  }
  const comparatorReceiptPath = join(appRoot, 'comparator-receipt.json');
  const comparatorConfigPath = join(
    appRoot,
    'node_modules',
    '@snapback',
    'cli',
    'fixtures',
    'comparator',
    'green.config.mjs',
  );
  run(developerCli, [
    'accept', 'comparator',
    '--config', comparatorConfigPath,
    '--receipt', comparatorReceiptPath,
    '--timeout-ms', '30000',
    '--json',
  ], { cwd: appRoot, timeout: 120_000 });
  const comparatorReceipt = JSON.parse(readFileSync(comparatorReceiptPath, 'utf8'));
  if (
    comparatorReceipt.schemaVersion !== 'snapback.comparator-receipt.v1'
    || comparatorReceipt.status !== 'passed'
    || comparatorReceipt.exitCode !== 0
    || comparatorReceipt.checks?.length !== 5
    || comparatorReceipt.checks.some(({ status }) => status !== 'passed')
    || comparatorReceipt.cleanup?.ok !== true
  ) {
    fail(`packed comparator profile did not pass: ${JSON.stringify(comparatorReceipt)}`);
  }
  const comparatorVerification = JSON.parse(run(developerCli, [
    'accept', 'comparator',
    '--verify-receipt', comparatorReceiptPath,
    '--max-age-ms', '60000',
    '--json',
  ], { cwd: appRoot }));
  if (
    comparatorVerification.schemaVersion !== 'snapback.comparator-verification.v1'
    || comparatorVerification.ok !== true
    || comparatorVerification.status !== 'passed'
  ) {
    fail(`packed comparator receipt did not verify: ${JSON.stringify(comparatorVerification)}`);
  }
  const scaffoldRoot = join(appRoot, 'todo-contract');
  run(developerCli, ['new', scaffoldRoot, '--template', 'todo-contract', '--json'], { cwd: appRoot });
  const scaffoldManifestPath = join(scaffoldRoot, 'package.json');
  const scaffoldManifest = JSON.parse(readFileSync(scaffoldManifestPath, 'utf8'));
  for (const name of Object.keys(scaffoldManifest.dependencies ?? {})) {
    if (dependencies[name]) scaffoldManifest.dependencies[name] = dependencies[name];
  }
  writeFileSync(scaffoldManifestPath, `${JSON.stringify(scaffoldManifest, null, 2)}\n`);
  writeFileSync(
    join(scaffoldRoot, '.npmrc'),
    `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
  );
  await runAsyncOrFail('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--registry', PUBLIC_NPM_REGISTRY,
    ...tarballs,
  ], {
    cwd: scaffoldRoot,
    timeout: 360_000,
  });
  run(join(scaffoldRoot, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback', '--json'], {
    cwd: scaffoldRoot,
    env: { ...process.env, npm_config_offline: 'true' },
  });
  run(process.execPath, ['acceptance.mjs'], { cwd: scaffoldRoot });
  run('git', ['init', '--quiet'], { cwd: scaffoldRoot });
  run('git', ['add', 'package.json', 'package-lock.json', 'acceptance.mjs', 'snapback'], { cwd: scaffoldRoot });
  run('git', [
    '-c', 'user.name=Snapback Package Proof',
    '-c', 'user.email=snapback-package-proof@example.invalid',
    'commit', '--quiet', '-m', 'cold install release fixture',
  ], { cwd: scaffoldRoot });
  const deployBuild = JSON.parse(run(
    join(scaffoldRoot, 'node_modules', '.bin', 'snapback'),
    [
      'deploy', 'build', 'snapback',
      '--target-profile', 'local-dev-sqlite-ibex',
      '--output', join(temporary, 'release-proof'),
      '--allow-dirty',
      '--json',
    ],
    { cwd: scaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  ));
  if (
    !deployBuild.ok
    || deployBuild.schemaVersion !== 'snapback.deploy-build.v1'
    || deployBuild.activationEligible !== false
    || deployBuild.componentCount < 1
    || !deployBuild.gaps?.some((gap) => gap.id === 'control-plane.backup-restore' && gap.blocking === true)
    || !existsSync(deployBuild.manifestPath)
  ) {
    fail(`packaged deploy build did not retain a verified fail-closed release: ${JSON.stringify(deployBuild)}`);
  }
  await provePackagedDevLoop({
    cli: join(scaffoldRoot, 'node_modules', '.bin', 'snapback'),
    scaffoldRoot,
  });

  // @ref LLP 0102#exact-executable-gate — the React release proof installs
  // materialized package tarballs in fresh web and Expo projects. Repository
  // workspaces and source-tree resolution cannot satisfy this gate.
  const installPackedFixture = async (fixtureRoot, { realBrowser = false } = {}) => {
    const manifestPath = join(fixtureRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (dependencies[name]) manifest.dependencies[name] = dependencies[name];
    }
    if (realBrowser) {
      manifest.devDependencies = {
        ...(manifest.devDependencies ?? {}),
        playwright: BROWSER_PACKAGE_VERSION,
      };
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(
      join(fixtureRoot, '.npmrc'),
      `registry=${PUBLIC_NPM_REGISTRY}\n@ccheever:registry=${installRegistry}\n`,
    );
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
      ...tarballs,
    ], {
      cwd: fixtureRoot,
      timeout: 360_000,
    });
    const fixtureSnapbackPackages = [
      '@snapback/client',
      '@snapback/react',
      '@snapback/vite',
    ].filter((name) => Object.hasOwn(manifest.dependencies ?? {}, name));
    for (const name of fixtureSnapbackPackages) {
      const installed = join(fixtureRoot, 'node_modules', ...name.split('/'));
      if (!existsSync(installed) || lstatSync(installed).isSymbolicLink()) {
        fail(`${fixtureRoot}: ${name} is not a materialized tarball install`);
      }
      const resolved = realpathSync(installed);
      if (resolved.startsWith(join(root, 'packages'))) {
        fail(`${fixtureRoot}: ${name} resolved back into the repository source tree`);
      }
    }
    const packageText = readFileSync(manifestPath, 'utf8');
    const lockText = readFileSync(join(fixtureRoot, 'package-lock.json'), 'utf8');
    if (packageText.includes('workspace:') || lockText.includes('workspace:')) {
      fail(`${fixtureRoot}: packed fixture retains a workspace alias`);
    }
  };

  const reactScaffoldRoot = join(appRoot, 'react-starter');
  run(developerCli, ['new', reactScaffoldRoot, '--template', 'react', '--json'], { cwd: appRoot });
  await installPackedFixture(reactScaffoldRoot, { realBrowser: true });
  run(
    join(reactScaffoldRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: reactScaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: reactScaffoldRoot });
  run('npm', ['test'], { cwd: reactScaffoldRoot });
  const browserSecretCanary = `snapback-cold-canary-${randomBytes(24).toString('hex')}`;
  run('npm', ['run', 'build'], {
    cwd: reactScaffoldRoot,
    env: {
      ...process.env,
      SNAPBACK_ADMIN_TOKEN: browserSecretCanary,
      VITE_SNAPBACK_ADMIN_TOKEN: browserSecretCanary,
    },
  });
  const managedStarter = await proveOneCommandReactStarter(
    reactScaffoldRoot,
    checkoutIdentity,
  );
  run('npm', ['run', 'test:live'], { cwd: reactScaffoldRoot, timeout: 120_000 });
  const reactManifest = JSON.parse(readFileSync(join(reactScaffoldRoot, 'package.json'), 'utf8'));
  const reactMain = readFileSync(join(reactScaffoldRoot, 'src', 'main.tsx'), 'utf8');
  const reactViteConfig = readFileSync(join(reactScaffoldRoot, 'vite.config.ts'), 'utf8');
  const versionedSeed = JSON.parse(readFileSync(
    join(reactScaffoldRoot, 'snapback', 'generated', 'seed.artifact.json'),
    'utf8',
  ));
  const builtAssets = readdirSync(join(reactScaffoldRoot, 'dist', 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(reactScaffoldRoot, 'dist', 'assets', name), 'utf8'))
    .join('\n');
  if (
    reactManifest.scripts?.dev !== 'snapback dev snapback --client . --client-command vite'
    || reactManifest.scripts?.['snapback:dev'] !== reactManifest.scripts?.dev
    || reactManifest.scripts?.['client:dev'] !== 'vite'
    || !Object.hasOwn(reactManifest.dependencies ?? {}, '@snapback/vite')
    || !reactMain.includes("from 'virtual:snapback/dev'")
    || reactMain.includes('ensureApp(')
    || !reactViteConfig.includes("server: { mode: 'attach' }")
    || versionedSeed.formatVersion !== 'snapback.seed.v1'
    || typeof versionedSeed.seedVersion !== 'string'
    || builtAssets.includes('127.0.0.1')
    || browserAssetsContainSecretCanary(builtAssets, browserSecretCanary)
  ) {
    fail('React starter did not preserve the one-command versioned relative Vite seam');
  }

  const expoFixtureRoot = join(appRoot, 'react-expo');
  cpSync(
    join(root, 'packages', 'snapback-react', 'fixtures', 'packed-expo'),
    expoFixtureRoot,
    { recursive: true },
  );
  await installPackedFixture(expoFixtureRoot);
  run(
    join(expoFixtureRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: expoFixtureRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: expoFixtureRoot });
  run('npm', ['run', 'export:ios'], { cwd: expoFixtureRoot, timeout: 240_000 });

  run(process.execPath, ['bundle.mjs'], { cwd: appRoot });
  const browserBundle = readFileSync(join(appRoot, 'dist', 'browser-entry.js'), 'utf8');
  if (/\bnode:/.test(browserBundle)) fail('browser adapter bundle contains a Node builtin import');

  const tree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: appRoot }));
  const cleanMachine = process.env.GITHUB_ACTIONS === 'true'
    && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
  const receipt = {
    schemaVersion: 'snapback.package-cold-install.v1',
    ok: true,
    claimTreatment: 'checkpoint',
    claimSatisfied: false,
    platformClaimSatisfied: installSource === 'public' && cleanMachine,
    sourceRevision: checkoutIdentity.revision,
    sourceDirty: checkoutIdentity.dirty,
    publicationMode: ledger.mode,
    publicationLedgerSchema: ledger.schemaVersion,
    publicationTag: ledger.tag,
    candidateLedgerSha256: ledger.candidateLedgerSha256 ?? null,
    installSource,
    rootSelector,
    latestRootResolution,
    registry: installSource === 'public' ? registry : 'disposable-loopback',
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    machine: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: osRelease(),
      nodeVersion: process.version,
      runtimePackage: hostRuntime,
      runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? 'local',
      separatelyProvisionedCleanMachine: cleanMachine,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      githubRepository: process.env.GITHUB_REPOSITORY ?? null,
      githubWorkflowSha: process.env.GITHUB_SHA ?? null,
    },
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      tarball: entry.tarball,
      sha256: entry.sha256,
      registrySha256: entry.registrySha256 ?? null,
    })),
    deployBuild: {
      releaseId: deployBuild.releaseId,
      targetProfileId: deployBuild.targetProfileId,
      activationEligible: deployBuild.activationEligible,
      componentCount: deployBuild.componentCount,
      gapCount: deployBuild.gaps.length,
    },
    checks: {
      materializedTarballInstall: true,
      stagedRegistryAliasResolution: installSource === 'staged',
      publicRegistryAliasResolution: installSource === 'public',
      latestRootCandidateClosure: rootSelector === 'latest',
      publicRegistryTarballDigestMatch: installSource === 'public',
      registryTarballCount: registryTarballs.length,
      noSiblingSourceCheckout: true,
      partitimeBackendBuilt: true,
      localCodegenOffline: true,
      remoteCodegenOffline: true,
      bundledSchemasAndCorpus: true,
      repositoryRelativePublicationPaths: true,
      packagedCliIntrospection: true,
      packagedRuntimeDoctor: true,
      packagedComparatorProfile: true,
      packagedScaffoldAndOfflineGenerate: true,
      packagedDeployBuildAndVerify: true,
      packagedManagedDevReadyAttachWatchAndStop: true,
      packedReactWebTypecheckTestBuildAndLiveAcceptance: true,
      packedReactOneCommandBackendViteJourney:
        managedStarter.relativeBasePath === '/__snapback',
      packedReactRealBrowserSeedLiveReload: true,
      browserPrivateSurfaceAbsence: true,
      packedReactExpoTypecheckAndIosExport: true,
      packagedViteRelativeVersionedSeedSeam: true,
      browserAdapterBundle: true,
      resolvedDependencyCount: Object.keys(tree.dependencies ?? {}).length,
      browserBundleBytes: Buffer.byteLength(browserBundle),
    },
    browserJourney: managedStarter.browserJourney,
    nonclaims: [
      ...(installSource === 'public' ? [] : [{
        id: 'public-registry-install',
        reason: 'The proof resolves the exact public aliases through a disposable loopback npm registry backed by immutable tarballs; the packages are not yet published in a public registry.',
      }]),
      ...(cleanMachine ? [] : [{
        id: 'separately-provisioned-clean-machine',
        reason: 'The proof uses a fresh external directory on the development host, not a separately provisioned clean machine.',
      }]),
      {
        id: 'other-runtime-platforms-not-executed',
        reason: `This receipt launches ${hostPlatform}; every other retained runtime package requires its own clean machine proof.`,
      },
    ],
  };
  validateColdInstallBrowserEvidence(receipt);
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) writeFileSync(resolve(receiptPath), rendered);
  process.stdout.write(rendered);
} finally {
  if (stagedRegistry) await stagedRegistry.close();
  if (keep) console.error(`kept ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
