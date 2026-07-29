import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Hash one packed tar entry without collecting the entry in child-process
 * memory. `tar` streams into an owner-private regular file, then this process
 * reopens and hashes it in fixed-size chunks.
 *
 * @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — qualification
 * must bind the actual packed runtime entry even when a native binary exceeds
 * Node's synchronous child-process buffer.
 */
export function sha256TarEntry(
  archivePath,
  entry,
  {
    maxBytes = DEFAULT_MAX_ENTRY_BYTES,
    timeoutMs = 180_000,
  } = {},
) {
  if (typeof archivePath !== 'string' || archivePath.length === 0) {
    throw new TypeError('tar archive path is required');
  }
  if (
    typeof entry !== 'string'
    || entry.length === 0
    || entry.startsWith('/')
    || entry.split('/').some((part) => part === '' || part === '..')
  ) {
    throw new TypeError('tar entry must be a normalized relative path');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('tar entry maxBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('tar entry timeoutMs must be a positive safe integer');
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'snapback-tar-entry-'));
  const extractedPath = join(temporaryRoot, 'entry');
  let outputDescriptor;
  let inputDescriptor;
  try {
    outputDescriptor = openSync(
      extractedPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    const result = spawnSync('tar', ['-xzOf', archivePath, entry], {
      stdio: ['ignore', outputDescriptor, 'pipe'],
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
    });
    closeSync(outputDescriptor);
    outputDescriptor = undefined;
    if (result.error || result.status !== 0) {
      throw new Error(
        `tar entry extraction failed with ${
          result.error?.code ?? result.status ?? result.signal ?? 'unknown'
        }: ${String(result.stderr ?? '').trim()}`,
      );
    }

    inputDescriptor = openSync(
      extractedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(inputDescriptor);
    if (!metadata.isFile()) throw new TypeError('extracted tar entry must be a regular file');
    if (metadata.size < 1 || metadata.size > maxBytes) {
      throw new RangeError(
        `tar entry size ${metadata.size} exceeded its ${maxBytes}-byte bound`,
      );
    }

    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, metadata.size));
    let consumed = 0;
    while (consumed < metadata.size) {
      const count = readSync(
        inputDescriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, metadata.size - consumed),
        null,
      );
      if (count === 0) break;
      hash.update(chunk.subarray(0, count));
      consumed += count;
    }
    const growthProbe = Buffer.alloc(1);
    if (
      consumed !== metadata.size
      || readSync(inputDescriptor, growthProbe, 0, 1, null) !== 0
    ) {
      throw new TypeError('extracted tar entry changed while it was being hashed');
    }
    return hash.digest('hex');
  } finally {
    if (outputDescriptor !== undefined) closeSync(outputDescriptor);
    if (inputDescriptor !== undefined) closeSync(inputDescriptor);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
