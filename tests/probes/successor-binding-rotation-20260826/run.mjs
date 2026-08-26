// LLP 0310 P19 / LLP 0310.000 A0 — reproduce a same-owner schema successor
// under supervised `snapback dev --expo --expo-platform web` with stdin
// /dev/null and no owner restart, retain the full `--json` event stream, and
// sample both sides of the `admitAppBindingV1` predicate across the transition.
//
// The open inference this settles: LLP 0310 records "which side of the mismatch
// predicate was stale" as inference rather than audited fact, because the lane
// read the M1 identity out of the Expo `extra` rather than out of a bootstrap
// response. This probe reads BOTH sides directly, at ~10 ms resolution, through
// the whole transition.
//
// Usage: node tests/probes/successor-binding-rotation-20260826/run.mjs
//   SNAPBACK_RUNTIME_BINARY  optional; defaults to <repo>/target/debug/snapback
//
// Writes events.jsonl, samples.jsonl and observations.json beside this file.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const probeRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(probeRoot, '..', '..', '..');
const cli = join(repoRoot, 'packages', 'snapback-cli', 'cli.mjs');
const sourceFixture = join(
  repoRoot, 'packages', 'snapback-cli', 'fixtures', 'comparator', 'app', 'snapback',
);
const metroStub = join(probeRoot, 'metro-stub.mjs');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(existsSync(runtimeBinary), `real Snapback runtime is missing: ${runtimeBinary}`);

const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-a0-probe-')));
const projectRoot = join(scratchRoot, 'successor-probe');
const backendRoot = join(projectRoot, 'snapback');
const expoRoot = join(projectRoot, 'app');
const stateRoot = join(projectRoot, '.snapback');
const generatedRoot = join(backendRoot, 'generated');
const governanceInputs = Object.freeze([
  'elevated-read-site-baseline.json',
  'table-visibility-policy-baseline.json',
  'table-visibility-policy-transition-ledger.json',
  'visibility-governance-quarantine-ledger.json',
  'visibility-override-baseline.json',
  'visibility-override-owner-baseline.json',
]);

function buildFixture() {
  mkdirSync(projectRoot, { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  cpSync(sourceFixture, backendRoot, { recursive: true });
  const retained = governanceInputs.flatMap((name) => {
    const path = join(generatedRoot, name);
    return existsSync(path) ? [[name, readFileSync(path)]] : [];
  });
  rmSync(generatedRoot, { recursive: true, force: true });
  mkdirSync(generatedRoot, { recursive: true });
  for (const [name, contents] of retained) writeFileSync(join(generatedRoot, name), contents);
  mkdirSync(expoRoot, { recursive: true });
  writeFileSync(
    join(expoRoot, 'app.json'),
    `${JSON.stringify({ expo: { plugins: ['@expo/snapback-expo'] } }, null, 2)}\n`,
  );
  writeFileSync(join(expoRoot, 'eas.json'), `${JSON.stringify({ build: { development: {} } }, null, 2)}\n`);
}

const events = [];
const samples = [];
const rawLines = [];
let stdoutBuffer = '';
let stderr = '';
let child = null;
const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;

function generatedDescriptorIdentity() {
  const path = join(generatedRoot, 'app.descriptor.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).identity.descriptor;
  } catch {
    return null;
  }
}

async function bootstrapBinding(exchangeOrigin) {
  try {
    const response = await fetch(`${exchangeOrigin}/_snapback/expo/v1/bootstrap`);
    if (!response.ok) return { status: response.status, descriptorIdentity: null };
    const payload = await response.json();
    return {
      status: response.status,
      descriptorIdentity: payload?.binding?.descriptorIdentity
        ?? payload?.binding?.app?.descriptorIdentity
        ?? null,
      source: payload?.binding?.source ?? null,
    };
  } catch (error) {
    return { status: null, descriptorIdentity: null, error: String(error?.message ?? error) };
  }
}

async function eventually(check, { timeoutMs = 90_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = check();
    if (last) return last;
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`snapback dev exited (${child.exitCode}) waiting for ${label}: ${stderr}\n${events.slice(-6).map((event) => JSON.stringify(event)).join('\n')}\nRAW:\n${rawLines.slice(-40).join('\n')}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

try {
  buildFixture();
  child = spawn(process.execPath, [
    cli,
    'dev', backendRoot,
    '--expo',
    '--json',
    '--expo-platform', 'web',
    '--expo-dir', expoRoot,
    '--ready-file', join(stateRoot, 'dev.ready.json'),
    '--db', join(stateRoot, 'dev.sqlite3'),
    '--email', 'probe@expo-a0.test',
    '--expo-command', `${JSON.stringify(process.execPath)} ${JSON.stringify(metroStub)}`,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_EXPO_TEST_BUNDLE: join(expoRoot, 'bundle.js'),
      SNAPBACK_EXPO_TEST_SOURCE_MAP: join(expoRoot, 'bundle.js.map'),
      SNAPBACK_EXPO_TEST_ENV: join(stateRoot, 'metro-env.json'),
      SNAPBACK_EXPO_TEST_GENERATED_ROOT: generatedRoot,
    },
    // stdin /dev/null: the Clique lane's shape, and the one that closes the
    // stdin control channel (LLP 0310 P2).
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push({ atMs: elapsed(), ...parsed });
      } else {
        rawLines.push(line);
      }
    } catch { rawLines.push(line); }
    }
  });

  const ready = await eventually(
    () => events.find((event) => event.schemaVersion === 'snapback.expo-dev.v1'
      && (event.state === 'ready' || event.state === 'startup-failed')),
    { label: 'snapback dev --expo readiness' },
  );
  assert.equal(ready.state, 'ready', JSON.stringify(ready));
  const exchangeOrigin = ready.bootstrap?.origin
    ?? ready.exchangeOrigin
    ?? ready.supervisor?.exchangeOrigin
    ?? null;
  assert.ok(exchangeOrigin, `probe needs the bootstrap exchange origin: ${JSON.stringify(ready)}`);

  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const generated = generatedDescriptorIdentity();
      const delivered = await bootstrapBinding(exchangeOrigin);
      samples.push({
        atMs: elapsed(),
        generatedDescriptorIdentity: generated,
        deliveredDescriptorIdentity: delivered.descriptorIdentity,
        deliveredSource: delivered.source ?? null,
        bootstrapStatus: delivered.status,
        agree: generated !== null && generated === delivered.descriptorIdentity,
      });
      await new Promise((r) => setTimeout(r, 10));
    }
  })();

  const predecessorIdentity = await eventually(
    () => generatedDescriptorIdentity(),
    { label: 'predecessor generated descriptor' },
  );
  const eventStart = events.length;
  const schemaPath = join(backendRoot, 'schema.mjs');
  const predecessorSchema = readFileSync(schemaPath, 'utf8');
  // A schema successor that changes the descriptor without widening any table's
  // read posture: adding a public-read table trips
  // SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH, which is a governance
  // refusal, not the identity transition this probe is about.
  const successorSchema = predecessorSchema.replace(
    "liveRows: defineTable({ body: v.string() })",
    "liveRows: defineTable({ body: v.string(), probeNote: v.optional(v.string()) })",
  );
  assert.notEqual(successorSchema, predecessorSchema, 'probe schema successor edit did not apply');
  const editAtMs = elapsed();
  writeFileSync(schemaPath, successorSchema);

  const rotated = await eventually(
    () => events.slice(eventStart).find((event) => event.state === 'binding-rotated'),
    { label: 'binding-rotated after the schema successor' },
  );
  const reloaded = await eventually(
    () => events.slice(eventStart).find((event) => event.state === 'metro-reloaded'
      && event.reason === 'successor-binding'),
    { timeoutMs: 60_000, label: 'supervisor-driven Metro reload after the remint' },
  ).catch((error) => ({ missing: String(error?.message ?? error) }));

  // Let the sampler observe the settled post-successor steady state.
  await new Promise((r) => setTimeout(r, 1_000));
  sampling = false;
  await sampler;

  const generatedAndLoaded = events.slice(eventStart).find((event) => (
    event.state === 'backend-event' && event.backend?.state === 'generated-and-loaded'
  )) ?? events.slice(eventStart).find((event) => event.state === 'generated-and-loaded');
  const successorActivated = events.slice(eventStart).find((event) => (
    event.state === 'backend-event' && event.backend?.state === 'startup-successor-activated'
  ));
  const finalExchange = await bootstrapBinding(exchangeOrigin);

  // The window this probe exists to measure: samples where the generated graph
  // already names the successor but the delivered binding still names the
  // predecessor. That is the interval in which a re-booting arm refuses.
  const disagreeing = samples.filter((sample) => (
    sample.generatedDescriptorIdentity === rotated.descriptorIdentity
    && sample.deliveredDescriptorIdentity === rotated.previousDescriptorIdentity
  ));
  const staleWindowMs = disagreeing.length === 0
    ? 0
    : disagreeing.at(-1).atMs - disagreeing[0].atMs;

  const observations = {
    schemaVersion: 'snapback.probe.successor-binding-rotation.v1',
    llp: ['0310 P19', '0310.000 A0'],
    runtimeBinary,
    editAtMs,
    predecessorDescriptorIdentity: predecessorIdentity,
    // 1. Was binding-rotated emitted, and with which identities?
    bindingRotated: {
      emitted: true,
      atMs: rotated.atMs,
      previousDescriptorIdentity: rotated.previousDescriptorIdentity,
      descriptorIdentity: rotated.descriptorIdentity,
      changed: rotated.changed ?? null,
    },
    // 2. Was generated-and-loaded emitted to the Expo arm after the successor
    //    activation, and did it precede the remint?
    generatedAndLoaded: generatedAndLoaded === undefined ? null : {
      atMs: generatedAndLoaded.atMs,
      precedesRemint: generatedAndLoaded.atMs <= rotated.atMs,
    },
    startupSuccessorActivated: successorActivated === undefined ? null : {
      atMs: successorActivated.atMs,
      precedesRemint: successorActivated.atMs <= rotated.atMs,
    },
    // 3. What did the next bootstrap exchange return?
    finalBootstrapExchange: finalExchange,
    // 4. Which side of the admitAppBindingV1 predicate was stale, and for how long?
    stalePredicateSide: disagreeing.length === 0 ? 'not-observed' : 'delivered-binding',
    staleWindow: {
      samples: disagreeing.length,
      firstAtMs: disagreeing[0]?.atMs ?? null,
      lastAtMs: disagreeing.at(-1)?.atMs ?? null,
      approximateMs: staleWindowMs,
      samplePeriodMs: 10,
    },
    // A1 (LLP 0310.000): the supervisor-driven reload that bounds the window.
    successorMetroReload: reloaded?.missing === undefined ? {
      atMs: reloaded.atMs,
      reason: reloaded.reason,
      descriptorIdentity: reloaded.descriptorIdentity ?? null,
      previousPid: reloaded.previousPid,
      pid: reloaded.pid,
      backendPid: reloaded.backendPid ?? null,
      followsRemintByMs: reloaded.atMs - rotated.atMs,
    } : { missing: reloaded.missing },
    sampleCount: samples.length,
    eventCount: events.length,
  };

  writeFileSync(
    join(probeRoot, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  writeFileSync(
    join(probeRoot, 'samples.jsonl'),
    `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`,
  );
  writeFileSync(
    join(probeRoot, 'observations.json'),
    `${JSON.stringify(observations, null, 2)}\n`,
  );
  console.log(JSON.stringify(observations, null, 2));
} finally {
  // Always retain what was observed, including on a failed run: a probe that
  // throws without evidence is worth nothing.
  try {
    writeFileSync(
      join(probeRoot, 'events.jsonl'),
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    );
    writeFileSync(
      join(probeRoot, 'samples.jsonl'),
      `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`,
    );
  } catch { /* the thrown failure owns the outcome */ }
  if (child !== null && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 2_000));
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
