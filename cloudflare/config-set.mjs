#!/usr/bin/env node
// The guided config.set flow for the Cloudflare deploy-time-binding backend
// (LLP 0049 §Config And Secrets, OQ5: the minimum productization — a guided
// deploy-controller flow plus status attestation; LLP 0036 D7: `applied` is
// an ATTESTED state, not a hope).
//
// Usage (secret bytes never appear in argv or shell history):
//   printf '%s' '{"caltrainFeed":["511-key-1"],"directions":["ors-key"]}' | \
//     SNAPBACK_ADMIN_TOKEN=... node cloudflare/config-set.mjs \
//       --url https://snapback-all-aboard-proof.<subdomain>.workers.dev \
//       --entries-stdin
//
// Flags: --config <wrangler config>   (default wrangler.all-aboard.jsonc)
//        --app <app name>             (default all-aboard)
//        --timeout-ms <milliseconds>  (one overall deadline, default 60000)
//        --dry-run                    (print the payload shape and exit —
//                                      values are never printed)
//
// The flow (the ordering invariant, LLP 0049):
//   1. read the deployed /_snapback/api/config/status -> current generation G;
//   2. stage generation N = G + 1 (state: pending);
//   3. write the changed entries AND the bumped SNAPBACK_CONFIG_GENERATION in
//      ONE `wrangler secret bulk` payload — one activation, so the attesting
//      activation can never precede a secret write it attests. An interactive
//      `wrangler secret put` of an entry alone never attests anything.
//   4. poll /_snapback/api/config/status until it reports generation >= N (state: applied),
//      or time out and report that the write remains pending.
//
// Secret values ride stdin directly into the wrangler payload and are never
// echoed or accepted as command-line arguments.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveLockedWrangler } from './locked-wrangler.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPERATION_TIMEOUT_MS = 60_000;
const MAX_OPERATION_TIMEOUT_MS = 15 * 60_000;

export class ConfigDeadlineError extends Error {
  constructor(message = 'the configuration operation deadline elapsed') {
    super(message);
    this.name = 'ConfigDeadlineError';
    this.code = 'SNAPBACK_CONFIG_DEADLINE_EXCEEDED';
  }
}

export class ConfigPendingError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ConfigPendingError';
    this.code = code;
  }
}

function remainingMs(deadlineMs) {
  if (!Number.isSafeInteger(deadlineMs)) {
    throw new ConfigDeadlineError('the configuration operation has no valid deadline');
  }
  const remaining = Math.floor(deadlineMs - Date.now());
  if (remaining <= 0) throw new ConfigDeadlineError();
  return remaining;
}

export function bindingNameFor(appName, entryName) {
  const upper = (value) =>
    String(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .toUpperCase();
  return `SNAPBACK_SECRET_${upper(appName)}_${upper(entryName)}`;
}

// Build the single-activation `wrangler secret bulk` payload: every changed
// entry plus the bumped generation stamp. The generation is itself a secret
// binding (not a [vars] entry) because vars are replaced wholesale by the
// next plain deploy, while secret bindings persist and every write is an
// activation (LLP 0049 §Config And Secrets).
export function buildBulkPayload(appName, entries, stagedGeneration) {
  const payload = {};
  for (const [name, value] of Object.entries(entries)) {
    payload[bindingNameFor(appName, name)] = value;
  }
  payload.SNAPBACK_CONFIG_GENERATION = String(stagedGeneration);
  return payload;
}

export async function readStatus(
  baseUrl,
  {
    adminToken = process.env.SNAPBACK_ADMIN_TOKEN,
    deadlineMs = null,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const headers = typeof adminToken === 'string' && adminToken.length > 0
    ? { 'x-snapback-admin-token': adminToken }
    : {};
  const signal = deadlineMs === null
    ? undefined
    : AbortSignal.timeout(Math.max(1, remainingMs(deadlineMs)));
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/_snapback/api/config/status`, { headers, signal });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new ConfigDeadlineError('timed out waiting for /_snapback/api/config/status');
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`GET /_snapback/api/config/status failed: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new ConfigDeadlineError('timed out reading /_snapback/api/config/status');
    }
    throw error;
  }
}

// Attest `applied` by observing the runtime report generation >= staged —
// exactly the LLP 0036 D7 contract with the generation ride-along as the
// Cloudflare-specific carrier. Returns 'applied' or 'pending'.
export async function attestApplied(
  baseUrl,
  stagedGeneration,
  {
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    deadlineMs = null,
    intervalMs = 2_000,
    adminToken = process.env.SNAPBACK_ADMIN_TOKEN,
    expectedEntries = {},
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const deadline = deadlineMs ?? Date.now() + timeoutMs;
  for (;;) {
    let status;
    try {
      status = await readStatus(baseUrl, { adminToken, deadlineMs: deadline, fetchImpl });
    } catch (error) {
      if (error instanceof ConfigDeadlineError) return 'pending';
      throw error;
    }
    const declarations = new Map((status.declarations || []).map((entry) => [entry.name, entry]));
    const entriesMatch = Object.entries(expectedEntries).every(([name, members]) => {
      const declaration = declarations.get(name);
      const count = Array.isArray(members) ? members.length : JSON.parse(members).length;
      return declaration && declaration.state === 'set' && Number(declaration.poolMembers) === count;
    });
    if (Number(status.generation) >= stagedGeneration && entriesMatch) return 'applied';
    if (Date.now() >= deadline) return 'pending';
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
}

export function runWranglerBulk(
  wrangler,
  payload,
  config,
  { deadlineMs, spawnSyncImpl = spawnSync } = {},
) {
  const timeout = remainingMs(deadlineMs);
  const result = spawnSyncImpl(
    wrangler.command,
    [...wrangler.args, 'secret', 'bulk', '--config', config],
    {
      cwd: here,
      input: JSON.stringify(payload),
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout,
      killSignal: 'SIGKILL',
    },
  );
  if (result.error?.code === 'ETIMEDOUT') return 'timeout';
  if (result.error) throw result.error;
  if (result.status !== 0) return 'failed';
  return 'activated';
}

export function validateRequestedEntries(status, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('stdin payload must be one JSON object mapping declared names to nonempty string arrays');
  }
  const declarations = new Set((status.declarations || []).map((entry) => entry.name));
  const encoded = {};
  for (const [name, members] of Object.entries(input)) {
    if (!declarations.has(name)) throw new Error(`configuration entry ${name} is not declared by the deployed app`);
    if (!Array.isArray(members) || members.length === 0 || members.some((value) => typeof value !== 'string' || value.length === 0)) {
      throw new Error(`configuration entry ${name} must be a nonempty array of nonempty strings`);
    }
    encoded[name] = JSON.stringify(members);
  }
  if (Object.keys(encoded).length === 0) throw new Error('stdin payload must contain at least one configuration entry');
  return encoded;
}

export function parseArgs(argv) {
  const args = {
    config: 'wrangler.all-aboard.jsonc',
    app: 'all-aboard',
    url: null,
    dryRun: false,
    entriesStdin: false,
    timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') args.url = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--app') args.app = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--entries-stdin') args.entriesStdin = true;
    else if (arg === '--entry') throw new Error('--entry is refused because it exposes secret values in process argv; use --entries-stdin');
    else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > MAX_OPERATION_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be a positive integer no greater than ${MAX_OPERATION_TIMEOUT_MS}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) throw new Error('--url <deployed gateway origin> is required (attestation reads /_snapback/api/config/status)');
  if (!args.entriesStdin) throw new Error('--entries-stdin is required; secret values are read from stdin, never argv');
  // Resolve and version-check the committed local dependency before reading
  // secret stdin or contacting any mutation surface.
  const wrangler = resolveLockedWrangler();
  console.log(`config.set: verified repo-local locked Wrangler ${wrangler.version}`);
  const adminToken = process.env.SNAPBACK_ADMIN_TOKEN;
  if (!adminToken) throw new Error('SNAPBACK_ADMIN_TOKEN is required to read the protected config status surface');
  const deadlineMs = Date.now() + args.timeoutMs;

  let status;
  try {
    status = await readStatus(args.url, { adminToken, deadlineMs });
  } catch (error) {
    if (error instanceof ConfigDeadlineError) {
      throw new ConfigPendingError(
        'SNAPBACK_CONFIG_STATUS_UNKNOWN',
        'the initial authenticated status read timed out before any write; no mutation was attempted. Re-check /_snapback/api/config/status and retry',
      );
    }
    throw error;
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    throw new Error('stdin must contain one valid JSON object');
  }
  const entries = validateRequestedEntries(status, input);
  const staged = Number(status.generation || 0) + 1;
  console.log(`config.set: current generation ${status.generation}; staging generation ${staged} (pending)`);

  const payload = buildBulkPayload(args.app, entries, staged);
  console.log(`config.set: one bulk activation carrying ${Object.keys(payload).length} bindings: ${Object.keys(payload).join(', ')}`);
  if (args.dryRun) {
    console.log('config.set: --dry-run, not writing');
    return;
  }

  let bulkOutcome;
  try {
    bulkOutcome = runWranglerBulk(wrangler, payload, args.config, { deadlineMs });
  } catch (error) {
    if (error instanceof ConfigDeadlineError) {
      throw new ConfigPendingError(
        'SNAPBACK_CONFIG_STATUS_UNKNOWN',
        'the overall deadline elapsed before Wrangler started; no write was attempted. Re-check /_snapback/api/config/status and retry',
      );
    }
    throw error;
  }
  if (bulkOutcome !== 'activated') {
    const reason = bulkOutcome === 'timeout'
      ? `exceeded the overall ${args.timeoutMs}ms deadline and was killed`
      : 'exited without local confirmation';
    throw new ConfigPendingError(
      'SNAPBACK_CONFIG_APPLY_PENDING',
      `the locked Wrangler child ${reason}; remote activation is unknown. Re-check /_snapback/api/config/status before retrying`,
    );
  }

  console.log('config.set: bulk write activated; attesting via /_snapback/api/config/status …');
  const outcome = await attestApplied(args.url, staged, {
    adminToken,
    expectedEntries: input,
    deadlineMs,
  });
  if (outcome === 'applied') {
    console.log(`config.set: APPLIED — runtime attests generation >= ${staged}`);
  } else {
    throw new ConfigPendingError(
      'SNAPBACK_CONFIG_APPLY_PENDING',
      `the runtime has not attested generation ${staged} within the overall ${args.timeoutMs}ms deadline; re-check /_snapback/api/config/status before retrying`,
    );
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exit(error instanceof ConfigPendingError ? 3 : 1);
  });
}
