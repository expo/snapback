#!/usr/bin/env node
// @ref LLP 3000.030#14 — SDK acquisition, offline coverage, then a no-image reconnect.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, hostname, availableParallelism, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { prepareClient } from '../dist/client-start.js';
import { memorySessionStore } from '../dist/auth.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { resolveBinary } from '../dist/resolve-binary.js';

const fail = (code, message) => { throw new Error(`${code}: ${message}`); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const ms = start => Math.round((performance.now() - start) * 1000) / 1000;
const host = () => ({ hostname: hostname(), cpus: availableParallelism(), load: loadavg() });
const NOTE = 'Node process device: one JSON line per call to the snapback4 device subprocess, backed by SQLite. Expo links the crate in-process; these are not Expo/iOS timings; web wasm + IndexedDB figures differ. Bytes are SQLite pages, excluding WAL/SHM, not RSS.';

// Sanitize before serialization (including keys), plus final text/error boundaries.
function redact(text, secrets) {
  for (const token of secrets.filter(value => typeof value === 'string' && value.length)) {
    const variants = [token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1),
      Buffer.from(token).toString('base64'), Buffer.from(token).toString('base64url'), Buffer.from(token).toString('hex')];
    for (const value of variants.sort((a, b) => b.length - a.length)) text = text.split(value).join('[REDACTED]');
  }
  return text;
}
function sanitize(value, secrets) {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, secrets), sanitize(item, secrets)]));
  return value;
}
function validateSync(page) {
  const uint = value => Number.isSafeInteger(value) && value >= 0;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!Array.isArray(page.events) || !page.events.every(event => object(event) && typeof event.kind === 'string'
    && ['put', 'del', 'scope'].includes(event.kind) && typeof event.table === 'string' && typeof event.id === 'string')
    || typeof page.more !== 'boolean' || typeof page.snapshot !== 'boolean'
    || !uint(page.watermark) || !uint(page.generation) || !Number.isSafeInteger(page.now)
    || typeof page.store_id !== 'string' || !page.store_id || !object(page.acknowledged)
    || (!page.snapshot && (!uint(page.images_at) || page.watermark > page.images_at || !object(page.joined)))
    || (page.snapshot && (page.more ? typeof page.next !== 'string' || !page.next : page.next != null))) {
    fail('E_WITNESS_RECEIPT', 'malformed sync reply');
  }
}

export function parse(args) {
  const options = { url: 'http://127.0.0.1:4400', runs: 1, timeout: 120, args: {} };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) fail('E_WITNESS_INPUT', `duplicate ${flag}`);
    seen.add(flag);
    if (['--restart', '--json'].includes(flag)) { options[flag.slice(2)] = true; continue; }
    if (!['--as', '--url', '--token', '--runs', '--timeout', '--query', '--args', '--artifacts'].includes(flag)) fail('E_WITNESS_INPUT', `unknown acquire argument ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) fail('E_WITNESS_INPUT', `${flag} needs a value`);
    options[flag.slice(2)] = value;
  }
  if (!options.as || /[\s\x00-\x1f]/.test(options.as)) fail('E_WITNESS_INPUT', '--as needs a persona or principal');
  for (const key of ['runs', 'timeout']) {
    if (!/^[1-9][0-9]*$/.test(String(options[key])) || !Number.isSafeInteger(Number(options[key]))) fail('E_WITNESS_INPUT', `--${key} needs a positive integer`);
    options[key] = Number(options[key]);
  }
  if (options.timeout > 86400) fail('E_WITNESS_INPUT', '--timeout must be at most 86400 seconds');
  let url;
  try { url = new URL(options.url); } catch { fail('E_WITNESS_INPUT', '--url needs an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('E_WITNESS_INPUT', '--url needs an HTTP(S) origin without credentials, path, query or fragment');
  options.url = url.origin;
  if (options.token && /[\s\x00-\x1f]/.test(options.token)) fail('E_WITNESS_INPUT', '--token needs a bearer token');
  if (!options.token && !/^(dev:)?[a-zA-Z0-9_-]+$/.test(options.as)) fail('E_WITNESS_INPUT', 'a principal needs --token; dev personas use --as alice or dev:alice');
  if (typeof options.args === 'string') {
    try { options.args = JSON.parse(options.args); } catch { fail('E_WITNESS_INPUT', '--args needs a JSON object'); }
    if (!options.args || Array.isArray(options.args) || typeof options.args !== 'object' || !options.query) fail('E_WITNESS_INPUT', '--args needs a JSON object and --query');
  }
  return options;
}

async function jsonRequest(url, headers, signal, fetcher) {
  const response = await fetcher(url, { headers, signal, redirect: 'error' });
  let body;
  try { body = await response.json(); } catch { fail('E_WITNESS_BACKEND', 'server did not return Snapback JSON'); }
  if (!response.ok || body?.denied) fail('E_AUTH', `server refused witness identity (HTTP ${response.status})`);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('E_WITNESS_BACKEND', 'server did not return a Snapback object');
  return body;
}

async function identity(options, signal, fetcher) {
  const persona = options.token ? undefined : options.as.replace(/^dev:/, '');
  const headers = options.token ? { authorization: `Bearer ${options.token}` } : { 'x-snapback-persona': persona };
  if (persona) {
    const status = await jsonRequest(`${options.url}/dev/status`, headers, signal, fetcher);
    if (!status.personas?.includes(persona)) fail('E_AUTH', `unknown persona ${persona}; use a declared persona or a principal with --token`);
  }
  const probe = await jsonRequest(`${options.url}/probe`, headers, signal, fetcher);
  const expected = persona ? `dev:${persona}` : options.as;
  if (probe.viewer !== expected) fail('E_AUTH', 'unknown principal or bearer principal does not match --as (use a server version supporting witness acquire)');
  // The server validates expiry on every request. Do not rotate or revoke the
  // caller's token merely to run a read-only witness; never persist it in receipts.
  return persona ? { persona } : { session: { principal: expected, token: options.token, kind: 'witness', expiresAt: Number.MAX_SAFE_INTEGER } };
}

async function waitFor(check, signal) {
  for (;;) {
    signal.throwIfAborted();
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function coverage(client, core) {
  const call = async request => {
    const reply = await core.call(request);
    if (reply.denied) fail(reply.denied.code, reply.denied.message);
    return reply.ok;
  };
  const state = await call({ op: 'sync_state', capture: false });
  const details = await call({ op: 'witness_coverage', viewer: client.viewer() });
  const groups = details.groups;
  const residency = await client.residency();
  const groupsByTable = Object.fromEntries(Object.entries(groups).map(([table, values]) => [table, Object.keys(values).length]));
  return { acquired: client.acquired && state.acquired, storeId: state.store_id,
    generation: state.generation, watermark: state.watermark,
    groups: Object.values(groupsByTable).reduce((a, b) => a + b, 0), groupsByTable,
    groupsSha256: digest(canonical(details)),
    rows: Object.values(residency.tables).reduce((sum, table) => sum + table.rows, 0), residency };
}

export function verifyRetained(before, after) {
  const shape = value => canonical({ acquired: value.acquired, storeId: value.storeId, generation: value.generation,
    watermark: value.watermark, groups: value.groupsSha256, tables: value.residency.tables });
  if (!after.acquired || JSON.stringify(shape(before)) !== JSON.stringify(shape(after))) fail('E_WITNESS_RECEIPT', 'cold restart coverage differs: acquired marker, store, generation, watermark, groups or table rows/bytes changed; retained proof failed');
}

export async function measure(options, { binary = resolveBinary(), beforeRestart, signal = new AbortController().signal } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'snapback4-acquire-'));
  let client, core, linkDown = false, phase = 'acquire', acquiredMs, transportFailure, deviceFailure;
  const requests = [], children = new Set();
  const started = performance.now();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeout * 1000)]);
  const stopChildren = () => { for (const child of children) child.kill(); };
  deadline.addEventListener('abort', stopChildren, { once: true });
  const result = { beforeHost: host(), requests, passed: false };
  const opener = processDevice({ binary, dir, spawn(command, args) {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    children.add(child); child.on('close', () => children.delete(child)); return child;
  } });
  const device = { async open(...args) {
    core = await opener.open(...args);
    const call = core.call.bind(core);
    core.call = async request => {
      if (!['apply', 'observe_store', 'install_native'].includes(request.op)) return call(request);
      const path = request.op === 'install_native' ? '/native.wasm' : '/sync';
      const sample = requests.findLast(r => r.phase === phase && r.path === path);
      try {
        const reply = await call(request);
        if (!reply || reply.denied || !reply.ok) throw new Error('device refused sync');
        if (request.op === 'apply' && sample) sample.applied = reply.ok.published === true;
        if (request.op === 'install_native' && sample) sample.installed = true;
        return reply;
      } catch {
        if (sample) { sample.outcome = 'failed'; sample.error = 'native validation/application failure'; }
        deviceFailure ??= new Error('E_WITNESS_RECEIPT: native device refused validation/application');
        throw deviceFailure;
      }
    };
    return core;
  } };
  // The witness drives explicit rounds; no background poll or server query can
  // supply the answer being timed. All SDK sync calls remain unmodified.
  const transport = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    if (linkDown || path.startsWith('/q/')) throw new TypeError('witness link down for this request');
    const requestSignal = AbortSignal.any([deadline, ...(init.signal ? [init.signal] : [])]);
    if (path === '/changes') return new Promise((_, reject) => {
      if (requestSignal.aborted) reject(requestSignal.reason);
      else requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
    });
    const start = performance.now();
    const sample = { phase, path, status: null, headerMs: null, serverTiming: null, serverMs: null, outcome: 'pending' };
    requests.push(sample); // Include attempts that fail before headers or body decoding.
    try {
      const response = await defaultFetch(input, { ...init, signal: requestSignal, redirect: 'error' });
      sample.status = response.status; sample.headerMs = ms(start);
      // Keep only timing syntax we produce: never reflect arbitrary header text.
      const timing = response.headers.get('server-timing');
      if (timing && /^(?:total|wait|engine|cpu);dur=[0-9]+(?:\.[0-9]+)?(?:,\s*(?:total|wait|engine|cpu);dur=[0-9]+(?:\.[0-9]+)?)*$/.test(timing)) {
        sample.serverTiming = timing;
        sample.serverMs = Object.fromEntries(timing.split(',').map(part => {
          const [name, value] = part.trim().split(';dur='); return [name, Number(value)];
        }));
      }
      if (response.status !== 200) fail('E_WITNESS_BACKEND', `HTTP ${response.status}`);
      const body = path === '/native.wasm' ? await response.clone().arrayBuffer() : await response.clone().json();
      if (path !== '/native.wasm' && (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'denied'))) fail('E_WITNESS_BACKEND', 'server refused the request or returned a malformed object');
      if (path === '/sync') {
        validateSync(body);
        Object.assign(sample, { snapshot: body.snapshot, more: body.more, watermark: body.watermark,
          imagesAt: body.images_at ?? null, generation: body.generation, storeId: body.store_id,
          putRows: body.events.filter(event => event.kind === 'put').length, events: body.events.length });
      }
      sample.outcome = 'validated';
      return response;
    } catch {
      sample.outcome = 'failed';
      // Remote text (including transformed credentials) never becomes a diagnostic.
      sample.error = sample.status === null ? 'transport failure before headers' : 'HTTP, body or protocol failure';
      const code = sample.status === 401 || sample.status === 403 ? 'E_AUTH' : 'E_WITNESS_BACKEND';
      transportFailure ??= new Error(`${code}: ${sample.error} during ${sample.phase} (HTTP ${sample.status ?? 'unavailable'}); check --url and credentials`);
      throw transportFailure;
    } finally { sample.totalMs = ms(start); }
  };
  const call = async request => {
    const reply = await core.call(request);
    if (reply.denied) fail(reply.denied.code, reply.denied.message);
    return reply.ok;
  };
  let selected;
  const firstAnswer = async origin => {
    const value = await client.query({ kind: 'query', name: selected.name }, selected.args);
    if (!('data' in value) || !value.complete) fail(phase === 'restart' ? 'E_WITNESS_RECEIPT' : 'E_WITNESS_INPUT', `${phase === 'restart' ? 'cold restart coverage differs: ' : ''}query ${selected.name} cannot give a complete local answer: ${value.denied?.message ?? 'choose a query within held coverage'}`);
    return ms(origin);
  };
  try {
    const credential = await identity(options, deadline, transport);
    const config = { url: options.url, ...credential, sessionStore: memorySessionStore(), device, fetch: transport };
    // Observe acquisition before starting the SDK. The first query follows that
    // barrier: this measures a complete local answer, not a server fallback.
    const prepared = await prepareClient(config, () => createLocalClient(config));
    client = prepared.client;
    const backend = await call({ op: 'backend' });
    const program = options.query ? backend.programs.find(p => p.name === options.query && p.kind === 'Query')
      : backend.programs.find(p => p.kind === 'Query' && p.runs !== 'server' && !p.ephemeral && Object.keys(p.args).length === 0);
    if (!program || program.runs === 'server' || program.ephemeral) fail('E_WITNESS_INPUT', 'choose a device query with --query NAME --args JSON (automatic selection needs a zero-argument device query)');
    selected = { name: program.name, args: options.query ? options.args : {} };
    for (const key of Object.keys(selected.args)) if (!Object.hasOwn(program.args, key)) fail('E_WITNESS_INPUT', `unknown query argument ${key}`);
    for (const key of Object.keys(program.args)) if (!Object.hasOwn(selected.args, key)) fail('E_WITNESS_INPUT', `query ${program.name} needs argument ${key}; pass --args JSON (null for optional arguments)`);
    client.onAcquired(value => { if (value) acquiredMs ??= ms(started); });
    await prepared.start();
    await waitFor(() => { if (transportFailure || deviceFailure) throw transportFailure ?? deviceFailure; return client.acquired; }, deadline);
    acquiredMs ??= ms(started);
    const firstLocalMs = await firstAnswer(started);
    result.query = selected;
    result.acquiredMs = acquiredMs; result.firstLocalMs = firstLocalMs;
    result.coverage = await coverage(client, core);
    if (!result.coverage.acquired) fail('E_WITNESS_RECEIPT', 'SDK did not acquire the partition');
    await client.close(); client = undefined;
    if (options.restart) {
      await beforeRestart?.({ dir, opener });
      phase = 'restart'; linkDown = true;
      const restartStart = performance.now();
      client = await createLocalClient({ ...config, sessionStore: memorySessionStore() });
      const restartFirst = await firstAnswer(restartStart);
      result.restart = { firstLocalMs: restartFirst, retained: false };
      const coverageStart = performance.now();
      const offline = await coverage(client, core);
      verifyRetained(result.coverage, offline);
      Object.assign(result.restart, { offline, coverageVerifiedMs: ms(coverageStart) });
      linkDown = false; phase = 'reconnect';
      await client.sync();
      if (transportFailure || deviceFailure) throw transportFailure ?? deviceFailure;
      const reconnected = await coverage(client, core);
      verifyRetained(result.coverage, reconnected);
      const sync = requests.filter(request => request.phase === 'reconnect' && request.path === '/sync');
      const terminal = sync.at(-1);
      if (!terminal || sync.some(s => s.outcome !== 'validated' || s.status !== 200 || s.events !== 0)
        || !terminal.applied || terminal.snapshot || terminal.more !== false || terminal.watermark !== terminal.imagesAt
        || reconnected.watermark !== terminal.watermark || reconnected.generation !== terminal.generation
        || reconnected.storeId !== terminal.storeId) fail('E_WITNESS_RECEIPT', 'reconnect did not complete at the server position with zero downloaded rows/events; keep the fixture stable and retry');
      Object.assign(result.restart, { retained: true, reconnected, completed: true, serverPosition: terminal.imagesAt, downloadedRows: sync.reduce((sum, s) => sum + s.putRows, 0), syncResponses: sync.length, snapshotResponses: sync.filter(s => s.snapshot).length });
    }
    if (transportFailure || deviceFailure) throw transportFailure ?? deviceFailure;
    result.passed = true; result.afterHost = host();
    result.serverSyncMs = requests.filter(r => r.phase === 'acquire' && r.path === '/sync').every(r => r.serverMs !== null)
      ? requests.filter(r => r.phase === 'acquire' && r.path === '/sync').reduce((sum, r) => sum + (r.serverMs.total ?? 0), 0) : null;
    return result;
  } catch (error) {
    const message = deadline.aborted ? `E_WITNESS_TIMEOUT: ${phase} did not finish within --timeout ${options.timeout} seconds, or was interrupted` : String(error);
    result.error = redact(message, [options.token]);
    throw Object.assign(new Error(result.error), { witnessRun: result });
  } finally {
    try { await client?.close(); } finally {
      stopChildren(); deadline.removeEventListener('abort', stopChildren);
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export async function run(args) {
  // Establish output redaction before parsing: invalid arguments can contain a token.
  const secrets = args.flatMap((arg, i) => arg === '--token' ? [args[i + 1]] : []);
  try { return await runWitness(args, secrets); }
  catch (error) { throw new Error(redact(String(error.message), secrets)); }
}

async function runWitness(args, secrets) {
  const options = parse(args);
  const dir = resolve(options.artifacts ?? join('artifacts', `acquire-${Date.now()}-${process.pid}`));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'acquire.json');
  // Reserve exclusively: never overwrite a previous proof, including a failure.
  await writeFile(path, '', { flag: 'wx', mode: 0o600 });
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('E_WITNESS_PROCESS: witness interrupted'));
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const receipt = { format: 1, kind: 'acquire', device: 'native-process', note: NOTE,
    sdkVersion: JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version,
    principal: options.as, url: options.url, startedAt: new Date().toISOString(),
    groupUnit: 'table/group pairs; see groupsByTable for the application envelope', runs: [], passed: false };
  let error;
  try {
    for (let i = 0; i < options.runs; i++) receipt.runs.push(await measure(options, { signal: controller.signal }));
    receipt.passed = true;
  } catch (e) { error = e; if (e.witnessRun) receipt.runs.push(e.witnessRun); receipt.error = controller.signal.aborted ? String(controller.signal.reason) : String(e); }
  finally {
    receipt.finishedAt = new Date().toISOString();
    await writeFile(path, `${JSON.stringify(sanitize(receipt, secrets), null, 2)}\n`, { mode: 0o600 });
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
  if (options.json) console.log(JSON.stringify(sanitize(receipt, secrets)));
  else {
    console.error(redact(`${NOTE}\nReceipt: ${path}`, secrets));
    for (const sample of receipt.runs) {
      if (!sample.passed) continue;
      const c = sample.coverage;
      console.log(redact(`acquired ${c.groups.toLocaleString('en-US')} table/groups / ${c.rows.toLocaleString('en-US')} rows / ${(c.residency.totalBytes / 1e6).toFixed(1)} MB in ${(sample.acquiredMs / 1000).toFixed(3)} s; first local ${sample.query.name} ${(sample.firstLocalMs / 1000).toFixed(3)} s; server sync ${sample.serverSyncMs === null ? 'unavailable' : `${(sample.serverSyncMs / 1000).toFixed(3)} s`}${sample.restart ? `; cold restart first local answer ${(sample.restart.firstLocalMs / 1000).toFixed(3)} s; coverage verified (${c.groups.toLocaleString('en-US')} table/groups) in ${(sample.restart.coverageVerifiedMs / 1000).toFixed(3)} s` : ''}`, secrets));
    }
  }
  if (error) throw error;
  return sanitize(receipt, secrets);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await run(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\nsee snapback4 guide bounds`); process.exitCode = 1; }
}
