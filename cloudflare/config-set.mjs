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
//        --dry-run                    (print the payload shape and exit —
//                                      values are never printed)
//
// The flow (the ordering invariant, LLP 0049):
//   1. read the deployed /config/status -> current generation G;
//   2. stage generation N = G + 1 (state: pending);
//   3. write the changed entries AND the bumped SNAPBACK_CONFIG_GENERATION in
//      ONE `wrangler secret bulk` payload — one activation, so the attesting
//      activation can never precede a secret write it attests. An interactive
//      `wrangler secret put` of an entry alone never attests anything.
//   4. poll /config/status until it reports generation >= N (state: applied),
//      or time out and report that the write remains pending.
//
// Secret values ride stdin directly into the wrangler payload and are never
// echoed or accepted as command-line arguments.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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

export async function readStatus(baseUrl, { adminToken = process.env.SNAPBACK_ADMIN_TOKEN } = {}) {
  const headers = typeof adminToken === 'string' && adminToken.length > 0
    ? { 'x-snapback-admin-token': adminToken }
    : {};
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/config/status`, { headers });
  if (!response.ok) {
    throw new Error(`GET /config/status failed: HTTP ${response.status}`);
  }
  return response.json();
}

// Attest `applied` by observing the runtime report generation >= staged —
// exactly the LLP 0036 D7 contract with the generation ride-along as the
// Cloudflare-specific carrier. Returns 'applied' or 'pending'.
export async function attestApplied(
  baseUrl,
  stagedGeneration,
  { timeoutMs = 60_000, intervalMs = 2_000, adminToken = process.env.SNAPBACK_ADMIN_TOKEN, expectedEntries = {} } = {}
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readStatus(baseUrl, { adminToken });
    const declarations = new Map((status.declarations || []).map((entry) => [entry.name, entry]));
    const entriesMatch = Object.entries(expectedEntries).every(([name, members]) => {
      const declaration = declarations.get(name);
      const count = Array.isArray(members) ? members.length : JSON.parse(members).length;
      return declaration && declaration.state === 'set' && Number(declaration.poolMembers) === count;
    });
    if (Number(status.generation) >= stagedGeneration && entriesMatch) return 'applied';
    if (Date.now() >= deadline) return 'pending';
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
  const args = { config: 'wrangler.all-aboard.jsonc', app: 'all-aboard', url: null, dryRun: false, entriesStdin: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') args.url = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--app') args.app = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--entries-stdin') args.entriesStdin = true;
    else if (arg === '--entry') throw new Error('--entry is refused because it exposes secret values in process argv; use --entries-stdin');
    else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) throw new Error('--url <deployed gateway origin> is required (attestation reads /config/status)');
  if (!args.entriesStdin) throw new Error('--entries-stdin is required; secret values are read from stdin, never argv');
  const adminToken = process.env.SNAPBACK_ADMIN_TOKEN;
  if (!adminToken) throw new Error('SNAPBACK_ADMIN_TOKEN is required to read the protected config status surface');

  const status = await readStatus(args.url, { adminToken });
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

  const result = spawnSync('npx', ['wrangler', 'secret', 'bulk', '--config', args.config], {
    cwd: here,
    input: JSON.stringify(payload),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`wrangler secret bulk failed (exit ${result.status}); state stays pending`);
  }

  console.log('config.set: bulk write activated; attesting via /config/status …');
  const outcome = await attestApplied(args.url, staged, { adminToken, expectedEntries: input });
  if (outcome === 'applied') {
    console.log(`config.set: APPLIED — runtime attests generation >= ${staged}`);
  } else {
    console.log(
      `config.set: still PENDING — the runtime has not attested generation ${staged}; ` +
        're-check /config/status, or re-run once the activation propagates'
    );
    process.exitCode = 3;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exit(1);
  });
}
