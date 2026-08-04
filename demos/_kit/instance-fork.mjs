// Acceptance-harness custody for one finite-TTL local instance fork.
//
// @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 — the
// harness consumes the product `fork create/diff/drop` lifecycle rather than
// cloning SQLite or killing a PID itself; registry-bound local evidence stays
// the authority for cleanup and review receipts.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

export async function startForkedServer({
  from,
  appRoot,
  repoRoot,
  forkRoot = null,
  ttl = '30m',
  withSecrets = false,
  serverBinary = null,
  env = {},
} = {}) {
  if (typeof from !== 'string' || from.length === 0) {
    throw new TypeError('startForkedServer requires a parent database or ready-file path');
  }
  if (typeof appRoot !== 'string' || appRoot.length === 0) {
    throw new TypeError('startForkedServer requires the app source root for this worktree');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('startForkedServer requires the Snapback repository root');
  }
  if (typeof ttl !== 'string' || !/^\d+(?:ms|s|m|h|d)$/.test(ttl) || ttl.startsWith('0')) {
    throw new TypeError('startForkedServer ttl must be a positive finite duration such as 30m or 2h');
  }
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedAppRoot = resolve(appRoot);
  const resolvedFrom = resolve(from);
  const resolvedForkRoot = forkRoot === null
    ? join(resolvedAppRoot, '.snapback', 'forks')
    : resolve(forkRoot);
  const binary = resolveForkBinary({ repoRoot: resolvedRepoRoot, serverBinary, env });
  const baseArgs = [
    '--app-root', resolvedAppRoot,
    '--fork-root', resolvedForkRoot,
  ];
  const creation = await runForkCli(binary, [
    'fork', 'create',
    '--from', resolvedFrom,
    '--ttl', ttl,
    ...baseArgs,
    ...(withSecrets ? ['--with-secrets'] : []),
  ], { cwd: resolvedRepoRoot, env });
  const data = requireForkEnvelope(creation, 'fork.create').data;
  const forkId = data?.receipt?.lineage?.forkId;
  const readyFile = data?.readyFile;
  if (typeof forkId !== 'string' || typeof readyFile !== 'string') {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_ENVELOPE_INVALID',
      'fork.create did not return a fork id and ready-file path',
    );
  }
  const invoke = (subcommand, extra = []) => runForkCli(
    binary,
    ['fork', subcommand, ...(subcommand === 'create' ? [] : [forkId]), ...baseArgs, ...extra],
    { cwd: resolvedRepoRoot, env },
  ).then((envelope) => requireForkEnvelope(envelope, `fork.${subcommand}`));
  let ready;
  let adminToken;
  try {
    ready = readJson(readyFile, 'SNAPBACK_FORK_HARNESS_READY_INVALID');
    if (ready?.ready !== true || typeof ready.serverUrl !== 'string') {
      throw forkHarnessError(
        'SNAPBACK_FORK_HARNESS_READY_INVALID',
        'fork readiness descriptor lacks ready=true or serverUrl',
      );
    }
    const adminTokenFile = ready.adminTokenFile;
    if (typeof adminTokenFile !== 'string') {
      throw forkHarnessError(
        'SNAPBACK_FORK_HARNESS_READY_INVALID',
        'fork readiness descriptor does not name its minted admin-token file',
      );
    }
    adminToken = readFileSync(adminTokenFile, 'utf8').trim();
    if (adminToken.length === 0) {
      throw forkHarnessError(
        'SNAPBACK_FORK_HARNESS_READY_INVALID',
        'fork minted an empty admin token',
      );
    }
  } catch (error) {
    try {
      await invoke('drop');
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message}; fork setup cleanup failed: ${cleanupError.message}`,
        { cause: error },
      );
    }
    throw error;
  }

  let stopPromise = null;
  const stop = () => {
    if (!stopPromise) stopPromise = invoke('drop');
    return stopPromise;
  };
  const credentials = Object.freeze({ adminToken });
  return {
    baseUrl: ready.serverUrl.replace(/\/$/, ''),
    pid: ready.pid ?? null,
    adminToken,
    credentials,
    clientOptions: credentials,
    reused: false,
    readyFile,
    stop,
    fork: Object.freeze({
      forkId,
      forkRoot: resolvedForkRoot,
      ttl,
      createEnvelope: creation,
      async diff({ out = null } = {}) {
        const envelope = await invoke('diff', out === null ? [] : ['--out', resolve(out)]);
        return envelope.data.receipt;
      },
      drop: stop,
    }),
  };
}

function resolveForkBinary({ repoRoot, serverBinary, env }) {
  const configured = serverBinary ?? env.SNAPBACK_SERVER_BINARY ?? process.env.SNAPBACK_SERVER_BINARY;
  const candidate = configured
    ? (isAbsolute(configured) ? configured : resolve(repoRoot, configured))
    : join(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  if (!existsSync(candidate)) {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_BINARY_MISSING',
      `no Snapback binary exists at ${candidate}; run scripts/bootstrap-ibex-runtime first`,
    );
  }
  return candidate;
}

function runForkCli(binary, args, { cwd, env }) {
  return new Promise((resolveEnvelope, rejectEnvelope) => {
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-DEFAULT_OUTPUT_LIMIT);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => rejectEnvelope(forkHarnessError(
      'SNAPBACK_FORK_HARNESS_CLI_FAILED',
      `could not launch ${binary}: ${error.message}`,
    )));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        rejectEnvelope(forkHarnessError(
          diagnosticCode(stderr) ?? 'SNAPBACK_FORK_HARNESS_CLI_FAILED',
          `snapback ${args.slice(0, 2).join(' ')} failed (${signal ?? `exit ${code}`}): ${stderr.trim() || stdout.trim()}`,
        ));
        return;
      }
      try {
        resolveEnvelope(JSON.parse(stdout));
      } catch (error) {
        rejectEnvelope(forkHarnessError(
          'SNAPBACK_FORK_HARNESS_ENVELOPE_INVALID',
          `fork CLI returned malformed JSON: ${error.message}`,
        ));
      }
    });
  });
}

function requireForkEnvelope(envelope, operation) {
  if (envelope?.ok !== true || envelope?.operation !== operation || typeof envelope?.data !== 'object') {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_ENVELOPE_INVALID',
      `fork CLI did not return a successful ${operation} hostOpsResult`,
    );
  }
  return envelope;
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw forkHarnessError(code, `could not read ${path}: ${error.message}`);
  }
}

function diagnosticCode(value) {
  return String(value).match(/\b(SNAPBACK_[A-Z0-9_]+)\b/)?.[1] ?? null;
}

function forkHarnessError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, severity: 'error', subsystem: 'instance-fork-harness', message };
  return error;
}
