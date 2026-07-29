import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  lstatSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
  comparatorExecutorPackageNames,
  parseBoundedJsonBytes,
  readBoundedFileBytes,
  readBoundedJsonFile,
  validateColdInstallBrowserEvidence,
  validateCandidateLedger,
  validatePublicationReceiptProvenance,
  validateQualifiedStagingLedger,
  validateRetainedComparatorReceipt,
} from './snapback-publish-core.mjs';

export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';
export {
  BROWSER_PROOF_INVOKED_HOST_COLLECTION_APIS,
  comparatorExecutorPackageNames,
  parseBoundedJsonBytes,
  readBoundedFileBytes,
  readBoundedJsonFile,
  validateColdInstallBrowserEvidence,
  validateRetainedComparatorReceipt,
};

const PLAYWRIGHT_HEADLESS_EXECUTABLE_NAMES = new Set([
  'chrome-headless-shell',
  'chrome-headless-shell.exe',
  'headless_shell',
]);
const DEV_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const DEV_OUTPUT_MAX_LINES = 20_000;
const DEV_OUTPUT_MAX_LINE_BYTES = 1024 * 1024;

/**
 * Read the browser origin only from the package-owned structured dev stream.
 * Vite ANSI escapes are JSON-encoded inside `client-output.line`, so scanning
 * the outer process text for a contiguous URL is not sound.
 *
 * @ref LLP 0041#acceptance — the staged/public cold proof consumes the
 * one-command starter's structured client-arm readiness instead of scraping
 * terminal presentation bytes.
 */
export function extractViteClientOrigin(text) {
  if (typeof text !== 'string') throw new TypeError('dev output must be text');
  if (
    text.length > DEV_OUTPUT_MAX_BYTES
    || Buffer.byteLength(text) > DEV_OUTPUT_MAX_BYTES
  ) {
    throw new RangeError('dev output exceeded its byte bound');
  }
  const lines = text.split(/\r?\n/u);
  if (lines.length > DEV_OUTPUT_MAX_LINES) {
    throw new RangeError('dev output exceeded its line bound');
  }
  for (const rawLine of lines) {
    if (
      rawLine.length > DEV_OUTPUT_MAX_LINE_BYTES
      || Buffer.byteLength(rawLine) > DEV_OUTPUT_MAX_LINE_BYTES
    ) {
      throw new RangeError('dev output line exceeded its byte bound');
    }
    let event;
    try {
      event = JSON.parse(rawLine.trim());
    } catch {
      continue;
    }
    if (
      event?.schemaVersion !== 'snapback.dev.v1'
      || event.state !== 'client-output'
      || event.stream !== 'stdout'
      || typeof event.line !== 'string'
    ) {
      continue;
    }
    const presented = event.line.replaceAll(/\u001b\[[0-9;]*m/gu, '');
    const match = /^[ \t]*➜[ \t]+Local:[ \t]+(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/)[ \t]*$/u
      .exec(presented);
    if (!match) continue;
    let origin;
    try {
      origin = new URL(match[1]);
    } catch {
      continue;
    }
    if (
      origin.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      || !/^\d+$/u.test(origin.port)
      || Number(origin.port) < 1
      || Number(origin.port) > 65_535
      || origin.pathname !== '/'
      || origin.username
      || origin.password
      || origin.search
      || origin.hash
    ) {
      continue;
    }
    return origin.href;
  }
  return null;
}

export function resolveInstalledBrowserExecutable(localBrowserRoot) {
  if (typeof localBrowserRoot !== 'string' || localBrowserRoot.length === 0) {
    throw new TypeError('browser installation root must be a non-empty path');
  }
  const candidates = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (
        entry.isFile()
        && PLAYWRIGHT_HEADLESS_EXECUTABLE_NAMES.has(basename(absolutePath))
      ) {
        candidates.push(absolutePath);
      }
    }
  };
  visit(localBrowserRoot);
  return candidates.length === 1 ? candidates[0] : null;
}

export function resolveInstalledBrowserDistribution(localBrowserRoot) {
  const installationStat = lstatSync(localBrowserRoot);
  if (!installationStat.isDirectory() || installationStat.isSymbolicLink()) return null;
  const executablePath = resolveInstalledBrowserExecutable(localBrowserRoot);
  if (executablePath === null) return null;
  const relativeExecutable = relative(resolve(localBrowserRoot), resolve(executablePath));
  if (
    relativeExecutable === ''
    || relativeExecutable === '..'
    || relativeExecutable.startsWith(`..${sep}`)
  ) {
    return null;
  }
  const [distributionName] = relativeExecutable.split(sep);
  if (!distributionName?.startsWith('chromium_headless_shell-')) return null;
  const distributionRoot = join(localBrowserRoot, distributionName);
  const distributionStat = lstatSync(distributionRoot);
  if (!distributionStat.isDirectory() || distributionStat.isSymbolicLink()) return null;
  const realDistributionRoot = realpathSync(distributionRoot);
  const realExecutablePath = realpathSync(executablePath);
  if (
    realExecutablePath !== realDistributionRoot
    && !realExecutablePath.startsWith(`${realDistributionRoot}${sep}`)
  ) {
    return null;
  }
  return Object.freeze({ distributionRoot, executablePath });
}

function updateFramed(hash, value) {
  const bytes = Buffer.from(String(value));
  hash.update(`${bytes.byteLength}:`);
  hash.update(bytes);
}

async function streamFileSha256(path, expectedStat) {
  const hash = createHash('sha256');
  let observedBytes = 0;
  let file;
  try {
    file = await openFile(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const openedStat = await file.stat();
    if (
      !openedStat.isFile()
      || openedStat.size !== expectedStat.size
      || openedStat.dev !== expectedStat.dev
      || openedStat.ino !== expectedStat.ino
      || (openedStat.mode & 0o7777) !== (expectedStat.mode & 0o7777)
    ) {
      throw new Error('browser evidence file identity changed before hashing');
    }
    for await (const chunk of file.createReadStream({
      autoClose: false,
      highWaterMark: 1024 * 1024,
    })) {
      observedBytes += chunk.byteLength;
      if (observedBytes > expectedStat.size) {
        throw new Error('browser evidence file grew while it was being hashed');
      }
      hash.update(chunk);
    }
    if (observedBytes !== expectedStat.size) {
      throw new Error('browser evidence file changed size while it was being hashed');
    }
  } finally {
    await file?.close();
  }
  return hash.digest('hex');
}

/**
 * Hashes browser-owned support files without materializing a file or tree.
 *
 * @ref LLP 0041#acceptance — the repository-free browser proof binds the
 * exact installed driver and selected Chromium distribution, and refuses
 * unsupported filesystem entries instead of silently omitting them.
 */
export async function digestBoundedBrowserFilesystem({
  domain,
  roots,
  executablePath = null,
  exclude = () => false,
  maxEntries,
  maxTotalBytes,
  maxFileBytes,
}) {
  if (
    typeof domain !== 'string'
    || domain.length === 0
    || !Array.isArray(roots)
    || roots.length === 0
    || !Number.isSafeInteger(maxEntries)
    || maxEntries < 1
    || !Number.isSafeInteger(maxTotalBytes)
    || maxTotalBytes < 1
    || !Number.isSafeInteger(maxFileBytes)
    || maxFileBytes < 1
    || maxFileBytes > maxTotalBytes
  ) {
    throw new TypeError('browser filesystem digest requires closed positive limits');
  }
  const normalizedRoots = roots.map(([logicalRoot, path]) => {
    if (
      typeof logicalRoot !== 'string'
      || logicalRoot.length === 0
      || typeof path !== 'string'
      || path.length === 0
    ) {
      throw new TypeError('browser filesystem roots must be named paths');
    }
    const rootPath = resolve(path);
    const rootStat = lstatSync(rootPath);
    if (!rootStat.isDirectory()) {
      throw new TypeError(`browser filesystem root is not a directory: ${logicalRoot}`);
    }
    if (rootStat.isSymbolicLink()) {
      throw new TypeError(`browser filesystem root is a symlink: ${logicalRoot}`);
    }
    return { logicalRoot, rootPath, realRoot: realpathSync(rootPath) };
  });
  let executableLogicalPath = null;
  if (executablePath !== null) {
    const absoluteExecutable = resolve(executablePath);
    const owner = normalizedRoots.find(({ realRoot }) => {
      const realExecutable = realpathSync(absoluteExecutable);
      return realExecutable !== realRoot && realExecutable.startsWith(`${realRoot}${sep}`);
    });
    if (!owner || !lstatSync(absoluteExecutable).isFile()) {
      throw new TypeError('browser executable is not a contained regular file');
    }
    const executableRelative = relative(owner.rootPath, absoluteExecutable);
    if (
      executableRelative === ''
      || executableRelative === '..'
      || executableRelative.startsWith(`..${sep}`)
    ) {
      throw new TypeError('browser executable escaped its selected distribution');
    }
    executableLogicalPath =
      `${owner.logicalRoot}/${executableRelative.split(sep).join('/')}`;
  }

  const entries = [];
  const visit = (root, directory, relativeDirectory = '') => {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = relativeDirectory === ''
        ? child.name
        : `${relativeDirectory}/${child.name}`;
      if (exclude(root.logicalRoot, relativePath)) continue;
      const absolutePath = join(directory, child.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new TypeError(
          `browser filesystem contains a symlink: ${root.logicalRoot}/${relativePath}`,
        );
      }
      if (stat.isDirectory()) {
        entries.push({
          logicalPath: `${root.logicalRoot}/${relativePath}`,
          path: absolutePath,
          stat,
          type: 'directory',
        });
        visit(root, absolutePath, relativePath);
      } else if (stat.isFile()) {
        entries.push({
          logicalPath: `${root.logicalRoot}/${relativePath}`,
          path: absolutePath,
          stat,
          type: 'file',
        });
      } else {
        throw new TypeError(
          `browser filesystem contains an unsupported entry: ${root.logicalRoot}/${relativePath}`,
        );
      }
      if (entries.length > maxEntries) {
        throw new RangeError(`browser filesystem exceeded the ${maxEntries}-entry bound`);
      }
    }
  };
  for (const root of normalizedRoots) visit(root, root.rootPath);

  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (!Number.isSafeInteger(entry.stat.size) || entry.stat.size < 0) {
      throw new RangeError(`browser file has an unsafe size: ${entry.logicalPath}`);
    }
    if (entry.stat.size > maxFileBytes) {
      throw new RangeError(`browser file exceeded the ${maxFileBytes}-byte bound`);
    }
    totalBytes += entry.stat.size;
    if (totalBytes > maxTotalBytes) {
      throw new RangeError(`browser filesystem exceeded the ${maxTotalBytes}-byte bound`);
    }
  }

  const hash = createHash('sha256');
  hash.update(`${domain}\0`);
  let fileCount = 0;
  let directoryCount = 0;
  let executableSha256 = null;
  let executableBytes = null;
  for (const entry of entries) {
    const mode = entry.stat.mode & 0o7777;
    updateFramed(hash, entry.logicalPath);
    updateFramed(hash, entry.type);
    updateFramed(hash, mode.toString(8).padStart(4, '0'));
    updateFramed(hash, entry.stat.size);
    if (entry.type === 'file') {
      fileCount += 1;
      const contentSha256 = await streamFileSha256(entry.path, entry.stat);
      updateFramed(hash, contentSha256);
      if (entry.logicalPath === executableLogicalPath) {
        executableSha256 = contentSha256;
        executableBytes = entry.stat.size;
      }
    } else {
      directoryCount += 1;
      updateFramed(hash, '-');
    }
  }
  if (executablePath !== null && executableSha256 === null) {
    throw new TypeError('browser executable was not included in its distribution digest');
  }
  return Object.freeze({
    sha256: hash.digest('hex'),
    entryCount: entries.length,
    fileCount,
    directoryCount,
    totalBytes,
    executableSha256,
    executableBytes,
  });
}

export function measureGitCheckoutIdentity(checkoutRoot) {
  if (typeof checkoutRoot !== 'string' || checkoutRoot.length === 0) {
    throw new TypeError('checkout root must be a non-empty path');
  }
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: checkoutRoot,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`could not measure checkout identity: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  };
  const revision = git(['rev-parse', '--verify', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('checkout HEAD is not a full Git revision');
  }
  const status = git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
  return Object.freeze({ revision, dirty: status.length > 0 });
}

export function createBoundedAsyncTaskPool({ maxTasks, maxConcurrency }) {
  if (
    !Number.isSafeInteger(maxTasks)
    || maxTasks < 1
    || !Number.isSafeInteger(maxConcurrency)
    || maxConcurrency < 1
    || maxConcurrency > maxTasks
  ) {
    throw new TypeError('async task pool requires positive task and concurrency bounds');
  }
  const pending = [];
  let admitted = 0;
  let active = 0;
  let peakActive = 0;
  let failure = null;
  const pump = () => {
    while (failure === null && active < maxConcurrency && pending.length > 0) {
      const task = pending.shift();
      active += 1;
      peakActive = Math.max(peakActive, active);
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, (error) => {
          failure ??= error;
          task.reject(error);
          for (const queued of pending.splice(0)) queued.reject(failure);
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return Object.freeze({
    add(run) {
      if (typeof run !== 'function') throw new TypeError('async pool tasks must be functions');
      if (failure !== null) return Promise.reject(failure);
      admitted += 1;
      if (admitted > maxTasks) {
        failure = new RangeError(`async task pool exceeded the ${maxTasks}-task bound`);
        return Promise.reject(failure);
      }
      const promise = new Promise((resolveTask, rejectTask) => {
        pending.push({ run, resolve: resolveTask, reject: rejectTask });
      });
      pump();
      return promise;
    },
    async settle() {
      while (active > 0 || pending.length > 0) {
        await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));
      }
      if (failure !== null) throw failure;
      return Object.freeze({ admitted, peakActive });
    },
    stats() {
      return Object.freeze({ admitted, active, pending: pending.length, peakActive });
    },
  });
}

export function createBoundedByteAccumulator({ label, maxBytes, maxChunks }) {
  if (
    typeof label !== 'string'
    || label.length === 0
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || !Number.isSafeInteger(maxChunks)
    || maxChunks < 1
  ) {
    throw new TypeError('byte accumulator requires a label and positive limits');
  }
  const chunks = [];
  let totalBytes = 0;
  return Object.freeze({
    add(value) {
      if (chunks.length >= maxChunks) {
        throw new RangeError(`${label} exceeded the ${maxChunks}-chunk bound`);
      }
      let bytes;
      if (typeof value === 'string') {
        if (value.length > maxBytes - totalBytes) {
          throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
        }
        const byteLength = Buffer.byteLength(value);
        if (byteLength > maxBytes - totalBytes) {
          throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
        }
        bytes = Buffer.from(value);
      } else {
        const readable = browserSurfaceBytes(value);
        if (readable.byteLength > maxBytes - totalBytes) {
          throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
        }
        bytes = Buffer.from(readable);
      }
      if (bytes.byteLength > maxBytes - totalBytes) {
        throw new RangeError(`${label} exceeded the ${maxBytes}-byte bound`);
      }
      chunks.push(bytes);
      totalBytes += bytes.byteLength;
    },
    finish() {
      return Buffer.concat(chunks, totalBytes);
    },
    size() {
      return Object.freeze({ chunks: chunks.length, totalBytes });
    },
  });
}

export function browserAssetsContainSecretCanary(builtAssets, canary) {
  if (typeof builtAssets !== 'string') {
    throw new TypeError('built browser assets must be text');
  }
  if (typeof canary !== 'string' || canary.length < 32) {
    throw new TypeError('browser secret canary must be an unguessable string');
  }
  return builtAssets.includes(canary);
}

function browserSurfaceBytes(value) {
  if (typeof value === 'string') return Buffer.from(value);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('browser-visible surfaces must contain strings or bytes');
}

/**
 * This function is intentionally self-contained: Playwright serializes its
 * source into page, worker, service-worker, and console-argument realms.
 */
export async function boundedSerializeBrowserValue(value, limits) {
  const {
    maxBytes,
    maxDepth,
    maxNodes,
    maxProperties,
  } = limits ?? {};
  if (
    !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || !Number.isSafeInteger(maxDepth)
    || maxDepth < 1
    || !Number.isSafeInteger(maxNodes)
    || maxNodes < 1
    || !Number.isSafeInteger(maxProperties)
    || maxProperties < 1
  ) {
    throw new TypeError('browser value serializer requires positive closed limits');
  }
  const encoder = new TextEncoder();
  const seen = new Map();
  let chargedBytes = 0;
  let nodes = 0;
  let properties = 0;
  const chargeText = (text) => {
    if (text.length > maxBytes - chargedBytes) {
      throw new RangeError('browser value exceeded its byte bound');
    }
    for (let offset = 0; offset < text.length; offset += 64 * 1024) {
      const chunk = text.slice(offset, offset + 64 * 1024);
      chargedBytes += encoder.encode(chunk).byteLength;
      if (chargedBytes > maxBytes) {
        throw new RangeError('browser value exceeded its byte bound');
      }
    }
    return text;
  };
  const chargeNode = (depth) => {
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError('browser value exceeded its node bound');
    if (depth > maxDepth) throw new RangeError('browser value exceeded its depth bound');
  };
  const chargeProperty = () => {
    properties += 1;
    if (properties > maxProperties) {
      throw new RangeError('browser value exceeded its property bound');
    }
  };
  const base64 = (bytes) => {
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
  const normalize = async (current, depth) => {
    chargeNode(depth);
    if (current === null) return null;
    if (typeof current === 'string') return chargeText(current);
    if (typeof current === 'number' || typeof current === 'boolean') return current;
    if (typeof current === 'undefined') return { $type: 'undefined' };
    if (typeof current === 'bigint') {
      return { $type: 'bigint', value: chargeText(current.toString()) };
    }
    if (typeof current === 'symbol') {
      return { $type: 'symbol', value: chargeText(current.description ?? '') };
    }
    if (current instanceof Date) {
      return { $type: 'date', value: chargeText(current.toISOString()) };
    }
    if (current instanceof RegExp) {
      return {
        $type: 'regexp',
        source: chargeText(current.source),
        flags: chargeText(current.flags),
      };
    }
    if (typeof URL !== 'undefined' && current instanceof URL) {
      return { $type: 'url', value: chargeText(current.href) };
    }
    if (
      current instanceof ArrayBuffer
      || (typeof SharedArrayBuffer !== 'undefined' && current instanceof SharedArrayBuffer)
      || ArrayBuffer.isView(current)
    ) {
      const bytes = current instanceof ArrayBuffer
        || (typeof SharedArrayBuffer !== 'undefined' && current instanceof SharedArrayBuffer)
        ? new Uint8Array(current)
        : new Uint8Array(current.buffer, current.byteOffset, current.byteLength);
      if (bytes.byteLength > maxBytes - chargedBytes) {
        throw new RangeError('browser binary value exceeded its byte bound');
      }
      const encodedBytes = Math.ceil(bytes.byteLength / 3) * 4;
      if (encodedBytes > maxBytes - chargedBytes) {
        throw new RangeError('browser binary encoding exceeded its byte bound');
      }
      chargedBytes += encodedBytes;
      return {
        $type: current.constructor?.name ?? 'bytes',
        byteLength: bytes.byteLength,
        base64: base64(bytes),
      };
    }
    if (typeof Blob !== 'undefined' && current instanceof Blob) {
      if (current.size > maxBytes - chargedBytes) {
        throw new RangeError('browser Blob exceeded its byte bound');
      }
      const bytes = new Uint8Array(await current.arrayBuffer());
      const encodedBytes = Math.ceil(bytes.byteLength / 3) * 4;
      if (encodedBytes > maxBytes - chargedBytes) {
        throw new RangeError('browser Blob encoding exceeded its byte bound');
      }
      chargedBytes += encodedBytes;
      return {
        $type: current.constructor?.name ?? 'blob',
        byteLength: bytes.byteLength,
        contentType: chargeText(current.type),
        base64: base64(bytes),
      };
    }
    if (typeof current !== 'object' && typeof current !== 'function') {
      return { $type: typeof current, value: chargeText(String(current)) };
    }
    if (seen.has(current)) return { $ref: seen.get(current) };
    const identity = seen.size;
    seen.set(current, identity);
    if (Array.isArray(current)) {
      const values = [];
      for (const entry of current) {
        chargeProperty();
        values.push(await normalize(entry, depth + 1));
      }
      return { $id: identity, $type: 'array', values };
    }
    if (current instanceof Map) {
      const entries = [];
      for (const [key, entry] of current.entries()) {
        chargeProperty();
        entries.push([
          await normalize(key, depth + 1),
          await normalize(entry, depth + 1),
        ]);
      }
      return { $id: identity, $type: 'map', entries };
    }
    if (current instanceof Set) {
      const values = [];
      for (const entry of current.values()) {
        chargeProperty();
        values.push(await normalize(entry, depth + 1));
      }
      return { $id: identity, $type: 'set', values };
    }
    if (typeof CryptoKey !== 'undefined' && current instanceof CryptoKey) {
      const output = {
        $id: identity,
        $type: 'crypto-key',
        algorithm: await normalize(current.algorithm, depth + 1),
        extractable: current.extractable,
        keyType: current.type,
        usages: await normalize(current.usages, depth + 1),
      };
      if (current.extractable) {
        try {
          output.exportedJwk = await normalize(
            await crypto.subtle.exportKey('jwk', current),
            depth + 1,
          );
        } catch (error) {
          output.exportRefused = error?.name ?? 'error';
        }
      }
      return output;
    }
    const output = {
      $id: identity,
      $type: typeof current,
      properties: {},
    };
    for (const key of Reflect.ownKeys(current)) {
      chargeProperty();
      const renderedKey = typeof key === 'symbol'
        ? `symbol:${key.description ?? ''}`
        : key;
      chargeText(renderedKey);
      try {
        output.properties[renderedKey] = await normalize(
          Reflect.get(current, key),
          depth + 1,
        );
      } catch (error) {
        if (error instanceof RangeError) throw error;
        output.properties[renderedKey] = {
          $type: 'unreadable',
          name: chargeText(error?.name ?? 'error'),
          message: chargeText(error?.message ?? ''),
        };
      }
    }
    return output;
  };
  const normalized = await normalize(value, 0);
  const renderedChunks = [];
  let renderedBytes = 0;
  let pending = '';
  let pendingBytes = 0;
  const flush = () => {
    if (pending.length === 0) return;
    renderedBytes += pendingBytes;
    renderedChunks.push(pending);
    pending = '';
    pendingBytes = 0;
  };
  const append = (text) => {
    if (text.length > maxBytes - renderedBytes - pendingBytes) {
      throw new RangeError('browser value serialization exceeded its byte bound');
    }
    for (let offset = 0; offset < text.length; offset += 64 * 1024) {
      const part = text.slice(offset, offset + 64 * 1024);
      if (pending.length + part.length > 64 * 1024) flush();
      const partBytes = encoder.encode(part).byteLength;
      if (renderedBytes + pendingBytes + partBytes > maxBytes) {
        throw new RangeError('browser value serialization exceeded its byte bound');
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
  const renderJson = (current) => {
    if (typeof current === 'string') {
      renderString(current);
      return;
    }
    if (current === null || typeof current === 'boolean') {
      append(String(current));
      return;
    }
    if (typeof current === 'number') {
      append(Number.isFinite(current) ? String(current) : 'null');
      return;
    }
    if (Array.isArray(current)) {
      append('[');
      current.forEach((entry, index) => {
        if (index > 0) append(',');
        renderJson(entry);
      });
      append(']');
      return;
    }
    append('{');
    Object.keys(current).forEach((key, index) => {
      if (index > 0) append(',');
      renderString(key);
      append(':');
      renderJson(current[key]);
    });
    append('}');
  };
  renderJson({ normalized, nodes, properties });
  flush();
  return renderedChunks.join('');
}

export function browserForbiddenMarkerVariants({ kind, value } = {}) {
  if (
    typeof kind !== 'string'
    || kind.length === 0
    || typeof value !== 'string'
    || value.length === 0
  ) {
    throw new TypeError('browser forbidden markers must be non-empty kind/value pairs');
  }
  const rawVariants = new Set([value]);
  if (kind === 'backend-origin') {
    let origin;
    try {
      origin = new URL(value);
    } catch {
      throw new TypeError('browser backend origin marker must be an absolute URL');
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(origin.protocol)) {
      throw new TypeError('browser backend origin marker must use HTTP(S) or WS(S)');
    }
    const suffix = `${origin.host}${origin.pathname === '/' ? '' : origin.pathname}`;
    for (const protocol of ['http:', 'https:', 'ws:', 'wss:']) {
      rawVariants.add(`${protocol}//${suffix}`);
    }
    rawVariants.add(`//${suffix}`);
    rawVariants.add(origin.host);
  }
  const variants = new Set();
  for (const variant of rawVariants) {
    variants.add(variant);
    try {
      variants.add(encodeURI(variant));
      variants.add(encodeURIComponent(variant));
    } catch {
      // The exact value remains covered when an unusual string cannot be URI encoded.
    }
    variants.add(JSON.stringify(variant).slice(1, -1));
    variants.add(variant.replaceAll('/', '\\/'));
    variants.add(Buffer.from(variant).toString('base64'));
    variants.add(Buffer.from(variant).toString('base64url'));
  }
  return [...variants].filter((entry) => entry.length > 0);
}

export function findBrowserVisibleLeaks({ surfaces, forbiddenMarkers }) {
  if (!Array.isArray(surfaces)) {
    throw new TypeError('browser-visible surfaces must be an array');
  }
  if (
    !Array.isArray(forbiddenMarkers)
    || forbiddenMarkers.some((marker) => {
      try {
        browserForbiddenMarkerVariants(marker);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError('browser forbidden markers must be non-empty kind/value pairs');
  }
  const visible = surfaces.map(browserSurfaceBytes);
  return [...new Set(
    forbiddenMarkers
      .filter((marker) => browserForbiddenMarkerVariants(marker).some((variant) => {
        const needle = Buffer.from(variant);
        return visible.some((surface) => surface.indexOf(needle) !== -1);
      }))
      .map(({ kind }) => kind),
  )].sort();
}

export function createBoundedBrowserSurfaceCollector({
  forbiddenMarkers,
  maxSurfaceBytes,
  maxTotalBytes,
  maxSurfaces = 10_000,
}) {
  if (
    !Number.isSafeInteger(maxSurfaceBytes)
    || maxSurfaceBytes < 1
    || !Number.isSafeInteger(maxTotalBytes)
    || maxTotalBytes < maxSurfaceBytes
    || !Number.isSafeInteger(maxSurfaces)
    || maxSurfaces < 1
    || !Array.isArray(forbiddenMarkers)
  ) {
    throw new TypeError('browser scan budgets must be positive safe integers');
  }
  const markerEntries = [];
  for (const marker of forbiddenMarkers) {
    for (const variant of browserForbiddenMarkerVariants(marker)) {
      const needle = Buffer.from(variant);
      if (needle.byteLength > 0) markerEntries.push({ kind: marker.kind, needle });
    }
  }
  const maxNeedleBytes = markerEntries.reduce(
    (maximum, { needle }) => Math.max(maximum, needle.byteLength),
    0,
  );
  const manifest = [];
  const leaks = new Set();
  let totalBytesScanned = 0;
  const forEachUtf8Chunk = (text, visit) => {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 64 * 1024);
      if (
        end < text.length
        && end > offset
        && text.charCodeAt(end - 1) >= 0xd800
        && text.charCodeAt(end - 1) <= 0xdbff
      ) {
        end += 1;
      }
      visit(Buffer.from(text.slice(offset, end)));
      offset = end;
    }
  };
  const byteLengthWithinBounds = (value) => {
    if (typeof value === 'string') {
      if (value.length > maxSurfaceBytes) {
        throw new RangeError(`browser surface exceeded the ${maxSurfaceBytes}-byte scan bound`);
      }
      let byteLength = 0;
      forEachUtf8Chunk(value, (chunk) => {
        byteLength += chunk.byteLength;
        if (byteLength > maxSurfaceBytes) {
          throw new RangeError(`browser surface exceeded the ${maxSurfaceBytes}-byte scan bound`);
        }
      });
      return byteLength;
    }
    const bytes = browserSurfaceBytes(value);
    if (bytes.byteLength > maxSurfaceBytes) {
      throw new RangeError(`browser surface exceeded the ${maxSurfaceBytes}-byte scan bound`);
    }
    return bytes.byteLength;
  };
  const forEachSurfaceChunk = (value, visit) => {
    if (typeof value === 'string') {
      forEachUtf8Chunk(value, visit);
      return;
    }
    const bytes = browserSurfaceBytes(value);
    for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
      visit(bytes.subarray(offset, offset + 64 * 1024));
    }
  };
  return Object.freeze({
    add(kind, value) {
      if (typeof kind !== 'string' || kind.length === 0) {
        throw new TypeError('browser surface kind must be non-empty');
      }
      if (manifest.length >= maxSurfaces) {
        throw new RangeError(`browser surfaces exceeded the ${maxSurfaces}-surface bound`);
      }
      const byteLength = byteLengthWithinBounds(value);
      if (totalBytesScanned + byteLength > maxTotalBytes) {
        throw new RangeError(`browser surfaces exceeded the ${maxTotalBytes}-byte aggregate scan bound`);
      }
      const contentHash = createHash('sha256');
      contentHash.update('snapback-browser-surface-v1\0');
      updateFramed(contentHash, manifest.length);
      updateFramed(contentHash, kind);
      updateFramed(contentHash, byteLength);
      let tail = Buffer.alloc(0);
      const surfaceLeaks = new Set();
      forEachSurfaceChunk(value, (chunk) => {
        contentHash.update(chunk);
        if (markerEntries.length === 0) return;
        const searchable = tail.byteLength === 0
          ? chunk
          : Buffer.concat([tail, chunk], tail.byteLength + chunk.byteLength);
        for (const { kind: markerKind, needle } of markerEntries) {
          if (searchable.indexOf(needle) !== -1) surfaceLeaks.add(markerKind);
        }
        const tailBytes = Math.min(
          searchable.byteLength,
          Math.max(0, maxNeedleBytes - 1),
        );
        tail = tailBytes === 0
          ? Buffer.alloc(0)
          : Buffer.from(searchable.subarray(searchable.byteLength - tailBytes));
      });
      for (const markerKind of surfaceLeaks) leaks.add(markerKind);
      manifest.push(Object.freeze({
        kind,
        bytesScanned: byteLength,
        contentSha256: contentHash.digest('hex'),
      }));
      totalBytesScanned += byteLength;
    },
    findLeaks(markers = forbiddenMarkers) {
      if (markers !== forbiddenMarkers) {
        throw new TypeError('browser forbidden markers must be fixed before collection');
      }
      return [...leaks].sort();
    },
    sanitizedSummary() {
      return Object.freeze({
        maxSurfaceBytes,
        maxTotalBytes,
        maxSurfaces,
        totalBytesScanned,
        surfaceManifest: Object.freeze([...manifest]),
      });
    },
  });
}

// @ref LLP 0041#acceptance — the external package proof exposes a closed
// bootstrap surface and fails before it can silently run a different proof.
export const usage = `Usage:
  node scripts/snapback-package-cold-install.mjs [options]

Prove the packaged Snapback closure through either a disposable staged
registry or the public registry, in a fresh external application directory.

Options:
  --ledger <path>   Publication ledger to prove
                    (default: dist-publish/publish-ledger.json)
  --install-source <staged|public>
                    Resolve immutable tarballs from the staged ledger
                    (default) or install the published version from npm
  --registry <url>  Registry used by --install-source public
                    (default: https://registry.npmjs.org)
  --root-selector <exact|latest>
                    Install all exact aliases (default), or first install only
                    @ccheever/snapback-cli@latest and verify its selected
                    closure/default-tag vector before expanding the proof
  --source-checkout <path>
                    Read fixtures from a separate clean checkout at the
                    publication ledger revision
  --proof-harness-revision <sha>
                    Exact clean revision executing the proof when
                    --source-checkout is separate
  --receipt <path>  Write the retained proof receipt to this path
  --keep            Keep the temporary external application directory
  -h, --help        Print this help without staging or installing packages
`;

export function parseArguments(args) {
  if (!Array.isArray(args)) throw new TypeError('arguments must be an array');
  const parsed = {
    help: false,
    ledger: null,
    installSource: 'staged',
    registry: PUBLIC_NPM_REGISTRY,
    receipt: null,
    keep: false,
    rootSelector: 'exact',
    sourceCheckout: null,
    proofHarnessRevision: null,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      if (seen.has('help')) throw new TypeError('duplicate argument: --help');
      seen.add('help');
      parsed.help = true;
      continue;
    }
    if (argument === '--keep') {
      if (seen.has(argument)) throw new TypeError('duplicate argument: --keep');
      seen.add(argument);
      parsed.keep = true;
      continue;
    }
    if (
      argument === '--ledger'
      || argument === '--receipt'
      || argument === '--install-source'
      || argument === '--registry'
      || argument === '--root-selector'
      || argument === '--source-checkout'
      || argument === '--proof-harness-revision'
    ) {
      if (seen.has(argument)) throw new TypeError(`duplicate argument: ${argument}`);
      seen.add(argument);
      const value = args[index + 1];
      if (value == null || value.startsWith('-')) {
        throw new TypeError(`${argument} requires a value`);
      }
      const key = argument === '--install-source'
        ? 'installSource'
        : argument === '--root-selector'
          ? 'rootSelector'
          : argument === '--source-checkout'
            ? 'sourceCheckout'
            : argument === '--proof-harness-revision'
              ? 'proofHarnessRevision'
          : argument.slice(2);
      parsed[key] = value;
      index += 1;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  if (!['staged', 'public'].includes(parsed.installSource)) {
    throw new TypeError('--install-source must be staged or public');
  }
  if (!['exact', 'latest'].includes(parsed.rootSelector)) {
    throw new TypeError('--root-selector must be exact or latest');
  }
  if (parsed.rootSelector === 'latest' && parsed.installSource !== 'public') {
    throw new TypeError('--root-selector latest requires --install-source public');
  }
  if ((parsed.sourceCheckout === null) !== (parsed.proofHarnessRevision === null)) {
    throw new TypeError(
      '--source-checkout and --proof-harness-revision must be provided together',
    );
  }
  if (
    parsed.proofHarnessRevision !== null
    && !/^[0-9a-f]{40}$/u.test(parsed.proofHarnessRevision)
  ) {
    throw new TypeError('--proof-harness-revision must be a full Git revision');
  }
  if (parsed.sourceCheckout !== null && parsed.installSource !== 'public') {
    throw new TypeError('--source-checkout is only valid for public proofs');
  }
  let registry;
  try {
    registry = new URL(parsed.registry);
  } catch {
    throw new TypeError('--registry must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(registry.protocol)) {
    throw new TypeError('--registry must be an absolute http(s) URL');
  }
  parsed.registry = registry.href.replace(/\/$/u, '');
  return parsed;
}

export function validatePublicPublicationLedger(ledger, expectedSourceNames) {
  const legacyLatest = ledger?.schemaVersion === 'snapback.package-publication.v1';
  const candidate = ledger?.schemaVersion === 'snapback.package-candidate-ledger.v1';
  if (!legacyLatest && !candidate) {
    throw new TypeError('unsupported publication ledger');
  }
  if (ledger.mode !== 'publish') {
    throw new TypeError('public install requires a successful publication ledger');
  }
  if (ledger.sourceDirty !== false) {
    throw new TypeError('public install refuses a dirty-source publication ledger');
  }
  if (ledger.scopePreset !== 'ccheever') {
    throw new TypeError('public install requires the decided ccheever public aliases');
  }
  if (ledger.registry !== PUBLIC_NPM_REGISTRY) {
    throw new TypeError('public install requires the official npm registry');
  }
  if (legacyLatest && ledger.tag !== 'latest') {
    throw new TypeError('legacy public ledger must select latest');
  }
  if (candidate) {
    validateCandidateLedger(ledger);
  }
  if (typeof ledger.revision !== 'string' || !/^[0-9a-f]{40}$/u.test(ledger.revision)) {
    throw new TypeError('publication ledger has no immutable source revision');
  }
  const packages = Array.isArray(ledger.packages) ? ledger.packages : [];
  if (packages.length !== expectedSourceNames.length) {
    throw new TypeError('publication ledger is not the exact expected package closure');
  }
  const bySourceName = new Map(packages.map((entry) => [entry.sourceName, entry]));
  if (bySourceName.size !== packages.length) {
    throw new TypeError('publication ledger contains duplicate source package names');
  }
  for (const sourceName of expectedSourceNames) {
    const entry = bySourceName.get(sourceName);
    if (!entry) throw new TypeError(`publication ledger omits ${sourceName}`);
    if (entry.version !== ledger.version) {
      throw new TypeError(`publication ledger version drift for ${sourceName}`);
    }
    if (!['published', 'skipped-already-published'].includes(entry.status)) {
      throw new TypeError(`publication ledger has no successful public status for ${sourceName}`);
    }
    if (candidate && entry.candidateTagVerified !== true) {
      throw new TypeError(`candidate tag was not registry-verified for ${sourceName}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new TypeError(`publication ledger has no immutable sha256 for ${sourceName}`);
    }
    if (
      typeof entry.registrySha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(entry.registrySha256)
    ) {
      throw new TypeError(`publication ledger has no registry sha256 for ${sourceName}`);
    }
    const expectedPublicName = `@ccheever/snapback-${sourceName.slice('@snapback/'.length)}`;
    if (entry.name !== expectedPublicName) {
      throw new TypeError(`publication ledger alias drift for ${sourceName}`);
    }
  }
  return bySourceName;
}

export function validateStagedPublicationLedger(ledger) {
  if (ledger?.schemaVersion === 'snapback.package-qualified-staging-ledger.v1') {
    return validateQualifiedStagingLedger(ledger);
  }
  if (
    ledger?.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    && ledger?.schemaVersion !== 'snapback.package-publication.v1'
  ) {
    throw new TypeError('unsupported staged publication ledger');
  }
  return ledger;
}

const SNAPBACK_PLATFORM_RUNTIMES = [
  '@snapback/runtime-darwin-arm64',
  '@snapback/runtime-linux-x64',
];

function collectInstalledSnapbackVersions(
  node,
  hostRuntime,
  output = new Map(),
  omittedPlatformRuntimes = [],
  parentPath = [],
) {
  for (const [dependency, child] of Object.entries(node?.dependencies ?? {})) {
    const treePath = [...parentPath, dependency];
    if (dependency.startsWith('@snapback/')) {
      if (typeof child?.version !== 'string') {
        const expectedOmittedRuntime = SNAPBACK_PLATFORM_RUNTIMES.find(
          (sourceName) => sourceName !== hostRuntime,
        );
        const platformFilteredOptional = (
          dependency === expectedOmittedRuntime
          && child !== null
          && typeof child === 'object'
          && !Array.isArray(child)
          && Object.keys(child).length === 0
          && parentPath.length === 1
          && parentPath[0] === '@snapback/cli'
        );
        if (!platformFilteredOptional) {
          throw new TypeError(`latest-root dependency ${dependency} has no installed version`);
        }
        omittedPlatformRuntimes.push({
          sourceName: dependency,
          treePath,
        });
        continue;
      }
      const prior = output.get(dependency);
      if (prior && prior !== child.version) {
        throw new TypeError(`latest-root dependency ${dependency} resolved multiple versions`);
      }
      output.set(dependency, child.version);
    }
    collectInstalledSnapbackVersions(
      child,
      hostRuntime,
      output,
      omittedPlatformRuntimes,
      treePath,
    );
  }
  return { installed: output, omittedPlatformRuntimes };
}

export function validateLatestRootResolution({
  tree,
  ledger,
  hostRuntime,
  tagVector,
}) {
  validateCandidateLedger(ledger);
  if (!SNAPBACK_PLATFORM_RUNTIMES.includes(hostRuntime)) {
    throw new TypeError('latest-root proof selected an unsupported host runtime');
  }
  const {
    installed,
    omittedPlatformRuntimes,
  } = collectInstalledSnapbackVersions(tree, hostRuntime);
  const expectedOmittedRuntime = SNAPBACK_PLATFORM_RUNTIMES.find(
    (sourceName) => sourceName !== hostRuntime,
  );
  if (
    omittedPlatformRuntimes.length !== 1
    || omittedPlatformRuntimes[0].sourceName !== expectedOmittedRuntime
    || omittedPlatformRuntimes[0].treePath.length !== 2
    || omittedPlatformRuntimes[0].treePath[0] !== '@snapback/cli'
    || omittedPlatformRuntimes[0].treePath[1] !== expectedOmittedRuntime
  ) {
    throw new TypeError('latest root did not prove the opposite platform runtime omission');
  }
  if (installed.has(expectedOmittedRuntime)) {
    throw new TypeError('latest root materialized the opposite platform runtime');
  }
  for (const sourceName of [
    '@snapback/cli',
    '@snapback/client',
    '@snapback/codegen',
    '@snapback/contract',
    hostRuntime,
  ]) {
    if (installed.get(sourceName) !== ledger.version) {
      throw new TypeError(`latest root did not resolve ${sourceName}@${ledger.version}`);
    }
  }
  for (const sourceName of installed.keys()) {
    const row = ledger.packages.find((entry) => entry.sourceName === sourceName);
    if (!row || installed.get(sourceName) !== row.version) {
      throw new TypeError(`latest root escaped the candidate ledger at ${sourceName}`);
    }
  }
  if (tagVector === null || typeof tagVector !== 'object' || Array.isArray(tagVector)) {
    throw new TypeError('latest-root proof has no complete default-tag vector');
  }
  for (const row of ledger.packages) {
    if (tagVector[row.name] !== row.version) {
      throw new TypeError(`latest default-tag vector drifted for ${row.name}`);
    }
  }
  return {
    root: '@snapback/cli',
    selected: ledger.version,
    installed: Object.fromEntries([...installed.entries()].sort()),
    omittedOptionalPlatformRuntimes: omittedPlatformRuntimes,
    defaultTagVector: Object.fromEntries(ledger.packages.map((row) => [
      row.name,
      tagVector[row.name],
    ])),
  };
}

export function validateFinalLatestReceipts({
  ledger,
  records,
  githubCollection,
}) {
  validateCandidateLedger(ledger);
  if (!Array.isArray(records) || records.length !== 2) {
    throw new TypeError('final promotion requires two latest-root receipts');
  }
  if (
    githubCollection?.schemaVersion
      !== 'snapback.github-latest-root-proof-collection.v2'
    || githubCollection.repository !== 'ccheever/snapback'
    || githubCollection.workflow !== 'public-package-proof.yml'
    || githubCollection.ledgerRevision !== ledger.revision
    || githubCollection.runHeadSha !== githubCollection.expectedHeadSha
    || !Number.isSafeInteger(githubCollection.runId)
    || githubCollection.runId < 1
    || !Number.isSafeInteger(githubCollection.runAttempt)
    || githubCollection.runAttempt < 1
    || !Array.isArray(githubCollection.artifacts)
    || githubCollection.artifacts.length !== 2
  ) {
    throw new TypeError('final promotion lacks one closed GitHub proof collection');
  }
  const byPlatform = new Map();
  for (const record of records) {
    const receipt = record.receipt;
    const platform = `${receipt?.machine?.platform}-${receipt?.machine?.architecture}`;
    const hostRuntime = platform === 'darwin-arm64'
      ? '@snapback/runtime-darwin-arm64'
      : platform === 'linux-x64'
        ? '@snapback/runtime-linux-x64'
        : null;
    validatePublicationReceiptProvenance(receipt, {
      expectedRevision: ledger.revision,
      expectedWorkflow: 'public-package-proof.yml',
      expectedOperationId: githubCollection.operationId,
      expectedWorkflowHead: githubCollection.expectedHeadSha,
    });
    if (
      receipt?.schemaVersion !== 'snapback.package-cold-install.v1'
      || receipt.ok !== true
      || receipt.rootSelector !== 'latest'
      || receipt.latestRootResolution?.selected !== ledger.version
      || receipt.candidateLedgerSha256 !== ledger.candidateLedgerSha256
      || receipt.sourceRevision !== ledger.revision
      || receipt.sourceDirty !== false
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
      || receipt.installSource !== 'public'
      || receipt.registry !== PUBLIC_NPM_REGISTRY
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
      || receipt.checks?.latestRootCandidateClosure !== true
      || receipt.checks?.publicRegistryTarballDigestMatch !== true
      || receipt.githubProof.runId !== String(githubCollection.runId)
      || receipt.githubProof.runAttempt !== String(githubCollection.runAttempt)
      || receipt.githubProof.runHeadSha !== githubCollection.expectedHeadSha
      || receipt.githubProof.ref !== `refs/heads/${githubCollection.ref}`
    ) {
      throw new TypeError(`invalid final latest-root receipt: ${platform}`);
    }
    validateColdInstallBrowserEvidence(receipt);
    validateRetainedComparatorReceipt(receipt, {
      sourceRevision: ledger.revision,
      version: ledger.version,
      expectedExecutorPackageNames: comparatorExecutorPackageNames(ledger),
      expectedRuntimeBinarySha256:
        ledger.packages.find((row) => row.sourceName === hostRuntime)?.runtimeBinarySha256,
    });
    if (!['darwin-arm64', 'linux-x64'].includes(platform) || byPlatform.has(platform)) {
      throw new TypeError(`duplicate or unsupported final latest-root receipt: ${platform}`);
    }
    if (receipt.machine.runtimePackage !== hostRuntime) {
      throw new TypeError(`final latest-root receipt selected the wrong runtime: ${platform}`);
    }
    const receiptRows = Array.isArray(receipt.packages) ? receipt.packages : [];
    const packagesBySource = new Map(
      receiptRows.map((row) => [row.sourceName, row]),
    );
    if (
      receiptRows.length !== ledger.packages.length
      || packagesBySource.size !== ledger.packages.length
    ) {
      throw new TypeError(`final latest-root package closure drifted: ${platform}`);
    }
    for (const candidate of ledger.packages) {
      const observed = packagesBySource.get(candidate.sourceName);
      if (
        observed?.publishedName !== candidate.name
        || observed.version !== candidate.version
        || observed.sha256 !== candidate.sha256
        || observed.registrySha256 !== candidate.registrySha256
      ) {
        throw new TypeError(
          `final latest-root package evidence drifted for ${candidate.sourceName}: ${platform}`,
        );
      }
    }
    const resolution = receipt.latestRootResolution;
    const expectedOmittedRuntime = SNAPBACK_PLATFORM_RUNTIMES.find(
      (sourceName) => sourceName !== hostRuntime,
    );
    const omittedPlatformRuntimes = resolution.omittedOptionalPlatformRuntimes;
    const omission = omittedPlatformRuntimes?.[0];
    if (
      resolution.root !== '@snapback/cli'
      || resolution.defaultTagVector === null
      || typeof resolution.defaultTagVector !== 'object'
      || Array.isArray(resolution.defaultTagVector)
      || Object.keys(resolution.defaultTagVector).length !== ledger.packages.length
      || !Array.isArray(omittedPlatformRuntimes)
      || omittedPlatformRuntimes.length !== 1
      || omission === null
      || typeof omission !== 'object'
      || Array.isArray(omission)
      || Object.keys(omission).sort().join(',') !== 'sourceName,treePath'
      || omission.sourceName !== expectedOmittedRuntime
      || !Array.isArray(omission.treePath)
      || omission.treePath.length !== 2
      || omission.treePath[0] !== '@snapback/cli'
      || omission.treePath[1] !== expectedOmittedRuntime
    ) {
      throw new TypeError(`final latest-root tag vector is incomplete: ${platform}`);
    }
    const proofHarnessCheckout = receipt.proofHarnessCheckout;
    if (
      proofHarnessCheckout === null
      || typeof proofHarnessCheckout !== 'object'
      || Array.isArray(proofHarnessCheckout)
      || Object.keys(proofHarnessCheckout).sort().join(',') !== 'dirty,headSha'
      || proofHarnessCheckout.dirty !== false
      || proofHarnessCheckout.headSha !== githubCollection.expectedHeadSha
      || proofHarnessCheckout.headSha !== receipt.githubProof.runHeadSha
    ) {
      throw new TypeError(`final latest-root proof harness drifted: ${platform}`);
    }
    for (const candidate of ledger.packages) {
      if (resolution.defaultTagVector[candidate.name] !== candidate.version) {
        throw new TypeError(
          `final latest-root tag vector drifted for ${candidate.name}: ${platform}`,
        );
      }
    }
    const installed = resolution.installed;
    if (installed === null || typeof installed !== 'object' || Array.isArray(installed)) {
      throw new TypeError(`final latest-root installed closure is missing: ${platform}`);
    }
    if (Object.hasOwn(installed, expectedOmittedRuntime)) {
      throw new TypeError(
        `final latest-root materialized the opposite runtime: ${platform}`,
      );
    }
    const candidateBySource = new Map(
      ledger.packages.map((row) => [row.sourceName, row]),
    );
    for (const sourceName of [
      '@snapback/cli',
      '@snapback/client',
      '@snapback/codegen',
      '@snapback/contract',
      hostRuntime,
    ]) {
      if (installed[sourceName] !== candidateBySource.get(sourceName)?.version) {
        throw new TypeError(
          `final latest-root installed closure drifted for ${sourceName}: ${platform}`,
        );
      }
    }
    for (const [sourceName, version] of Object.entries(installed)) {
      if (candidateBySource.get(sourceName)?.version !== version) {
        throw new TypeError(
          `final latest-root installed closure escaped at ${sourceName}: ${platform}`,
        );
      }
    }
    if (!/^[0-9a-f]{64}$/u.test(record.sha256 ?? '')) {
      throw new TypeError(`${platform} final receipt has no file digest`);
    }
    const artifact = record.githubArtifact;
    const retainedArtifact = githubCollection.artifacts.find(
      (row) => row.platform === platform,
    );
    if (
      JSON.stringify(retainedArtifact) !== JSON.stringify(artifact)
      || artifact?.receiptSha256 !== record.sha256
      || !Number.isSafeInteger(artifact?.artifactId)
      || artifact.artifactId < 1
      || !/^sha256:[0-9a-f]{64}$/u.test(artifact.apiDigest ?? '')
      || artifact.apiDigest !== `sha256:${artifact.archiveSha256}`
    ) {
      throw new TypeError(`${platform} final GitHub artifact evidence drifted`);
    }
    byPlatform.set(platform, {
      platform,
      sha256: record.sha256,
      github: {
        repository: githubCollection.repository,
        workflow: githubCollection.workflow,
        workflowId: githubCollection.workflowId,
        workflowPath: githubCollection.workflowPath,
        ref: githubCollection.ref,
        runId: githubCollection.runId,
        runAttempt: githubCollection.runAttempt,
        runHeadSha: githubCollection.runHeadSha,
        operationId: githubCollection.operationId,
        dispatchStartedAt: githubCollection.dispatchStartedAt,
        runCreatedAt: githubCollection.runCreatedAt,
        runStartedAt: githubCollection.runStartedAt,
        collectedAt: githubCollection.collectedAt,
        artifactId: artifact.artifactId,
        artifactName: artifact.artifactName,
        artifactApiDigest: artifact.apiDigest,
        artifactArchiveSha256: artifact.archiveSha256,
      },
      machine: receipt.machine,
      latestRootResolution: resolution,
      browserCaptureSha256: receipt.browserJourney.captureSha256,
      browserDistributionSha256:
        receipt.browserJourney.capture.browser.distributionSha256,
      browserExecutableSha256: receipt.browserJourney.capture.browser.executableSha256,
      browserPackageTreeSha256: receipt.browserJourney.capture.browser.packageTreeSha256,
    });
  }
  return ['darwin-arm64', 'linux-x64'].map((platform) => {
    const record = byPlatform.get(platform);
    if (!record) throw new TypeError(`missing final latest-root receipt: ${platform}`);
    return record;
  });
}

export function aggregatePublicPackageProofs({
  ledger,
  expectedSourceNames,
  expectedPlatforms,
  receipts,
}) {
  const ledgerEntries = validatePublicPublicationLedger(ledger, expectedSourceNames);
  if (!Array.isArray(receipts)) throw new TypeError('platform receipts must be an array');
  const byPlatform = new Map();
  for (const record of receipts) {
    const receipt = record?.receipt;
    validatePublicationReceiptProvenance(receipt, {
      expectedRevision: ledger.revision,
      expectedWorkflow: 'public-package-proof.yml',
    });
    if (receipt?.schemaVersion !== 'snapback.package-cold-install.v1' || receipt.ok !== true) {
      throw new TypeError(`invalid platform receipt: ${record?.path ?? '<unknown>'}`);
    }
    const platform = `${receipt.machine?.platform}-${receipt.machine?.architecture}`;
    if (!expectedPlatforms.has(platform)) {
      throw new TypeError(`unsupported platform receipt: ${platform}`);
    }
    if (byPlatform.has(platform)) throw new TypeError(`duplicate platform receipt: ${platform}`);
    if (
      receipt.platformClaimSatisfied !== true
      || receipt.installSource !== 'public'
      || (ledger.schemaVersion === 'snapback.package-candidate-ledger.v1'
        && receipt.rootSelector !== 'exact')
      || receipt.publicationMode !== 'publish'
      || receipt.registry !== PUBLIC_NPM_REGISTRY
      || receipt.sourceDirty !== false
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
    ) {
      throw new TypeError(`platform receipt is not independently public and clean: ${platform}`);
    }
    if (receipt.machine?.runtimePackage !== expectedPlatforms.get(platform)) {
      throw new TypeError(`platform receipt selected the wrong runtime package: ${platform}`);
    }
    if (
      receipt.sourceRevision !== ledger.revision
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
    ) {
      throw new TypeError(`platform receipt identity drift: ${platform}`);
    }
    validateColdInstallBrowserEvidence(receipt);
    const hostRuntime = expectedPlatforms.get(platform);
    const comparatorProof = validateRetainedComparatorReceipt(receipt, {
      sourceRevision: ledger.revision,
      version: ledger.version,
      expectedExecutorPackageNames: comparatorExecutorPackageNames(ledger),
      expectedRuntimeBinarySha256:
        ledger.packages.find((row) => row.sourceName === hostRuntime)?.runtimeBinarySha256 ?? null,
    });
    if (
      receipt.checks?.publicRegistryAliasResolution !== true
      || receipt.checks?.publicRegistryTarballDigestMatch !== true
      || receipt.checks?.registryTarballCount !== expectedSourceNames.length
      || receipt.checks?.noSiblingSourceCheckout !== true
      || receipt.checks?.localCodegenOffline !== true
      || receipt.checks?.remoteCodegenOffline !== true
      || receipt.checks?.packagedCliIntrospection !== true
      || receipt.checks?.packagedRuntimeDoctor !== true
      || receipt.checks?.packagedComparatorProfile !== true
      || receipt.checks?.packagedScaffoldAndOfflineGenerate !== true
      || receipt.checks?.packagedDeployBuildAndVerify !== true
      || receipt.checks?.packagedManagedDevReadyAttachWatchAndStop !== true
      || receipt.checks?.packedReactWebTypecheckTestBuildAndLiveAcceptance !== true
      || receipt.checks?.packedReactOneCommandBackendViteJourney !== true
      || receipt.checks?.packedReactExpoTypecheckAndIosExport !== true
      || receipt.checks?.packagedViteRelativeVersionedSeedSeam !== true
      || receipt.checks?.browserAdapterBundle !== true
    ) {
      throw new TypeError(`platform receipt lacks the complete packaged-loop proof: ${platform}`);
    }
    const receiptPackageRows = Array.isArray(receipt.packages) ? receipt.packages : [];
    const receiptPackages = new Map(
      receiptPackageRows.map((entry) => [entry.sourceName, entry]),
    );
    if (
      receiptPackageRows.length !== expectedSourceNames.length
      || receiptPackages.size !== expectedSourceNames.length
    ) {
      throw new TypeError(`platform receipt package closure drift: ${platform}`);
    }
    for (const sourceName of expectedSourceNames) {
      const ledgerEntry = ledgerEntries.get(sourceName);
      const receiptEntry = receiptPackages.get(sourceName);
      if (
        receiptEntry?.publishedName !== ledgerEntry.name
        || receiptEntry?.version !== ledgerEntry.version
        || receiptEntry?.registrySha256 !== ledgerEntry.registrySha256
      ) {
        throw new TypeError(`platform receipt package drift for ${sourceName}: ${platform}`);
      }
    }
    byPlatform.set(platform, {
      platform,
      sha256: record.sha256,
      machine: receipt.machine,
      checks: receipt.checks,
      browserCaptureSha256: receipt.browserJourney.captureSha256,
      browserDistributionSha256:
        receipt.browserJourney.capture.browser.distributionSha256,
      browserExecutableSha256: receipt.browserJourney.capture.browser.executableSha256,
      browserPackageTreeSha256: receipt.browserJourney.capture.browser.packageTreeSha256,
      comparatorProof,
    });
  }
  for (const platform of expectedPlatforms.keys()) {
    if (!byPlatform.has(platform)) throw new TypeError(`missing platform receipt: ${platform}`);
  }
  return {
    schemaVersion: 'snapback.package-cold-install.aggregate.v1',
    ok: true,
    claimTreatment: 'authoritative',
    claimSatisfied: true,
    sourceRevision: ledger.revision,
    sourceDirty: false,
    publicationMode: ledger.mode,
    publicationLedgerSchema: ledger.schemaVersion,
    publicationTag: ledger.tag,
    candidateLedgerSha256: ledger.candidateLedgerSha256 ?? null,
    installSource: 'public',
    scopePreset: ledger.scopePreset,
    version: ledger.version,
    registry: PUBLIC_NPM_REGISTRY,
    packages: expectedSourceNames.map((sourceName) => {
      const entry = ledgerEntries.get(sourceName);
      return {
        sourceName,
        publishedName: entry.name,
        version: entry.version,
        registrySha256: entry.registrySha256,
        registryIntegrity: entry.registryIntegrity ?? null,
      };
    }),
    platforms: [...byPlatform.values()],
    checks: {
      completePublicRegistryClosure: true,
      registryTarballDigestsMatchPublication: true,
      separatelyProvisionedCleanMachines: true,
      completeSupportedRuntimeMatrix: true,
      packagedRuntimeDoctor: true,
      packagedScaffoldGenerateDevTestAndWatch: true,
      realBrowserSeedLiveReloadOnEveryPlatform: true,
      browserPrivateSurfaceAbsenceOnEveryPlatform: true,
      noSiblingSourceCheckout: true,
    },
    nonclaims: [],
  };
}

export function runAsync(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let timeout;
    let stdout = '';
    let stderr = '';
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
      return;
    }

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      settle(
        rejectRun,
        new Error(`${command} ${commandArgs.join(' ')} failed to spawn: ${error.message}`, { cause: error }),
      );
    });
    child.once('close', (status, signal) => {
      if (status !== 0) {
        settle(
          rejectRun,
          new Error(`${command} ${commandArgs.join(' ')} failed (${status ?? signal}):\n${stderr || stdout}`),
        );
        return;
      }
      settle(resolveRun, stdout);
    });
    timeout = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 360_000);
  });
}
