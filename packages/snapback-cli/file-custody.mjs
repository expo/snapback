import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

// @ref LLP 0017#security-defaults — credential carriers are opened without
// following links, checked on the open descriptor, and never read unbounded.

function defaultFailure(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function custodyFailure(metadata, {
  expectedUid,
  maximumBytes,
  ownerOnly,
  path,
}) {
  const failedPredicates = [
    ...(metadata.isFile() ? [] : ['not-a-regular-file']),
    ...(metadata.isSymbolicLink() ? ['symbolic-link'] : []),
    ...(metadata.nlink === 1 ? [] : ['link-count-not-one']),
    ...(Number.isSafeInteger(metadata.size) && metadata.size >= 0
      ? (metadata.size <= maximumBytes ? [] : ['byte-bound-exceeded'])
      : ['invalid-byte-size']),
    ...(ownerOnly && expectedUid === null ? ['owner-uid-unavailable'] : []),
    ...(ownerOnly && expectedUid !== null && metadata.uid !== expectedUid
      ? ['not-owned-by-current-user']
      : []),
    ...(ownerOnly && (metadata.mode & 0o077) !== 0
      ? ['group-or-other-permission-bits']
      : []),
  ];
  if (failedPredicates.length === 0) return null;
  return {
    path,
    observedMode: (metadata.mode & 0o7777).toString(8).padStart(4, '0'),
    failedPredicates,
  };
}

export function readFileDescriptorSafe(path, code, options = {}) {
  const maximumBytes = options.maximumBytes;
  const ownerOnly = options.ownerOnly === true;
  const expectedUid = Object.hasOwn(options, 'ownerUid')
    ? options.ownerUid
    : (typeof process.getuid === 'function' ? process.getuid() : null);
  const makeFailure = options.makeFailure ?? defaultFailure;
  const fail = (message, details = undefined) => makeFailure(code, message, details);

  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw fail('artifact byte bound must be a non-negative safe integer', { path });
  }
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    throw fail('artifact cannot be opened safely on this platform', { path });
  }

  const custodyError = (metadata) => {
    const details = custodyFailure(metadata, {
      expectedUid,
      maximumBytes,
      ownerOnly,
      path,
    });
    if (details === null) return null;
    return fail(
      `${ownerOnly ? 'owner-only ' : ''}artifact failed descriptor custody checks: `
        + `observed mode ${details.observedMode} `
        + `failed [${details.failedPredicates.join(', ')}]`,
      details,
    );
  };

  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(descriptor);
    const beforeFailure = custodyError(before);
    if (beforeFailure !== null) throw beforeFailure;

    const bounded = Buffer.allocUnsafe(before.size + 1);
    let consumed = 0;
    while (consumed < bounded.byteLength) {
      const count = readSync(
        descriptor,
        bounded,
        consumed,
        bounded.byteLength - consumed,
        null,
      );
      if (count === 0) break;
      consumed += count;
    }
    if (consumed > maximumBytes) {
      throw fail('artifact exceeds its byte bound', { path });
    }
    const bytes = bounded.subarray(0, consumed);
    const after = fstatSync(descriptor);
    const afterFailure = custodyError(after);
    if (afterFailure !== null) throw afterFailure;
    if (before.dev !== after.dev || before.ino !== after.ino
        || before.nlink !== after.nlink || before.size !== after.size
        || before.uid !== after.uid || before.mode !== after.mode
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || bytes.byteLength !== after.size) {
      throw fail('artifact changed while it was being read', { path });
    }
    return bytes;
  } catch (cause) {
    if (cause?.code === code) throw cause;
    if (descriptor === undefined) {
      try {
        const observedFailure = custodyError(lstatSync(path));
        if (observedFailure !== null) throw observedFailure;
      } catch (observationCause) {
        if (observationCause?.code === code) throw observationCause;
      }
    }
    const error = fail('artifact does not exist or cannot be opened safely', { path });
    error.cause = cause;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
