import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isPathInside(path) {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function fileCapabilityError(code, message, details = {}) {
  const error = new Error(message);
  error.codegenCode = code;
  error.details = details;
  return error;
}

// @ref LLP 0010#generated-artifacts — resolve first, attest the resolved
// inode, then open that exact target with a
// no-follow final component where the host supports it. The dev/ino comparison
// closes parent/final replacement races between resolution and open; the fd is
// the only object read after attestation.
export function resolveFileReadCapability(candidate, {
  allowedRoots,
  allowSymlink = true,
  beforeOpen = null,
  codePrefix = 'FILE_READ',
} = {}) {
  let lexicalStat;
  try {
    lexicalStat = lstatSync(candidate, { bigint: true });
  } catch (cause) {
    throw fileCapabilityError(`${codePrefix}_UNREADABLE`, `could not inspect ${candidate}: ${cause.message}`, { path: candidate, cause });
  }
  if (!allowSymlink && lexicalStat.isSymbolicLink()) {
    throw fileCapabilityError(`${codePrefix}_SYMLINK_UNSUPPORTED`, `${candidate} must not be a symbolic link`, { path: candidate });
  }

  let realPath;
  try {
    realPath = realpathSync(candidate);
  } catch (cause) {
    throw fileCapabilityError(`${codePrefix}_UNREADABLE`, `could not resolve ${candidate}: ${cause.message}`, { path: candidate, cause });
  }
  const roots = (allowedRoots ?? []).map((root) => realpathSync(root));
  if (!roots.some((root) => isPathInside(relative(root, realPath)))) {
    throw fileCapabilityError(`${codePrefix}_OUTSIDE_ROOT`, `${candidate} resolves outside its allowed root`, { path: candidate, realPath });
  }

  let expected;
  try {
    expected = lstatSync(realPath, { bigint: true });
  } catch (cause) {
    throw fileCapabilityError(`${codePrefix}_UNREADABLE`, `could not attest ${realPath}: ${cause.message}`, { path: candidate, realPath, cause });
  }
  if (!expected.isFile()) {
    throw fileCapabilityError(`${codePrefix}_NOT_REGULAR`, `${candidate} must resolve to a regular file`, { path: candidate, realPath });
  }

  return {
    realPath,
    read() {
      beforeOpen?.({ candidate, realPath });
      let fd;
      let failure = null;
      try {
        fd = openSync(realPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(fd, { bigint: true });
        if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
          throw fileCapabilityError(`${codePrefix}_CHANGED_DURING_READ`, `${candidate} changed between resolution and open`, { path: candidate, realPath });
        }
        return readFileSync(fd);
      } catch (cause) {
        failure = cause?.codegenCode
          ? cause
          : fileCapabilityError(`${codePrefix}_CHANGED_DURING_READ`, `could not safely open ${candidate}: ${cause.message}`, { path: candidate, realPath, cause });
        throw failure;
      } finally {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch (cause) {
            // Keep the primary security diagnostic when both the operation and
            // cleanup fail. A lone close failure is itself a failed safe read.
            if (failure === null) {
              throw fileCapabilityError(`${codePrefix}_CHANGED_DURING_READ`, `could not safely close ${candidate}: ${cause.message}`, { path: candidate, realPath, cause });
            }
          }
        }
      }
    },
  };
}

export function decodeUtf8Source(bytes, path, codePrefix) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw fileCapabilityError(`${codePrefix}_INVALID_UTF8`, `${path} is not valid UTF-8 source`, { path, cause });
  }
}

function invalidHandlerPath(sourcePath) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0 || sourcePath.trim() !== sourcePath) return true;
  if (isAbsolute(sourcePath) || /^[A-Za-z]:/u.test(sourcePath) || sourcePath.startsWith('//')) return true;
  if (/[\\%?#\0]/u.test(sourcePath) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(sourcePath)) return true;
  return sourcePath.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function resolveHandlerSourceCapability(backendDir, sourcePath, options = {}) {
  if (invalidHandlerPath(sourcePath)) {
    throw fileCapabilityError('BUNDLE_SOURCE_PATH_INVALID', `handler source path ${JSON.stringify(sourcePath)} must be a canonical backend-relative path`, { source: sourcePath });
  }
  const backendRoot = realpathSync(backendDir);
  const candidate = resolve(backendRoot, ...sourcePath.split('/'));
  const capability = resolveFileReadCapability(candidate, {
    allowedRoots: [backendRoot],
    beforeOpen: options.beforeOpen,
    codePrefix: 'BUNDLE_SOURCE',
  });
  const identity = relative(backendRoot, capability.realPath).split(sep).join('/');
  // TypeScript-family spellings that are outside the admitted profile still
  // pass this capability boundary so the TypeScript validator can return its
  // stable, profile-specific refusal (for example .tsx, .cts, or .d.ts).
  if (!/\.(?:js|mjs|ts|mts|tsx|cts)$/iu.test(identity)) {
    throw fileCapabilityError('BUNDLE_SOURCE_UNSUPPORTED_EXTENSION', `handler source ${identity} must be a supported JS/TS file`, { source: sourcePath, identity });
  }
  return { identity, ...capability };
}
