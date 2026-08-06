// Acceptance-harness custody for one finite-TTL local instance fork.
//
// @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 — the
// harness consumes the product `fork create/diff/drop` lifecycle rather than
// cloning SQLite or killing a PID itself; registry-bound local evidence stays
// the authority for cleanup and review receipts.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const OWNER_FILE = 'fork-owner.json';
const OWNER_SCHEMA_VERSION = 'snapback.fork-owner.v1';

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

// ---------------------------------------------------------------------------
// LLP 0185 Phase 2b: worktree-, agent-, and parallel-suite fork workflows.
//
// Ownership is deterministic metadata written as a non-secret direct child of
// the fork directory. Cleanup binds to that exact recorded identity — an
// exact canonical worktree path or an exact owner/run pair — never a guessed
// directory, and every deletion still goes through the registry-bound
// product `fork drop`.

// Resolve the exact identity of the git worktree containing `directory`.
// The canonical toplevel path is the ownership key; a nested subdirectory
// or a symlinked spelling of the same worktree resolves identically.
export function resolveWorktreeIdentity(directory = process.cwd()) {
  const toplevel = execFileSync('git', ['-C', resolve(directory), 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  if (!toplevel) {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_WORKTREE_INVALID',
      `${directory} is not inside a git worktree`,
    );
  }
  return toplevel;
}

// One fork owned by one exact worktree: the fork loads that worktree's
// generated artifacts, and its ownership record names the canonical
// worktree toplevel so later cleanup can bind to it precisely.
export async function startWorktreeFork({
  worktree = process.cwd(),
  purpose = 'worktree-dev',
  ...options
}) {
  const identity = resolveWorktreeIdentity(worktree);
  return startOwnedFork({
    owner: { ownerKind: 'worktree', ownerId: identity, worktree: identity, runId: null, purpose },
    appRoot: options.appRoot ?? identity,
    ...options,
  });
}

// One fork owned by one agent run. `ownerId` names the agent (or fleet
// lane) and `runId` the specific run; both are required so interrupted
// runs can be swept exactly, not by prefix or guesswork.
export async function startAgentFork({ ownerId, runId, purpose = 'agent-run', ...options }) {
  if (typeof ownerId !== 'string' || ownerId.length === 0
    || typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError('startAgentFork requires non-empty ownerId and runId strings');
  }
  return startOwnedFork({
    owner: { ownerKind: 'agent', ownerId, runId, worktree: null, purpose },
    ...options,
  });
}

async function startOwnedFork({ owner, ...options }) {
  const server = await startForkedServer(options);
  const destination = join(server.fork.forkRoot, forkDestinationName(server));
  const record = {
    schemaVersion: OWNER_SCHEMA_VERSION,
    ...owner,
    forkId: server.fork.forkId,
    parentSource: resolve(options.from),
    createdAtMs: server.fork.createEnvelope.data?.receipt?.lineage?.createdAtMs ?? null,
    expiresAtMs: server.fork.createEnvelope.data?.receipt?.lineage?.expiresAtMs ?? null,
  };
  writeFileSync(join(destination, OWNER_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return {
    ...server,
    destination,
    owner: Object.freeze(record),
    // Shell-friendly connection exports; no secret values, only the paths
    // that already carry owner-only custody.
    envExports: Object.freeze({
      SNAPBACK_FORK_ID: server.fork.forkId,
      SNAPBACK_FORK_URL: server.baseUrl,
      SNAPBACK_FORK_READY_FILE: server.readyFile,
    }),
  };
}

function forkDestinationName(server) {
  const database = server.fork.createEnvelope.data?.database;
  if (typeof database !== 'string') {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_ENVELOPE_INVALID',
      'fork.create did not return the fork database path',
    );
  }
  // The CLI reports canonical paths; canonicalize the configured fork root
  // the same way (macOS /var vs /private/var) before binding to it.
  const canonicalRoot = realpathSync(server.fork.forkRoot);
  const destination = resolve(database, '..');
  if (resolve(destination, '..') !== canonicalRoot) {
    throw forkHarnessError(
      'SNAPBACK_FORK_HARNESS_ENVELOPE_INVALID',
      'fork database is not a direct grandchild of the fork root',
    );
  }
  return destination.slice(canonicalRoot.length + 1);
}

// Every registry-bound fork in `forkRoot` whose ownership record exactly
// matches `match` (strict equality per provided key). Forks without a
// record never match — ownership is explicit, not inferred.
export async function discoverOwnedForks({
  repoRoot,
  appRoot,
  forkRoot,
  match = {},
  serverBinary = null,
  env = {},
}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedAppRoot = resolve(appRoot);
  const resolvedForkRoot = resolve(forkRoot);
  const binary = resolveForkBinary({ repoRoot: resolvedRepoRoot, serverBinary, env });
  const listed = requireForkEnvelope(
    await runForkCli(binary, [
      'fork', 'list',
      '--app-root', resolvedAppRoot,
      '--fork-root', resolvedForkRoot,
    ], { cwd: resolvedRepoRoot, env }),
    'fork.list',
  );
  const owned = [];
  for (const entry of listed.data.forks ?? []) {
    const ownerPath = join(resolvedForkRoot, entry.destination, OWNER_FILE);
    if (!existsSync(ownerPath)) continue;
    let record;
    try {
      record = JSON.parse(readFileSync(ownerPath, 'utf8'));
    } catch {
      continue;
    }
    if (record?.schemaVersion !== OWNER_SCHEMA_VERSION) continue;
    if (record.forkId !== entry.lineage?.forkId) continue;
    const matches = Object.entries(match)
      .every(([key, value]) => record[key] === value);
    if (matches) owned.push({ entry, owner: record });
  }
  return owned;
}

// Drop exactly the forks whose ownership record matches. Returns the
// dropped fork ids; every deletion goes through registry-bound `fork drop`.
export async function dropOwnedForks(options) {
  const owned = await discoverOwnedForks(options);
  const { repoRoot, appRoot, forkRoot, serverBinary = null, env = {} } = options;
  const resolvedRepoRoot = resolve(repoRoot);
  const binary = resolveForkBinary({ repoRoot: resolvedRepoRoot, serverBinary, env });
  const dropped = [];
  for (const { owner } of owned) {
    requireForkEnvelope(
      await runForkCli(binary, [
        'fork', 'drop', owner.forkId,
        '--app-root', resolve(appRoot),
        '--fork-root', resolve(forkRoot),
      ], { cwd: resolvedRepoRoot, env }),
      'fork.drop',
    );
    dropped.push(owner.forkId);
  }
  return dropped;
}

// Repair one crash-interrupted publication (or reap its pre-publication
// staging) by exact destination through the product `fork recover` verb.
export async function recoverForkDestination({
  repoRoot,
  appRoot,
  forkRoot,
  destination,
  serverBinary = null,
  env = {},
}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const binary = resolveForkBinary({ repoRoot: resolvedRepoRoot, serverBinary, env });
  const envelope = requireForkEnvelope(
    await runForkCli(binary, [
      'fork', 'recover', resolve(destination),
      '--app-root', resolve(appRoot),
      '--fork-root', resolve(forkRoot),
    ], { cwd: resolvedRepoRoot, env }),
    'fork.recover',
  );
  return envelope.data;
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
