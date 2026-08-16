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
  BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
  boundedSerializeBrowserValue,
  browserAssetsContainSecretCanary,
  comparatorExecutorPackageNames,
  computePublicationReceiptProvenance,
  createBoundedAsyncTaskPool,
  createBoundedByteAccumulator,
  createBoundedBrowserSurfaceCollector,
  digestBoundedBrowserFilesystem,
  extractViteClientOrigin,
  classifyLatestRootObservation,
  LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
  LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
  LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
  LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
  ledgerNameGeneration,
  measureGitCheckoutIdentity,
  parseArguments,
  readBoundedJsonFile,
  PUBLIC_NPM_REGISTRY,
  resolveInstalledBrowserDistribution,
  runAsync,
  usage,
  validateColdInstallBrowserEvidence,
  validateColdInstallAgentDigest,
  validateLatestRootPropagationWitness,
  validatePublicPublicationLedger,
  validateRetainedComparatorReceipt,
  validateStagedPublicationLedger,
} from './snapback-package-cold-install-lib.mjs';
import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';
import { stopOwnedProcessTree } from './lib/process-tree.mjs';

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

function boundedUtf8ByteLength(text, label, maxBytes = BROWSER_MAX_SURFACE_BYTES) {
  if (typeof text !== 'string') throw new TypeError(`${label} must be text`);
  if (text.length > maxBytes) {
    throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
  }
  const byteLength = Buffer.byteLength(text);
  if (byteLength > maxBytes) {
    throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
  }
  return byteLength;
}

function decodeBoundedBase64(text, label) {
  if (typeof text !== 'string') throw new TypeError(`${label} must be base64 text`);
  const maxEncodedBytes = Math.ceil(BROWSER_MAX_SURFACE_BYTES / 3) * 4;
  if (
    text.length > maxEncodedBytes
    || text.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)
  ) {
    throw new RangeError(`${label} exceeded or violated its bounded base64 envelope`);
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const decodedBytes = (text.length / 4) * 3 - padding;
  if (decodedBytes > BROWSER_MAX_SURFACE_BYTES) {
    throw new RangeError(`${label} exceeded the ${BROWSER_MAX_SURFACE_BYTES}-byte bound`);
  }
  const accumulator = createBoundedByteAccumulator({
    label,
    maxBytes: BROWSER_MAX_SURFACE_BYTES,
    maxChunks: Math.ceil(maxEncodedBytes / (64 * 1024)) + 1,
  });
  for (let offset = 0; offset < text.length; offset += 64 * 1024) {
    accumulator.add(Buffer.from(text.slice(offset, offset + 64 * 1024), 'base64'));
  }
  const result = accumulator.finish();
  if (result.byteLength !== decodedBytes) {
    throw new Error(`${label} base64 length did not match its proven envelope`);
  }
  return result;
}

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
const expectedPriorRootVersion = parsedArgs.expectedPriorRootVersion;
const authorizedLeaseSha256 = parsedArgs.authorizedLeaseSha256;
const publicationEpoch = parsedArgs.publicationEpoch;
const sourceRoot = resolve(parsedArgs.sourceCheckout ?? root);
const proofHarnessRevision = parsedArgs.proofHarnessRevision;

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
  const candidatePrefix = ledgerNameGeneration(ledger.scopePreset).prefix;
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
  const server = createServer(async (request, response) => {
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
      // The staged loopback registry is authoritative only for the ledger's
      // immutable candidate closure. The terminal @expo scope also contains
      // genuinely public packages (expo, @expo/cli, ...) that packed fixtures
      // legitimately depend on; the scope-wide .npmrc routing sends those
      // packument reads here, so they forward read-only to the public
      // registry. Candidate-family names stay fail-closed: a staged proof
      // must never substitute a public artifact for an absent candidate.
      if (name.startsWith(candidatePrefix) || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found', reason: `staged package ${name} is absent` }));
        return;
      }
      try {
        const upstream = await fetch(`${PUBLIC_NPM_REGISTRY}/${pathname.slice(1)}`, {
          headers: { accept: request.headers.accept ?? 'application/json' },
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          error: 'bad_gateway',
          reason: `public registry passthrough failed for ${name}`,
        }));
      }
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
    detached: process.platform !== 'win32',
    // Watch mode owns a machine-readable stdin control channel. Keep it open
    // for the proof lifetime: EOF is intentionally interpreted as "stop".
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
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
    const cleanup = await stopOwnedProcessTree(child, {
      requestGracefulStop: () => {
        if (child.exitCode === null) child.kill('SIGINT');
      },
    });
    if (!cleanup.ok) {
      throw new Error(`packaged managed-dev cleanup failed: ${JSON.stringify(cleanup)}`);
    }
  }
  if (existsSync(readyFile)) fail('managed dev stop left a stale ready-file descriptor');
  return { readyFile, database };
}

function assertStarterAcceptanceReceipt(output, label) {
  const line = String(output).trim().split('\n').findLast((candidate) => candidate.trim().startsWith('{'));
  let receipt;
  try {
    receipt = JSON.parse(line ?? '');
  } catch {
    fail(`${label} emitted no parseable starter acceptance receipt`);
  }
  if (
    receipt.schemaVersion !== 'snapback.starter-acceptance.v1'
    || receipt.status !== 'passed'
    || !Number.isSafeInteger(receipt.expectedCheckCount)
    || receipt.expectedCheckCount <= 0
    || receipt.executedCheckCount !== receipt.expectedCheckCount
    || receipt.checks?.length !== receipt.expectedCheckCount
    || receipt.checks.some(({ status }) => status !== 'passed')
    || typeof receipt.identity?.artifact?.appId !== 'string'
    || receipt.identity?.loaded?.appId !== receipt.identity.artifact.appId
    || receipt.identity?.loaded?.bundleHash !== receipt.identity.artifact.bundleHash
    || receipt.lifecycle?.owned !== true
    || receipt.lifecycle?.applicationReadyObserved !== true
    || receipt.lifecycle?.waitLevel !== 'application'
    || receipt.lifecycle?.firstQueryRetries !== 0
    || typeof receipt.operations?.queryFunctionId !== 'string'
    || typeof receipt.operations?.mutationFunctionId !== 'string'
    || receipt.cleanup?.attempted !== true
    || receipt.cleanup?.clientResourcesReleased !== true
    || receipt.cleanup?.devExited !== true
    || receipt.cleanup?.temporaryStateRemoved !== true
    || receipt.cleanup?.ok !== true
    || receipt.diagnostic !== null
  ) {
    fail(`${label} emitted an invalid starter acceptance receipt: ${JSON.stringify(receipt)}`);
  }
  return receipt;
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
    let transferBytes = 0;
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
      const output = [];
      for (let offset = 0; offset < bytes.byteLength; offset += 24 * 1024) {
        const chunk = bytes.subarray(offset, offset + 24 * 1024);
        let binary = '';
        for (let inner = 0; inner < chunk.byteLength; inner += 0x8000) {
          binary += String.fromCharCode(...chunk.subarray(inner, inner + 0x8000));
        }
        output.push(btoa(binary));
      }
      return output.join('');
    };
    const renderBoundedJson = (value) => {
      const chunks = [];
      let pending = '';
      let pendingBytes = 0;
      let renderedBytes = 0;
      const flush = () => {
        if (pending.length === 0) return;
        renderedBytes += pendingBytes;
        chunks.push(pending);
        pending = '';
        pendingBytes = 0;
      };
      const append = (text) => {
        for (let offset = 0; offset < text.length; offset += 64 * 1024) {
          const part = text.slice(offset, offset + 64 * 1024);
          if (pending.length + part.length > 64 * 1024) flush();
          const partBytes = encoder.encode(part).byteLength;
          if (renderedBytes + pendingBytes + partBytes > maxSurfaceBytes) {
            throw new Error('browser storage metadata exceeded its scan bound');
          }
          pending += part;
          pendingBytes += partBytes;
        }
      };
      const renderString = (text) => {
        append('"');
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(text.length, offset + 32 * 1024);
          if (
            end < text.length
            && text.charCodeAt(end - 1) >= 0xd800
            && text.charCodeAt(end - 1) <= 0xdbff
          ) {
            end += 1;
          }
          append(JSON.stringify(text.slice(offset, end)).slice(1, -1));
          offset = end;
        }
        append('"');
      };
      const render = (current) => {
        if (typeof current === 'string') return renderString(current);
        if (current === null || typeof current === 'boolean') return append(String(current));
        if (typeof current === 'number') {
          return append(Number.isFinite(current) ? String(current) : 'null');
        }
        if (Array.isArray(current)) {
          append('[');
          current.forEach((entry, index) => {
            if (index > 0) append(',');
            render(entry);
          });
          append(']');
          return;
        }
        append('{');
        let index = 0;
        for (const key of Object.keys(current)) {
          if (typeof current[key] === 'undefined') continue;
          if (index > 0) append(',');
          renderString(key);
          append(':');
          render(current[key]);
          index += 1;
        }
        append('}');
      };
      render(value);
      flush();
      return chunks.join('');
    };
    const addText = (kind, text) => {
      assertSurfaceSlot();
      if (text.length > maxSurfaceBytes) {
        throw new Error('browser storage text exceeded its scan bound');
      }
      let byteLength = 0;
      for (let offset = 0; offset < text.length; offset += 64 * 1024) {
        byteLength += encoder.encode(text.slice(offset, offset + 64 * 1024)).byteLength;
        if (byteLength > maxSurfaceBytes) {
          throw new Error('browser storage text exceeded its scan bound');
        }
      }
      admitBytes(byteLength);
      transferBytes += byteLength;
      if (transferBytes > maxTotalBytes) {
        throw new Error('browser storage transfer exceeded its aggregate bound');
      }
      surfaces.push({ kind, text });
    };
    const addBinary = (kind, bytes) => {
      assertSurfaceSlot();
      admitBytes(bytes.byteLength);
      const encodedLength = Math.ceil(bytes.byteLength / 3) * 4;
      if (encodedLength > maxSurfaceBytes || encodedLength > maxTotalBytes - transferBytes) {
        throw new Error('browser storage binary transfer exceeded its bound');
      }
      transferBytes += encodedLength;
      surfaces.push({ kind, base64: encodeBase64(bytes) });
    };
    const addStructured = (kind, value) => addText(kind, renderBoundedJson(value));
    const boundedHeaderEntries = (headers, label) => {
      const entries = [];
      let textCodeUnits = 0;
      for (const [name, value] of headers.entries()) {
        if (entries.length >= maxProperties) {
          throw new Error(`${label} exceeded its property bound`);
        }
        if (
          name.length > maxSurfaceBytes - textCodeUnits
          || value.length > maxSurfaceBytes - textCodeUnits - name.length
        ) {
          throw new Error(`${label} exceeded its text bound`);
        }
        textCodeUnits += name.length + value.length;
        entries.push([name, value]);
      }
      return entries;
    };
    const countEntry = () => {
      storageEntries += 1;
      if (storageEntries > maxEntries) {
        throw new Error('browser storage entry count exceeded its scan bound');
      }
    };
    const normalizeReadableValue = async (value, state, depth = 0) => {
      state.nodes += 1;
      const assertRecordEnvelope = () => {
        const upperBound = (
          state.binaryBytes
          + state.textCodeUnits * 6
          + (state.nodes + state.properties) * 128
        );
        if (upperBound > maxSurfaceBytes) {
          throw new Error('IndexedDB record exceeded its pre-materialization bound');
        }
      };
      const chargeString = (text) => {
        if (text.length > maxSurfaceBytes - state.textCodeUnits) {
          throw new Error('IndexedDB text exceeded its pre-materialization bound');
        }
        state.textCodeUnits += text.length;
        assertRecordEnvelope();
        return text;
      };
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
        assertRecordEnvelope();
      };
      if (typeof value === 'string') return chargeString(value);
      if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
      if (typeof value === 'undefined') return { $type: 'undefined' };
      if (typeof value === 'bigint') {
        return { $type: 'bigint', value: chargeString(value.toString()) };
      }
      if (typeof value === 'symbol') {
        return { $type: 'symbol', value: chargeString(value.description ?? '') };
      }
      if (value instanceof Date) {
        return { $type: 'date', value: chargeString(value.toISOString()) };
      }
      if (value instanceof RegExp) {
        return {
          $type: 'regexp',
          source: chargeString(value.source),
          flags: chargeString(value.flags),
        };
      }
      if (value instanceof URL) return { $type: 'url', value: chargeString(value.href) };
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
        assertRecordEnvelope();
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
        assertRecordEnvelope();
        state.binaryParts.push(bytes);
        return {
          $type: 'blob',
          byteLength: bytes.byteLength,
          contentType: chargeString(value.type),
          part: state.binaryParts.length - 1,
        };
      }
      if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) {
        const metadata = {
          $type: 'crypto-key',
          algorithm: await normalizeReadableValue(value.algorithm, state, depth + 1),
          extractable: value.extractable,
          type: chargeString(value.type),
          usages: await normalizeReadableValue(value.usages, state, depth + 1),
        };
        if (value.extractable) {
          try {
            metadata.exportedJwk = await normalizeReadableValue(
              await crypto.subtle.exportKey('jwk', value),
              state,
              depth + 1,
            );
          } catch (error) {
            if (error?.message?.includes('bound')) throw error;
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
        const renderedKey = chargeString(
          typeof key === 'symbol' ? `symbol:${key.description ?? ''}` : key,
        );
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
        $type: typeof value,
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
        textCodeUnits: 0,
      };
      const normalized = await normalizeReadableValue(record, state);
      const text = renderBoundedJson(normalized);
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
      addStructured('cache-metadata', { cacheNames });
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
          addStructured('cache-metadata', {
            cacheName,
            request: {
              url: request.url,
              method: request.method,
              headers: boundedHeaderEntries(request.headers, 'Cache request headers'),
            },
            response: {
              status: response.status,
              statusText: response.statusText,
              headers: boundedHeaderEntries(response.headers, 'Cache response headers'),
            },
          });
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
      addStructured('cache-metadata', { unavailable: true });
    }

    let indexedDbRecordsObserved = 0;
    if ('indexedDB' in globalThis && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      if (databases.length > maxEntries - storageEntries) {
        throw new Error('IndexedDB database count exceeded its scan bound');
      }
      addStructured('indexeddb-metadata', { databases });
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
              if (store.indexNames.length > maxProperties) {
                throw new Error('IndexedDB index names exceeded their property bound');
              }
              const indexNames = [];
              const indexes = [];
              let indexNameCodeUnits = 0;
              for (let indexNumber = 0; indexNumber < store.indexNames.length; indexNumber += 1) {
                const indexName = store.indexNames[indexNumber];
                if (
                  typeof indexName !== 'string'
                  || indexName.length > maxSurfaceBytes - indexNameCodeUnits
                ) {
                  throw new Error('IndexedDB index names exceeded their text bound');
                }
                indexNameCodeUnits += indexName.length;
                indexNames.push(indexName);
                const index = store.index(indexName);
                indexes.push({
                  name: index.name,
                  keyPath: index.keyPath,
                  multiEntry: index.multiEntry,
                  unique: index.unique,
                });
              }
              const storeMetadata = {
                autoIncrement: store.autoIncrement,
                indexNames,
                indexes,
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
            addStructured('indexeddb-metadata', {
              database: descriptor.name,
              version: database.version,
              storeName,
              ...metadata,
              recordCount: keys.length,
            });
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
      addStructured('indexeddb-metadata', { unavailable: true });
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
  const handle = await worker.evaluateHandle(() => globalThis);
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

async function inspectPageState(page) {
  const handle = await page.evaluateHandle((limits) => {
    const encoder = new TextEncoder();
    const snapshot = {
      cookie: '',
      dom: [],
      localStorage: [],
      resourceUrls: [],
      sessionStorage: [],
      userAgent: '',
      windowStrings: [],
    };
    let chargedBytes = 0;
    let properties = 0;
    const chargeText = (text, label) => {
      if (typeof text !== 'string' || text.length > limits.maxBytes - chargedBytes) {
        throw new RangeError(`${label} exceeded the page-state byte bound`);
      }
      for (let offset = 0; offset < text.length; offset += 64 * 1024) {
        chargedBytes += encoder.encode(text.slice(offset, offset + 64 * 1024)).byteLength;
        if (chargedBytes > limits.maxBytes) {
          throw new RangeError(`${label} exceeded the page-state byte bound`);
        }
      }
      return text;
    };
    const chargeProperty = (label) => {
      properties += 1;
      if (properties > limits.maxProperties) {
        throw new RangeError(`${label} exceeded the page-state property bound`);
      }
    };
    snapshot.cookie = chargeText(document.cookie, 'document cookie');
    snapshot.userAgent = chargeText(navigator.userAgent, 'browser user agent');
    const root = document.documentElement;
    if (root) {
      const pending = [{ depth: 0, node: root }];
      let domNodes = 0;
      while (pending.length > 0) {
        const { depth, node } = pending.pop();
        domNodes += 1;
        if (domNodes > limits.maxNodes || depth > limits.maxDepth) {
          throw new RangeError('DOM exceeded the page-state traversal bound');
        }
        chargeProperty('DOM');
        if (node.nodeType === Node.ELEMENT_NODE) {
          const attributes = [];
          if (node.attributes.length > limits.maxProperties - properties) {
            throw new RangeError('DOM attributes exceeded the page-state property bound');
          }
          for (const attribute of node.attributes) {
            chargeProperty('DOM attributes');
            attributes.push([
              chargeText(attribute.name, 'DOM attribute name'),
              chargeText(attribute.value, 'DOM attribute value'),
            ]);
          }
          snapshot.dom.push({
            attributes,
            name: chargeText(node.localName ?? node.nodeName, 'DOM element name'),
            type: 'element',
          });
        } else if (
          node.nodeType === Node.TEXT_NODE
          || node.nodeType === Node.COMMENT_NODE
        ) {
          snapshot.dom.push({
            data: chargeText(node.data, 'DOM character data'),
            type: node.nodeType === Node.TEXT_NODE ? 'text' : 'comment',
          });
        } else {
          snapshot.dom.push({
            name: chargeText(node.nodeName, 'DOM node name'),
            type: 'node',
          });
        }
        const children = [];
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (domNodes + pending.length + children.length >= limits.maxNodes) {
            throw new RangeError('DOM exceeded the page-state traversal bound');
          }
          children.push(child);
        }
        for (let index = children.length - 1; index >= 0; index -= 1) {
          pending.push({ depth: depth + 1, node: children[index] });
        }
      }
    }
    const inspectStorage = (storage, output, label) => {
      if (storage.length > limits.maxProperties - properties) {
        throw new RangeError(`${label} exceeded the page-state property bound`);
      }
      for (let index = 0; index < storage.length; index += 1) {
        chargeProperty(label);
        const key = storage.key(index);
        if (key === null) throw new Error(`${label} changed during inspection`);
        const value = storage.getItem(key);
        output.push([
          chargeText(key, `${label} key`),
          value === null ? null : chargeText(value, `${label} value`),
        ]);
      }
    };
    inspectStorage(localStorage, snapshot.localStorage, 'localStorage');
    inspectStorage(sessionStorage, snapshot.sessionStorage, 'sessionStorage');
    const resources = performance.getEntriesByType('resource');
    if (resources.length > limits.maxProperties - properties) {
      throw new RangeError('resource URLs exceeded the page-state property bound');
    }
    for (const resource of resources) {
      chargeProperty('resource URLs');
      snapshot.resourceUrls.push(chargeText(resource.name, 'resource URL'));
    }
    const globalKeys = Reflect.ownKeys(globalThis);
    if (globalKeys.length > limits.maxProperties - properties) {
      throw new RangeError('window globals exceeded the page-state property bound');
    }
    for (const key of globalKeys) {
      try {
        const value = Reflect.get(globalThis, key);
        if (typeof value !== 'string') continue;
        chargeProperty('window strings');
        snapshot.windowStrings.push([
          chargeText(
            typeof key === 'symbol' ? `symbol:${key.description ?? ''}` : key,
            'window string key',
          ),
          chargeText(value, 'window string value'),
        ]);
      } catch (error) {
        if (error instanceof RangeError) throw error;
      }
    }
    return snapshot;
  }, {
    maxBytes: BROWSER_MAX_SURFACE_BYTES,
    maxDepth: Math.max(BROWSER_MAX_VALUE_DEPTH, 64),
    maxNodes: BROWSER_MAX_VALUE_NODES,
    maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
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
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
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
  const fetchWhenReachable = async (url, label, timeoutMs = 60_000) => {
    const candidates = [new URL(url)];
    if (candidates[0].hostname === 'localhost') {
      for (const hostname of ['127.0.0.1', '[::1]']) {
        const candidate = new URL(url);
        candidate.hostname = hostname;
        candidates.push(candidate);
      }
    }
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        try {
          return { origin: candidate.href, response: await fetch(candidate) };
        } catch (error) {
          lastError = error;
        }
      }
      if (child.exitCode !== null) {
        fail(`${label}: one-command starter exited ${child.exitCode}\n${output()}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    fail(`${label}: timed out (${lastError?.message ?? 'connection refused'})\n${output()}`);
  };
  try {
    await waitFor(
      (text) => text.includes('"state":"client-started"'),
      'one-command starter client arm',
    );
    const announcedOrigin = await waitFor(
      extractViteClientOrigin,
      'one-command starter Vite origin',
    );
    const { origin, response: htmlResponse } = await fetchWhenReachable(
      announcedOrigin,
      'one-command starter HTTP listener',
    );
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
      { kind: 'source-checkout-path', value: realpathSync(sourceRoot) },
      { kind: 'runtime-path', value: realpathSync(runtimePath) },
      { kind: 'secret-read-root-file', value: descriptor.secretReadRootFile },
      {
        kind: 'impersonation-capability-file',
        value: descriptor.impersonationCapabilityFile,
      },
    ].filter(({ value }) => typeof value === 'string' && value.length > 0);

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
      forbiddenMarkers,
      maxSurfaceBytes: BROWSER_MAX_SURFACE_BYTES,
      maxTotalBytes: BROWSER_MAX_TOTAL_BYTES,
      maxSurfaces: BROWSER_MAX_SURFACES,
    });
    const evidenceTasks = createBoundedAsyncTaskPool({
      maxTasks: BROWSER_MAX_ASYNC_TASKS,
      maxConcurrency: BROWSER_MAX_CONCURRENCY,
    });
    const asyncEvidence = [];
    let consoleErrorCount = 0;
    let pageErrorCount = 0;
    const observedWorkers = new Map();
    const networkRequestMethods = new Map();
    const networkResponses = new Map();
    let captureFailure = null;
    let journeyPhase = 'browser-launch';
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
    const captureStructuredSurface = (kind, value) => scheduleEvidence(async () => {
      const rendered = await boundedSerializeBrowserValue(value, {
        maxBytes: BROWSER_MAX_SURFACE_BYTES,
        maxDepth: BROWSER_MAX_VALUE_DEPTH,
        maxNodes: BROWSER_MAX_VALUE_NODES,
        maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
      });
      captureSurface(kind, rendered);
      return true;
    });
    const settleEvidence = async () => {
      let settledTaskCount = -1;
      while (settledTaskCount !== asyncEvidence.length) {
        settledTaskCount = asyncEvidence.length;
        await evidenceTasks.settle();
        await Promise.all(asyncEvidence.slice());
        await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));
      }
      if (captureFailure) throw captureFailure;
    };
    // Bounded in-flight drain: before navigating away (reload) and before
    // asserting completeness, give every response that already has protocol
    // events a chance to finish and be captured, so a navigation does not
    // race the tail of its own page's resource capture. Before a
    // proof-driven navigation only cancel-vulnerable entries matter:
    // stream-captured responses already hold their delivered bytes in
    // proof-owned memory, so canceling them loses nothing.
    const drainNetworkCapture = async ({
      cancelVulnerableOnly = false,
      timeoutMs = 10_000,
    } = {}) => {
      const deadline = Date.now() + timeoutMs;
      const undrained = () => (cancelVulnerableOnly
        ? [...networkResponses.values()].some((response) => response.streamEnabled === null)
        : networkResponses.size > 0);
      await settleEvidence();
      while (undrained() && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
        await settleEvidence();
      }
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
        networkRequestMethods.set(event.requestId, request.method);
        if (event.redirectResponse) {
          responseBodiesObserved += 1;
          captureStructuredSurface('response-metadata', {
            frameId: event.frameId,
            hasExtraInfo: event.redirectHasExtraInfo,
            redirect: true,
            requestId: event.requestId,
            resourceType: event.type,
            response: event.redirectResponse,
          });
          captureSurface('response-body', Buffer.alloc(0));
          responseBodiesScanned += 1;
        }
        captureStructuredSurface('request', {
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
        });
        if (request.hasPostData === true) {
          requestBodiesObserved += 1;
          let contentLength;
          for (const name in request.headers ?? {}) {
            if (
              Object.hasOwn(request.headers, name)
              && name.toLowerCase() === 'content-length'
            ) {
              contentLength = request.headers[name];
              break;
            }
          }
          const declaredBodyBytes = contentLength === undefined
            ? null
            : Number(contentLength);
          if (
            contentLength !== undefined
            && (!/^\d+$/u.test(String(contentLength))
              || declaredBodyBytes > BROWSER_MAX_SURFACE_BYTES)
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
                accumulator.add(decodeBoundedBase64(encoded, 'browser request body entry'));
              }
              bytes = accumulator.finish();
            } else if (typeof request.postData === 'string') {
              boundedUtf8ByteLength(request.postData, 'browser request body');
              bytes = request.postData;
            } else {
              throw new Error(
                'browser protocol omitted post data within its configured cap; completeness unavailable',
              );
            }
            const bodyBytes = typeof bytes === 'string'
              ? boundedUtf8ByteLength(bytes, 'browser request body')
              : bytes.byteLength;
            if (
              (declaredBodyBytes !== null && bodyBytes !== declaredBodyBytes)
              || (declaredBodyBytes === null && bodyBytes >= BROWSER_MAX_SURFACE_BYTES)
            ) {
              throw new Error('browser request body completeness could not be proven');
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
      captureStructuredSurface('request-headers', {
        associatedCookies: event.associatedCookies,
        clientSecurityState: event.clientSecurityState,
        connectTiming: event.connectTiming,
        headers: event.headers,
        requestId: event.requestId,
        siteHasCookieInOtherPartition: event.siteHasCookieInOtherPartition,
      });
    });
    cdp.on('Network.responseReceived', (event) => {
      responseBodiesObserved += 1;
      const response = {
        aborted: false,
        dataEvents: 0,
        decodedDataLength: 0,
        finished: false,
        method: networkRequestMethods.get(event.requestId) ?? null,
        status: event.response.status,
        streamEnabled: null,
        streamParts: [],
        streamPrefix: null,
        url: event.response.url,
      };
      networkResponses.set(event.requestId, response);
      // @ref LLP 0041#acceptance — programmatically consumable responses
      // (fetch/XHR/EventSource) are the ones a page can read as a stream and
      // then cancel before the protocol reports them finished, which would
      // evict the buffer `Network.getResponseBody` reads from. Stream their
      // bytes into proof-owned memory as they arrive, so a later cancel
      // cannot erase what the browser already read.
      if (event.type === 'Fetch' || event.type === 'XHR' || event.type === 'EventSource') {
        response.streamEnabled = cdp.send('Network.streamResourceContent', {
          requestId: event.requestId,
        }).then(
          (result) => {
            if (typeof result?.bufferedData !== 'string') return false;
            response.streamPrefix = result.bufferedData;
            return true;
          },
          () => false,
        );
      }
      captureStructuredSurface('response-metadata', {
        frameId: event.frameId,
        hasExtraInfo: event.hasExtraInfo,
        requestId: event.requestId,
        resourceType: event.type,
        response: event.response,
      });
    });
    cdp.on('Network.responseReceivedExtraInfo', (event) => {
      captureStructuredSurface('response-headers', {
        blockedCookies: event.blockedCookies,
        cookiePartitionKey: event.cookiePartitionKey,
        cookiePartitionKeyOpaque: event.cookiePartitionKeyOpaque,
        exemptedCookies: event.exemptedCookies,
        headers: event.headers,
        headersText: event.headersText,
        requestId: event.requestId,
        resourceIPAddressSpace: event.resourceIPAddressSpace,
        statusCode: event.statusCode,
      });
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
        // Streamed chunks arrive in event order; chunks emitted before the
        // stream enable took effect carry no `data` and are returned by the
        // enable call as its buffered prefix instead.
        if (typeof event.data === 'string' && response.streamEnabled !== null) {
          response.streamParts.push(event.data);
        }
      } catch (error) {
        captureFailure ??= error;
      }
    });
    // Assemble the proof-owned copy of a streamed response: the buffered
    // prefix returned by the stream enable, then every chunk in protocol
    // event order. Returns null when streaming was not enabled (or refused),
    // in which case the caller falls back to `Network.getResponseBody`.
    const assembleStreamedBody = async (response) => {
      if (response.streamEnabled === null) return null;
      const enabled = await response.streamEnabled;
      if (enabled !== true || typeof response.streamPrefix !== 'string') return null;
      const accumulator = createBoundedByteAccumulator({
        label: 'browser streamed response body',
        maxBytes: BROWSER_MAX_SURFACE_BYTES,
        maxChunks: BROWSER_MAX_SURFACES + 1,
      });
      if (response.streamPrefix.length > 0) {
        accumulator.add(
          decodeBoundedBase64(response.streamPrefix, 'browser streamed response body'),
        );
      }
      for (const part of response.streamParts) {
        if (part.length > 0) {
          accumulator.add(decodeBoundedBase64(part, 'browser streamed response body'));
        }
      }
      return accumulator.finish();
    };
    cdp.on('Network.loadingFinished', (event) => {
      const response = networkResponses.get(event.requestId);
      if (!response || response.aborted || response.finished) return;
      response.finished = true;
      scheduleEvidence(async () => {
        const bodyForbidden = (
          response.method === 'HEAD'
          || response.status === 101
          || response.status === 204
          || response.status === 205
          || response.status === 304
          || (response.status >= 300 && response.status < 400)
        );
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
        if (
          !bodyForbidden
          && event.encodedDataLength > 0
          && response.dataEvents === 0
        ) {
          throw new Error(
            `browser protocol omitted response data events; completeness unavailable: ${response.url}`,
          );
        }
        let body = await assembleStreamedBody(response);
        if (body === null) {
          let result;
          try {
            result = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
          } catch (error) {
            if (bodyForbidden) {
              result = { body: '', base64Encoded: false };
            } else {
              throw new Error(
                `could not capture browser-readable response bytes ${response.url}: ${error.message}`,
              );
            }
          }
          if (typeof result.body !== 'string') {
            throw new Error(`browser response body was not text: ${response.url}`);
          }
          body = result.base64Encoded
            ? decodeBoundedBase64(result.body, 'browser response body')
            : result.body;
        }
        const bodyBytes = typeof body === 'string'
          ? boundedUtf8ByteLength(body, 'browser response body')
          : body.byteLength;
        if (bodyBytes !== response.decodedDataLength) {
          throw new Error(
            `browser response body length did not match protocol data events: ${response.url}`,
          );
        }
        captureSurface('response-body', body);
        responseBodiesScanned += 1;
        networkRequestMethods.delete(event.requestId);
        networkResponses.delete(event.requestId);
        return true;
      });
    });
    // @ref LLP 0041#acceptance — a browser-canceled response (navigation or
    // reload aborting an in-flight request, surfaced as `net::ERR_ABORTED`)
    // is tolerated only when every byte the protocol reported as delivered to
    // the browser is still scanned: zero delivered bytes scan as an empty
    // body, delivered bytes must be salvaged in full from the protocol
    // buffer. Any other failure, or an unsalvageable delivered byte, remains
    // a fail-closed refusal — completeness stays proven, not assumed.
    cdp.on('Network.loadingFailed', (event) => {
      const response = networkResponses.get(event.requestId);
      if (!response || response.aborted || response.finished) return;
      response.aborted = true;
      const detail = `${response.method ?? '?'} ${response.url}`
        + ` (status ${response.status}, resource ${event.type ?? 'unknown'},`
        + ` canceled ${event.canceled === true},`
        + ` ${response.dataEvents} data events,`
        + ` ${response.decodedDataLength} delivered bytes,`
        + ` phase ${journeyPhase})`;
      const browserCanceled = event.canceled === true
        || event.errorText === 'net::ERR_ABORTED';
      if (!browserCanceled) {
        captureFailure ??= new Error(
          `browser response failed before complete capture: ${event.errorText} ${detail}`,
        );
        return;
      }
      scheduleEvidence(async () => {
        let body = '';
        if (response.dataEvents > 0 || response.decodedDataLength > 0) {
          body = await assembleStreamedBody(response);
          if (body === null) {
            let result;
            try {
              result = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
            } catch (error) {
              throw new Error(
                'browser canceled a response after delivering bytes it no longer serves:'
                + ` ${detail}: ${error.message}`,
              );
            }
            if (typeof result.body !== 'string') {
              throw new Error(`browser canceled response body was not text: ${detail}`);
            }
            body = result.base64Encoded
              ? decodeBoundedBase64(result.body, 'browser canceled response body')
              : result.body;
          }
          const bodyBytes = typeof body === 'string'
            ? boundedUtf8ByteLength(body, 'browser canceled response body')
            : body.byteLength;
          if (bodyBytes < response.decodedDataLength) {
            throw new Error(
              'browser canceled response bytes were incomplete'
              + ` (${bodyBytes} < ${response.decodedDataLength}): ${detail}`,
            );
          }
        }
        console.error(
          'snapback-package-cold-install: scanned and tolerated a browser-canceled'
          + ` response (${event.errorText}) ${detail}`,
        );
        captureSurface('response-body', body);
        responseBodiesScanned += 1;
        networkRequestMethods.delete(event.requestId);
        networkResponses.delete(event.requestId);
        return true;
      });
    });
    page.on('console', (message) => {
      try {
        consoleMessagesObserved += 1;
        if (consoleMessagesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser console message count exceeded its bound');
        }
        if (message.type() === 'error') consoleErrorCount += 1;
        captureStructuredSurface('console', {
          location: message.location(),
          type: message.type(),
        });
        const argumentsList = message.args();
        consoleArgumentsObserved += argumentsList.length;
        if (consoleArgumentsObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser console argument count exceeded its bound');
        }
        for (const argument of argumentsList) {
          scheduleEvidence(async () => {
            try {
              const rendered = await argument.evaluate(boundedSerializeBrowserValue, {
                maxBytes: BROWSER_MAX_SURFACE_BYTES,
                maxDepth: BROWSER_MAX_VALUE_DEPTH,
                maxNodes: BROWSER_MAX_VALUE_NODES,
                maxProperties: BROWSER_MAX_VALUE_PROPERTIES,
              });
              captureSurface('console-arg', rendered);
              consoleArgumentsScanned += 1;
              return true;
            } finally {
              await argument.dispose();
            }
          });
        }
      } catch (error) {
        captureFailure ??= error;
      }
    });
    page.on('pageerror', (error) => {
      try {
        pageErrorCount += 1;
        if (pageErrorCount > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser page error count exceeded its bound');
        }
        captureStructuredSurface('page-error', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
      } catch (captureError) {
        captureFailure ??= captureError;
      }
    });
    cdp.on('Network.webSocketCreated', (event) => {
      captureStructuredSurface('websocket-url', event);
    });
    cdp.on('Network.webSocketWillSendHandshakeRequest', (event) => {
      try {
        webSocketHandshakesObserved += 1;
        if (webSocketHandshakesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser WebSocket handshake count exceeded its bound');
        }
        captureStructuredSurface('websocket-handshake-request', event);
      } catch (error) {
        captureFailure ??= error;
      }
    });
    cdp.on('Network.webSocketHandshakeResponseReceived', (event) => {
      captureStructuredSurface('websocket-handshake-response', event).then((result) => {
        if (result === true) webSocketHandshakesScanned += 1;
      });
    });
    cdp.on('Network.webSocketFrameReceived', (event) => {
      try {
        webSocketFramesObserved += 1;
        if (webSocketFramesObserved > BROWSER_MAX_ASYNC_TASKS) {
          throw new RangeError('browser WebSocket frame count exceeded its bound');
        }
        liveFrames += 1;
        if (typeof event.response.payloadData !== 'string') {
          throw new Error('browser WebSocket frame omitted payload text');
        }
        const payload = event.response.opcode === 2
          ? decodeBoundedBase64(
            event.response.payloadData,
            'browser WebSocket received frame',
          )
          : event.response.payloadData;
        if (typeof payload === 'string') {
          boundedUtf8ByteLength(payload, 'browser WebSocket received frame');
        }
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
        if (typeof event.response.payloadData !== 'string') {
          throw new Error('browser WebSocket frame omitted payload text');
        }
        const payload = event.response.opcode === 2
          ? decodeBoundedBase64(event.response.payloadData, 'browser WebSocket sent frame')
          : event.response.payloadData;
        if (typeof payload === 'string') {
          boundedUtf8ByteLength(payload, 'browser WebSocket sent frame');
        }
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
      journeyPhase = 'initial-load';
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Snapback todos' }).waitFor();
      await page.getByText('Connection: live', { exact: true }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Build with Snapback' }).waitFor();
      const initialSeededTodoCount = await page.getByRole('listitem').count();
      if (initialSeededTodoCount !== 1) {
        fail(`real browser expected one seeded todo, observed ${initialSeededTodoCount}`);
      }
      await settleEvidence();

      journeyPhase = 'mutation';
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
      await drainNetworkCapture({ cancelVulnerableOnly: true });

      journeyPhase = 'reload';
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('Connection: live', { exact: true }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Build with Snapback' }).waitFor();
      await page.getByRole('listitem').filter({ hasText: 'Todo 2' }).waitFor();
      const reloadedTodoCount = await page.getByRole('listitem').count();
      if (reloadedTodoCount !== 2) {
        fail(`real browser reload did not preserve the mutation: ${reloadedTodoCount} todos`);
      }

      journeyPhase = 'inspection';
      captureSurface('page-state', await inspectPageState(page));
      for (const worker of page.workers()) observeWorker(worker, 'worker-state');
      for (const worker of context.serviceWorkers()) {
        observeWorker(worker, 'service-worker-state');
      }
      const workerResults = await Promise.all(
        [...observedWorkers.values()].map(({ inspection }) => inspection),
      );
      await drainNetworkCapture();
      if (networkResponses.size !== 0) {
        throw new Error(
          `browser response capture remained incomplete for ${networkResponses.size} resources: `
          + [...networkResponses.values()]
            .map(({ method, url }) => `${method ?? '?'} ${url}`)
            .join(', '),
        );
      }
      const storageInspection = await inspectBrowserStorage(page);
      for (const surface of storageInspection.surfaces) {
        captureSurface(
          surface.kind,
          Object.hasOwn(surface, 'text')
            ? surface.text
            : decodeBoundedBase64(surface.base64, `browser storage ${surface.kind}`),
        );
      }
      if (captureFailure) {
        throw captureFailure;
      }
      const leaks = surfaceCollector.findLeaks();
      if (leaks.length > 0) {
        fail(`real browser exposed private marker classes: ${leaks.join(', ')}`);
      }
      if (consoleErrorCount > 0 || pageErrorCount > 0) {
        fail(
          `real browser emitted ${consoleErrorCount} console errors`
          + ` and ${pageErrorCount} page errors`,
        );
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
        materializationBoundary: {
          cdpEventMaterialization: 'not-bounded-by-this-proof',
          chromiumInternalMaterialization: 'not-bounded-by-this-proof',
          proofInvokedHostCollectionApis: [
            ...BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
          ],
          proofInvokedHostCollectionResults:
            'post-return-bounded-not-pre-allocation-bounded',
          proofOwnedCopiesAndEncodings: 'bounded-before-allocation-after-host-return',
          requestPostDataProtocolCapBytes: BROWSER_MAX_SURFACE_BYTES,
          resourceProtocolCapBytes: BROWSER_MAX_SURFACE_BYTES,
          totalResourceProtocolCapBytes: BROWSER_MAX_TOTAL_BYTES,
          unprovableCompletenessPolicy: 'fail-closed',
        },
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
    const cleanup = await stopOwnedProcessTree(child);
    if (!cleanup.ok) {
      throw new Error(`one-command starter cleanup failed: ${JSON.stringify(cleanup)}`);
    }
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
const proofHarnessIdentity = measureGitCheckoutIdentity(root);
const sourceIdentity = measureGitCheckoutIdentity(sourceRoot);
if (sourceIdentity.revision !== ledger.revision) {
  fail(
    `measured source checkout HEAD ${sourceIdentity.revision} does not match ledger revision ${ledger.revision}`,
  );
}
if (sourceIdentity.dirty) {
  fail('cold-install qualification refuses a dirty measured source checkout');
}
if (proofHarnessIdentity.dirty) {
  fail('cold-install qualification refuses a dirty measured proof harness');
}
if (proofHarnessRevision === null) {
  if (sourceRoot !== root || proofHarnessIdentity.revision !== sourceIdentity.revision) {
    fail('cold-install proof omitted its separate proof-harness revision');
  }
} else {
  if (
    sourceRoot === root
    || realpathSync(sourceRoot) === realpathSync(root)
    || proofHarnessIdentity.revision !== proofHarnessRevision
  ) {
    fail('cold-install proof harness/source-checkout binding drifted');
  }
  if (
    process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_SHA !== proofHarnessIdentity.revision
  ) {
    fail('cold-install proof harness differs from the GitHub workflow head');
  }
}
const ledgerDirectory = dirname(ledgerPath);
const dependencies = { react: '19.2.3', esbuild: '0.28.1' };
// The proof follows the ledger's name generation: terminal @expo/snapback
// identity closures, or recorded legacy @snapback/* alias closures
// (decision-9 lineage).
const generation = ledgerNameGeneration(ledger.scopePreset);
const runtimePackages = new Map([
  ['darwin-arm64', generation.platformRuntimes[0]],
  ['linux-x64', generation.platformRuntimes[1]],
]);
const hostPlatform = `${process.platform}-${process.arch}`;
const hostRuntime = runtimePackages.get(hostPlatform);
if (!hostRuntime) fail(`cold-install proof has no runtime package for ${hostPlatform}`);
const hasExpoPackage = generation.expo !== undefined
  && Boolean(ledger.packages?.some((entry) => entry.sourceName === generation.expo));
const hasUmbrellaPackage = generation.umbrella !== undefined
  && Boolean(ledger.packages?.some(
    (entry) => entry.sourceName === generation.umbrella,
  ));
const hasCreateSnapbackAppPackage = generation.createSnapbackApp !== undefined
  && Boolean(ledger.packages?.some(
    (entry) => entry.sourceName === generation.createSnapbackApp,
  ));
// The Expo package selects the applicable terminal-name generation; the new
// creator row distinguishes post-change ledgers from the published 0.1.11
// identity closure, whose CLI predates this scaffold proof.
const proveExpoChatScaffold = hasExpoPackage && hasCreateSnapbackAppPackage;
const allExpectedPackages = [
  ...runtimePackages.values(),
  generation.contract,
  generation.client,
  generation.codegen,
  generation.vite,
  generation.react,
  ...(hasUmbrellaPackage ? [generation.umbrella] : []),
  ...(hasExpoPackage ? [generation.expo] : []),
  generation.appCli,
  generation.cli,
  ...(hasCreateSnapbackAppPackage ? [generation.createSnapbackApp] : []),
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
  dependencies[generation.cli] = generation.scopePreset === 'ccheever'
    ? `npm:${generation.publishedCli}@latest`
    : 'latest';
} else {
  Object.assign(dependencies, exactDependencies);
}

const expectedPackages = [
  hostRuntime,
  generation.contract,
  generation.client,
  generation.codegen,
  generation.vite,
  generation.react,
  ...(hasUmbrellaPackage ? [generation.umbrella] : []),
  ...(hasExpoPackage ? [generation.expo] : []),
  generation.appCli,
  generation.cli,
  ...(hasCreateSnapbackAppPackage ? [generation.createSnapbackApp] : []),
];
for (const name of expectedPackages) {
  if (!exactDependencies[name]) fail(`publication closure omits ${name}`);
}

const temporary = mkdtempSync(join(tmpdir(), 'snapback-package-cold-'));
const registryTarballs = [];
const packedArtifactPaths = new Map();
if (installSource === 'staged') {
  for (const entry of ledger.packages ?? []) {
    packedArtifactPaths.set(entry.sourceName, join(ledgerDirectory, entry.tarball));
  }
}
if (installSource === 'public') {
  const downloadRoot = join(temporary, 'registry-tarballs');
  const exactDownloadCache = join(temporary, 'npm-cache-exact-downloads');
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
      '--cache', exactDownloadCache,
      '--prefer-online',
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
    packedArtifactPaths.set(sourceName, downloaded);
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
    `registry=${PUBLIC_NPM_REGISTRY}\n${generation.publishedScope}:registry=${installRegistry}\n`,
  );
  // Materialize the real Partitime backend source into the external checkout.
  // From this point onward the proof runs only against that copy and tarballs.
  for (const file of ['schema.mjs', 'functions.mjs', 'seed.json']) {
    cpSync(
      join(sourceRoot, 'demos', 'partiful-matrix', 'snapback', file),
      join(backendRoot, file),
    );
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
import { generate } from '${generation.codegen}';
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
import { createMemorySnapbackClientStore } from '${generation.contract}';
import { SnapbackClient } from '${generation.client}';
import { useSnapbackQuery } from '${generation.react}';
globalThis.__snapbackPackageProof = [createMemorySnapbackClientStore, SnapbackClient, useSnapbackQuery];
`);
  if (hasUmbrellaPackage) {
    writeFileSync(join(appRoot, 'umbrella-entrypoints.mjs'), `
import * as react from '${generation.umbrella}/react';
import * as server from '${generation.umbrella}/server';
import * as values from '${generation.umbrella}/values';
if (typeof react.SnapbackProvider !== 'function') throw new Error('umbrella /react missing');
if (typeof server.defineSchema !== 'function') throw new Error('umbrella /server missing');
if (!Object.hasOwn(values, 'v')) throw new Error('umbrella /values missing');
`);
  }
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
  let latestRootResolution = null;
  let latestRootPropagation = null;
  let latestWinningCache = null;
  if (rootSelector === 'latest') {
    const operationId = process.env.SNAPBACK_PROOF_OPERATION_ID;
    if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(operationId ?? '')) {
      fail('latest-root proof requires a closed propagation operation id');
    }
    if (
      expectedPriorRootVersion === ledger.version
      || !/^[0-9a-f]{64}$/u.test(ledger.candidateLedgerSha256 ?? '')
    ) {
      fail('latest-root proof prior/candidate identity is not retry-safe');
    }
    const propagationStartedAtMs = Date.now();
    const propagationDeadlineMs =
      propagationStartedAtMs + LATEST_ROOT_PROPAGATION_WALL_BOUND_MS;
    const propagationAttempts = [];
    for (
      let attempt = 1;
      attempt <= LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const attemptStartedAtMs = Date.now();
      const remainingMs = propagationDeadlineMs - attemptStartedAtMs;
      if (remainingMs < 1_000) {
        fail('latest-root propagation exhausted its wall-clock budget');
      }
      rmSync(join(appRoot, 'node_modules'), { recursive: true, force: true });
      rmSync(join(appRoot, 'package-lock.json'), { force: true });
      const cacheNonce = randomBytes(32).toString('hex');
      const attemptCache = join(
        temporary,
        `npm-cache-latest-${attempt}-${cacheNonce}`,
      );
      const cacheIdentitySha256 = sha256Hex(Buffer.from(cacheNonce));
      const installTimeoutMs = Math.min(
        LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
        remainingMs,
      );
      try {
        await runAsync('npm', [
          'install',
          '--no-audit',
          '--no-fund',
          '--ignore-scripts',
          '--prefer-online',
          '--registry', PUBLIC_NPM_REGISTRY,
          '--cache', attemptCache,
          ...tarballs,
        ], {
          cwd: appRoot,
          timeout: installTimeoutMs,
        });
      } catch (error) {
        fail(`latest-root resolver failed terminally: ${error.message}`);
      }
      let latestTree;
      try {
        latestTree = JSON.parse(run('npm', ['ls', '--all', '--json'], {
          cwd: appRoot,
          timeout: Math.min(
            LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
            Math.max(1_000, propagationDeadlineMs - Date.now()),
          ),
        }));
      } catch (error) {
        fail(`latest-root npm tree failed terminally: ${error.message}`);
      }
      const tagVector = {};
      for (const entry of ledger.packages) {
        const tags = JSON.parse(run('npm', [
          'view',
          entry.name,
          'dist-tags',
          '--json',
          '--registry',
          registry,
          '--cache',
          attemptCache,
          '--prefer-online',
        ], {
          cwd: appRoot,
          timeout: Math.min(
            LATEST_ROOT_PROPAGATION_ATTEMPT_TIMEOUT_MS,
            Math.max(1_000, propagationDeadlineMs - Date.now()),
          ),
        }));
        tagVector[entry.name] = tags.latest ?? null;
      }
      let observation;
      try {
        observation = classifyLatestRootObservation({
          tree: latestTree,
          ledger,
          hostRuntime,
          tagVector,
          expectedPriorRootVersion,
        });
      } catch (error) {
        fail(`latest-root observation refused terminally: ${error.message}`);
      }
      const attemptCompletedAtMs = Date.now();
      propagationAttempts.push({
        attempt,
        startedAt: new Date(attemptStartedAtMs).toISOString(),
        completedAt: new Date(attemptCompletedAtMs).toISOString(),
        durationMs: attemptCompletedAtMs - attemptStartedAtMs,
        installTimeoutMs,
        cacheIdentitySha256,
        rootVersion: observation.rootVersion,
        classification: observation.classification,
        npmTreeSha256: sha256Hex(canonicalJcs(latestTree)),
        tagVectorSha256: sha256Hex(canonicalJcs(tagVector)),
      });
      if (observation.classification === 'candidate-complete') {
        latestRootResolution = observation.resolution;
        latestWinningCache = attemptCache;
        latestRootPropagation = {
          schemaVersion: 'snapback.latest-root-host-retry.v1',
          authorizedLeaseSha256,
          publicationEpoch,
          operationId,
          platform: hostPlatform,
          candidateLedgerSha256: ledger.candidateLedgerSha256,
          package: generation.publishedCli,
          candidateRootVersion: ledger.version,
          expectedPriorRootVersion,
          registry: PUBLIC_NPM_REGISTRY,
          wallBoundMs: LATEST_ROOT_PROPAGATION_WALL_BOUND_MS,
          maxAttempts: LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS,
          retryDelayMs: LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS,
          cachePolicy: 'unique-empty-per-attempt',
          lifecycleScripts: 'disabled',
          startedAt: new Date(propagationStartedAtMs).toISOString(),
          completedAt: new Date(attemptCompletedAtMs).toISOString(),
          status: 'candidate-complete',
          distinctCacheCount: new Set(
            propagationAttempts.map((row) => row.cacheIdentitySha256),
          ).size,
          attempts: propagationAttempts,
          finalCandidateClosureSha256: sha256Hex(
            canonicalJcs(latestRootResolution),
          ),
        };
        validateLatestRootPropagationWitness({
          witness: latestRootPropagation,
          expectedPriorRootVersion,
          expectedCandidateRootVersion: ledger.version,
          expectedAuthorizedLeaseSha256: authorizedLeaseSha256,
          expectedPublicationEpoch: publicationEpoch,
          expectedCandidateLedgerSha256: ledger.candidateLedgerSha256,
          expectedOperationId: operationId,
          expectedPlatform: hostPlatform,
          latestRootResolution,
        });
        break;
      }
      if (
        attempt === LATEST_ROOT_PROPAGATION_MAX_ATTEMPTS
        || Date.now() + LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS + 1_000
          >= propagationDeadlineMs
      ) {
        fail('latest-root propagation did not converge within its closed bounds');
      }
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, LATEST_ROOT_PROPAGATION_RETRY_DELAY_MS);
      });
    }
    if (latestRootResolution === null || latestRootPropagation === null) {
      fail('latest-root propagation ended without a candidate closure');
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
      '--cache', latestWinningCache,
      '--prefer-online',
    ], {
      cwd: appRoot,
      timeout: 360_000,
    });
    Object.assign(dependencies, exactDependencies);
  } else {
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
      '--cache', join(temporary, 'npm-cache-exact-install'),
      '--prefer-online',
      ...tarballs,
    ], {
      cwd: appRoot,
      timeout: 360_000,
    });
  }
  for (const name of expectedPackages) {
    const installPath = join(appRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installPath) || lstatSync(installPath).isSymbolicLink()) {
      fail(`${name} is not a materialized tarball install`);
    }
  }
  if (hasUmbrellaPackage) {
    run(process.execPath, ['umbrella-entrypoints.mjs'], { cwd: appRoot });
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
  try {
    validateColdInstallAgentDigest(introspection, {
      expectedAppId: 'partitime-external',
      requiredFunctionName: 'createEvent',
    });
  } catch (error) {
    fail(error.message);
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
    ...generation.cli.split('/'),
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
  const comparatorReceipt = readBoundedJsonFile(
    comparatorReceiptPath,
    'packed comparator receipt',
    {
      maxBytes: 2 * 1024 * 1024,
      maxDepth: 16,
      maxNodes: 20_000,
      maxProperties: 20_000,
      maxArrayLength: 2_000,
      maxStringBytes: 256 * 1024,
      maxTotalStringBytes: 2 * 1024 * 1024,
    },
  );
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
    `registry=${PUBLIC_NPM_REGISTRY}\n${generation.publishedScope}:registry=${installRegistry}\n`,
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
  run('npm', ['run', 'test:static'], { cwd: scaffoldRoot });
  assertStarterAcceptanceReceipt(
    run('npm', ['test'], { cwd: scaffoldRoot, timeout: 120_000 }),
    'todo-contract default test',
  );
  run('git', ['init', '--quiet'], { cwd: scaffoldRoot });
  run('git', [
    'add', '.gitignore', 'package.json', 'package-lock.json', 'acceptance.mjs',
    'acceptance.live.mjs', 'acceptance.static.mjs', 'snapback',
  ], { cwd: scaffoldRoot });
  run('git', [
    '-c', 'user.name=Snapback Package Proof',
    '-c', 'user.email=snapback-package-proof@example.invalid',
    'commit', '--quiet', '-m', 'cold install release fixture',
  ], { cwd: scaffoldRoot });
  run('git', ['check-ignore', 'node_modules/.bin/snapback'], { cwd: scaffoldRoot });
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

  // @ref LLP 0114#exact-executable-gate — the React release proof installs
  // materialized package tarballs in fresh web and Expo projects. Repository
  // workspaces and source-tree resolution cannot satisfy this gate.
  const installPackedFixture = async (
    fixtureRoot,
    { realBrowser = false, timeout = 360_000 } = {},
  ) => {
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
      `registry=${PUBLIC_NPM_REGISTRY}\n${generation.publishedScope}:registry=${installRegistry}\n`,
    );
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
      ...tarballs,
    ], {
      cwd: fixtureRoot,
      timeout,
    });
    const fixtureSnapbackPackages = [
      generation.client,
      generation.react,
      generation.vite,
    ].filter((name) => Object.hasOwn(manifest.dependencies ?? {}, name));
    for (const name of fixtureSnapbackPackages) {
      const installed = join(fixtureRoot, 'node_modules', ...name.split('/'));
      if (!existsSync(installed) || lstatSync(installed).isSymbolicLink()) {
        fail(`${fixtureRoot}: ${name} is not a materialized tarball install`);
      }
      const resolved = realpathSync(installed);
      if (
        resolved.startsWith(join(root, 'packages'))
        || resolved.startsWith(join(sourceRoot, 'packages'))
      ) {
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
  const reactManifestAfterInstall = JSON.parse(
    readFileSync(join(reactScaffoldRoot, 'package.json'), 'utf8'),
  );
  if (
    Object.hasOwn(reactManifestAfterInstall.dependencies ?? {}, '@exact/contract')
    || Object.hasOwn(reactManifestAfterInstall.devDependencies ?? {}, '@exact/contract')
    || existsSync(join(reactScaffoldRoot, 'node_modules', '@exact', 'contract'))
  ) {
    fail('React npm-only fixture unexpectedly installed the unavailable @exact/contract package');
  }
  const reactGeneratedRoot = join(reactScaffoldRoot, 'snapback', 'generated');
  const reactArtifactIndex = JSON.parse(
    readFileSync(join(reactGeneratedRoot, 'artifacts.json'), 'utf8'),
  );
  const reactGeneratedTypeScript = reactArtifactIndex.files
    .map(({ path }) => path)
    .filter((path) => path.endsWith('.ts'));
  const exactImportingGeneratedFiles = reactGeneratedTypeScript.filter((path) => (
    /(?:^|\n)\s*import\s+(?:[^'"\n]*?\s+from\s+)?['"]@exact(?:\/[^'"]*)?['"]/u.test(
      readFileSync(join(reactGeneratedRoot, path), 'utf8'),
    )
  ));
  if (
    reactGeneratedTypeScript.some((path) => path.endsWith('.contract-meta.ts'))
    || exactImportingGeneratedFiles.length > 0
    || !reactGeneratedTypeScript.includes('contract/runtime-links.ts')
    || !reactGeneratedTypeScript.includes('contract/listTodos.query.ts')
  ) {
    fail(`React npm-only fixture emitted the wrong Contract output set: ${JSON.stringify({
      exactImportingGeneratedFiles,
      reactGeneratedTypeScript,
    })}`);
  }
  run('npm', ['run', 'typecheck'], { cwd: reactScaffoldRoot });
  run('npm', ['run', 'lint'], { cwd: reactScaffoldRoot });
  run('npm', ['run', 'test:static'], { cwd: reactScaffoldRoot });
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
    sourceIdentity,
  );
  assertStarterAcceptanceReceipt(
    run('npm', ['test'], { cwd: reactScaffoldRoot, timeout: 120_000 }),
    'React starter default test',
  );
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
    || !Object.hasOwn(reactManifest.dependencies ?? {}, generation.vite)
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

  // LLP 0196 T1: the portfolio CRUD scaffold must survive the same packed,
  // out-of-repository install boundary as the foundational React starter.
  const crudScaffoldRoot = join(appRoot, 'crud-dashboard');
  run(
    developerCli,
    ['new', crudScaffoldRoot, '--template', 'crud-dashboard', '--json'],
    { cwd: appRoot },
  );
  await installPackedFixture(crudScaffoldRoot);
  run(
    join(crudScaffoldRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: crudScaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: crudScaffoldRoot });
  run('npm', ['run', 'test:static'], { cwd: crudScaffoldRoot });
  run('npm', ['run', 'build'], { cwd: crudScaffoldRoot });
  const crudGenerated = readFileSync(
    join(crudScaffoldRoot, 'snapback', 'generated', 'functions.manifest.json'),
    'utf8',
  );
  if (
    !crudGenerated.includes('RelationalQuery')
    || !readFileSync(join(crudScaffoldRoot, 'src', 'App.tsx'), 'utf8').includes('optimistic:')
  ) {
    fail('packed CRUD dashboard omitted its relational query or optimistic edit path');
  }

  const expoFixtureRoot = join(appRoot, 'react-expo');
  cpSync(
    join(sourceRoot, 'packages', 'snapback-react', 'fixtures', 'packed-expo'),
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

  // LLP 0196 T2: install, generate, typecheck, statically accept, and export
  // the media portfolio scaffold from materialized package tarballs.
  const mediaScaffoldRoot = join(appRoot, 'media-feed');
  run(
    developerCli,
    ['new', mediaScaffoldRoot, '--template', 'media-feed', '--json'],
    { cwd: appRoot },
  );
  await installPackedFixture(mediaScaffoldRoot, { timeout: 600_000 });
  run(
    join(mediaScaffoldRoot, 'node_modules', '.bin', 'snapback'),
    ['generate', 'snapback', '--json'],
    { cwd: mediaScaffoldRoot, env: { ...process.env, npm_config_offline: 'true' } },
  );
  run('npm', ['run', 'typecheck'], { cwd: mediaScaffoldRoot });
  run('npm', ['run', 'test:static'], { cwd: mediaScaffoldRoot });
  run(
    join(mediaScaffoldRoot, 'node_modules', '.bin', 'expo'),
    ['export', '--platform', 'web', '--output-dir', join(mediaScaffoldRoot, 'dist'), '--clear'],
    { cwd: mediaScaffoldRoot, timeout: 300_000, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' } },
  );
  const mediaFunctions = JSON.parse(
    readFileSync(join(mediaScaffoldRoot, 'snapback', 'generated', 'functions.manifest.json'), 'utf8'),
  );
  if (!mediaFunctions.assetUploadIntents?.some(({ exportedName }) => exportedName === 'feedPhotoUpload')) {
    fail('packed media feed codegen omitted the feedPhotoUpload asset-upload intent from functions.manifest.json');
  }
  const mediaDescriptor = JSON.parse(
    readFileSync(join(mediaScaffoldRoot, 'snapback', 'generated', 'app.descriptor.json'), 'utf8'),
  );
  if (!mediaDescriptor.commands?.publishEntry) {
    fail('packed media feed codegen omitted the publishEntry command from app.descriptor.json');
  }
  if (!existsSync(join(mediaScaffoldRoot, 'dist', 'index.html'))) {
    fail('packed media feed expo web export did not produce dist/index.html');
  }

  // @ref LLP 0186#w2--context-injection-surface-owned-here — exercise the
  // golden-path scaffold through packed artifacts, including its generated
  // LLP 0179 conversation surface and live starter acceptance.
  const provePackedExpoChatScaffold = async (chatRoot, label) => {
    await installPackedFixture(chatRoot, { timeout: 600_000 });
    const chatManifest = JSON.parse(readFileSync(join(chatRoot, 'package.json'), 'utf8'));
    const chatExpoManifest = JSON.parse(readFileSync(join(chatRoot, 'app.json'), 'utf8'));
    if (
      chatManifest.scripts?.web !== 'expo start --web'
      || !chatManifest.scripts?.prove?.startsWith('snapback verify snapback ')
      || !['@expo/metro-runtime', 'react-dom', 'react-native-web'].every(
        (name) => typeof chatManifest.dependencies?.[name] === 'string',
      )
      || JSON.stringify(chatExpoManifest.expo?.platforms) !== JSON.stringify(['ios', 'android', 'web'])
    ) {
      fail(`${label} omitted the proof command or zero-edit Expo web dependency contract`);
    }
    run(
      join(chatRoot, 'node_modules', '.bin', 'snapback'),
      ['generate', 'snapback', '--json'],
      { cwd: chatRoot, env: { ...process.env, npm_config_offline: 'true' } },
    );
    run('npm', ['run', 'typecheck'], { cwd: chatRoot });
    run('npm', ['run', 'test:static'], { cwd: chatRoot });
    assertStarterAcceptanceReceipt(
      run('npm', ['test'], { cwd: chatRoot, timeout: 180_000 }),
      `${label} default test`,
    );
    const appSource = readFileSync(join(chatRoot, 'App.tsx'), 'utf8');
    const chatScreenSource = readFileSync(
      join(chatRoot, 'src', 'screens', 'chat-screen.tsx'),
      'utf8',
    );
    const generatedApiSource = readFileSync(
      join(chatRoot, 'snapback', 'generated', 'api.mjs'),
      'utf8',
    );
    if (
      !appSource.includes('SnapbackExpoProvider')
      || !chatScreenSource.includes('useSurface(')
      || !generatedApiSource.includes('conversation')
    ) {
      fail(`${label} omitted the Expo provider, surface consumer, or generated conversation surface`);
    }
  };

  if (proveExpoChatScaffold) {
    const chatScaffoldRoot = join(appRoot, 'expo-chat');
    run(
      developerCli,
      ['new', chatScaffoldRoot, '--template', 'expo-chat', '--json'],
      { cwd: appRoot },
    );
    await provePackedExpoChatScaffold(chatScaffoldRoot, 'expo-chat');
  }

  if (hasCreateSnapbackAppPackage) {
    const createConsumerRoot = join(temporary, 'create-consumer');
    const createScaffoldRoot = join(createConsumerRoot, 'expo-chat');
    mkdirSync(createConsumerRoot, { recursive: true });
    writeFileSync(join(createConsumerRoot, 'package.json'), `${JSON.stringify({
      name: 'create-snapback-app-clean-consumer',
      version: '1.0.0',
      private: true,
    }, null, 2)}\n`);
    writeFileSync(
      join(createConsumerRoot, '.npmrc'),
      `registry=${PUBLIC_NPM_REGISTRY}\n${generation.publishedScope}:registry=${installRegistry}\n`,
    );
    const createTarball = packedArtifactPaths.get(generation.createSnapbackApp);
    if (!createTarball || !existsSync(createTarball)) {
      fail('create-snapback-app packed artifact is unavailable');
    }
    await runAsyncOrFail('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--registry', PUBLIC_NPM_REGISTRY,
      createTarball,
    ], { cwd: createConsumerRoot, timeout: 360_000 });
    const installedCreatePackage = join(
      createConsumerRoot,
      'node_modules',
      generation.createSnapbackApp,
    );
    if (
      !existsSync(installedCreatePackage)
      || lstatSync(installedCreatePackage).isSymbolicLink()
    ) {
      fail('create-snapback-app is not a materialized tarball install');
    }
    const resolvedCreatePackage = realpathSync(installedCreatePackage);
    if (
      resolvedCreatePackage.startsWith(join(root, 'packages'))
      || resolvedCreatePackage.startsWith(join(sourceRoot, 'packages'))
    ) {
      fail('create-snapback-app resolved back into the repository source tree');
    }
    run(
      join(createConsumerRoot, 'node_modules', '.bin', 'create-snapback-app'),
      [createScaffoldRoot, '--json'],
      { cwd: createConsumerRoot },
    );
    await provePackedExpoChatScaffold(createScaffoldRoot, 'create-snapback-app expo-chat');
  }

  run(process.execPath, ['bundle.mjs'], { cwd: appRoot });
  const browserBundle = readFileSync(join(appRoot, 'dist', 'browser-entry.js'), 'utf8');
  const nodeBuiltinImport = browserBundle.match(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]node:[^'"]+/u,
  );
  if (nodeBuiltinImport) {
    fail(`browser adapter bundle contains a Node builtin import: ${nodeBuiltinImport[0]}`);
  }

  const tree = JSON.parse(run('npm', ['ls', '--all', '--json'], { cwd: appRoot }));
  const {
    cleanMachine,
    easProof,
    githubProof,
    machine: provenanceMachine,
  } = computePublicationReceiptProvenance(process.env);
  const sourceCheckout = {
    headSha: sourceIdentity.revision,
    dirty: sourceIdentity.dirty,
  };
  const proofHarnessCheckout = {
    headSha: proofHarnessIdentity.revision,
    dirty: proofHarnessIdentity.dirty,
  };
  const receipt = {
    schemaVersion: rootSelector === 'latest'
      ? 'snapback.package-cold-install.v2'
      : 'snapback.package-cold-install.v1',
    ok: true,
    claimTreatment: 'checkpoint',
    claimSatisfied: false,
    platformClaimSatisfied: installSource === 'public' && cleanMachine,
    sourceRevision: sourceIdentity.revision,
    sourceDirty: sourceIdentity.dirty,
    sourceCheckout,
    proofHarnessCheckout,
    easProof,
    githubProof,
    publicationMode: ledger.mode,
    publicationLedgerSchema: ledger.schemaVersion,
    publicationTag: ledger.tag,
    candidateLedgerSha256: ledger.candidateLedgerSha256 ?? null,
    installSource,
    rootSelector,
    latestRootResolution,
    ...(rootSelector === 'latest' ? { latestRootPropagation } : {}),
    registry: installSource === 'public' ? registry : 'disposable-loopback',
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    machine: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: osRelease(),
      nodeVersion: process.version,
      runtimePackage: hostRuntime,
      ...provenanceMachine,
      proofHarnessRevision: proofHarnessIdentity.revision,
    },
    packages: ledger.packages.map((entry) => ({
      sourceName: entry.sourceName,
      publishedName: entry.name,
      version: entry.version,
      tarball: entry.tarball,
      sha256: entry.sha256,
      registrySha256: entry.registrySha256 ?? null,
    })),
    comparatorReceipt,
    comparatorReceiptSha256: sha256Hex(canonicalJcs(comparatorReceipt)),
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
      packedReactNpmOnlyGeneratedTypecheckAndLint: true,
      packedReactOneCommandBackendViteJourney:
        managedStarter.relativeBasePath === '/__snapback',
      packedReactRealBrowserSeedLiveReload: true,
      browserPrivateSurfaceAbsence: true,
      packedReactExpoTypecheckAndIosExport: true,
      packedUmbrellaDoorwaysFromTarball: hasUmbrellaPackage,
      packedExpoChatScaffoldTypecheckStaticAndLiveAcceptance: proveExpoChatScaffold,
      packedCreateSnapbackAppScaffoldFromCleanDirectory: hasCreateSnapbackAppPackage,
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
  validateRetainedComparatorReceipt(receipt, {
    sourceRevision: ledger.revision,
    version: ledger.version,
    expectedExecutorPackageNames: comparatorExecutorPackageNames(ledger),
    expectedRuntimeBinarySha256:
      ledger.packages.find((row) => row.sourceName === hostRuntime)?.runtimeBinarySha256,
  });
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) writeFileSync(resolve(receiptPath), rendered);
  process.stdout.write(rendered);
} finally {
  if (stagedRegistry) await stagedRegistry.close();
  if (keep) console.error(`kept ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}
