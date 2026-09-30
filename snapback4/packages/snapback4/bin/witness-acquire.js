#!/usr/bin/env node
// @ref LLP 3000.030#13 — SDK acquisition, offline coverage, then a no-image reconnect.
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
const NOTE = 'Native process device (SQLite, same module as Expo); web wasm + IndexedDB figures differ. Bytes are SQLite pages, excluding WAL/SHM, not RSS.';

export function parse(args) {
  const options = { url: 'http://127.0.0.1:4400', runs: 1, timeout: 120, args: {} };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) fail('E_INPUT', `duplicate ${flag}`);
    seen.add(flag);
    if (['--restart', '--json'].includes(flag)) { options[flag.slice(2)] = true; continue; }
    if (!['--as', '--url', '--token', '--runs', '--timeout', '--query', '--args', '--artifacts'].includes(flag)) fail('E_INPUT', `unknown acquire argument ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) fail('E_INPUT', `${flag} needs a value`);
    options[flag.slice(2)] = value;
  }
  if (!options.as || /[\s\x00-\x1f]/.test(options.as)) fail('E_INPUT', '--as needs a persona or principal');
  for (const key of ['runs', 'timeout']) {
    if (!/^[1-9][0-9]*$/.test(String(options[key])) || !Number.isSafeInteger(Number(options[key]))) fail('E_INPUT', `--${key} needs a positive integer`);
    options[key] = Number(options[key]);
  }
  if (options.timeout > 86400) fail('E_INPUT', '--timeout must be at most 86400 seconds');
  let url;
  try { url = new URL(options.url); } catch { fail('E_INPUT', '--url needs an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('E_INPUT', '--url needs an HTTP(S) origin without credentials, path, query or fragment');
  options.url = url.origin;
  if (options.token && /[\s\x00-\x1f]/.test(options.token)) fail('E_INPUT', '--token needs a bearer token');
  if (!options.token && !/^(dev:)?[a-zA-Z0-9_-]+$/.test(options.as)) fail('E_INPUT', 'a principal needs --token; dev personas use --as alice or dev:alice');
  if (typeof options.args === 'string') {
    try { options.args = JSON.parse(options.args); } catch { fail('E_INPUT', '--args needs a JSON object'); }
    if (!options.args || Array.isArray(options.args) || typeof options.args !== 'object' || !options.query) fail('E_INPUT', '--args needs a JSON object and --query');
  }
  return options;
}

async function jsonRequest(url, headers, signal) {
  let response;
  try { response = await defaultFetch(url, { headers, signal, redirect: 'error' }); }
  catch { fail('E_WITNESS_BACKEND', 'server unreachable or request timed out; check --url and the running dev/serve'); }
  let body;
  try { body = await response.json(); } catch { fail('E_WITNESS_BACKEND', 'server did not return Snapback JSON'); }
  if (!response.ok || body.denied) fail('E_AUTH', body.denied?.message ?? `HTTP ${response.status}`);
  return body;
}

async function identity(options, signal) {
  const persona = options.token ? undefined : options.as.replace(/^dev:/, '');
  const headers = options.token ? { authorization: `Bearer ${options.token}` } : { 'x-snapback-persona': persona };
  if (persona) {
    const status = await jsonRequest(`${options.url}/dev/status`, headers, signal);
    if (!status.personas?.includes(persona)) fail('E_AUTH', `unknown persona ${persona}; use a declared persona or a principal with --token`);
  }
  const probe = await jsonRequest(`${options.url}/probe`, headers, signal);
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
  let client, core, linkDown = false, phase = 'acquire', acquiredMs;
  const requests = [], children = new Set();
  const started = performance.now();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.timeout * 1000)]);
  const stopChildren = () => { for (const child of children) child.kill(); };
  deadline.addEventListener('abort', stopChildren, { once: true });
  const result = { beforeHost: host() };
  const opener = processDevice({ binary, dir, spawn(command, args) {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    children.add(child); child.on('close', () => children.delete(child)); return child;
  } });
  const device = { async open(...args) { core = await opener.open(...args); return core; } };
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
    const start = performance.now(), requestPhase = phase;
    const response = await defaultFetch(input, { ...init, signal: requestSignal, redirect: 'error' });
    const sample = { phase: requestPhase, path, status: response.status, headerMs: ms(start), serverTiming: response.headers.get('server-timing') };
    requests.push(sample);
    sample.serverMs = sample.serverTiming === null ? null : Object.fromEntries(sample.serverTiming.split(',').map(part => {
      const [name, value] = part.trim().split(';dur='); return [name, Number(value)];
    }));
    if (path === '/sync') {
      const page = await response.clone().json();
      sample.snapshot = page.snapshot === true;
      sample.putRows = (page.events ?? []).filter(event => event.kind === 'put').length;
      sample.events = (page.events ?? []).length;
      if (page.denied) fail(page.denied.code, page.denied.message);
    }
    return response;
  };
  const call = async request => {
    const reply = await core.call(request);
    if (reply.denied) fail(reply.denied.code, reply.denied.message);
    return reply.ok;
  };
  let selected;
  const firstAnswer = async origin => {
    const value = await client.query({ kind: 'query', name: selected.name }, selected.args);
    if (!('data' in value) || !value.complete) fail(phase === 'restart' ? 'E_WITNESS_RECEIPT' : 'E_INPUT', `${phase === 'restart' ? 'cold restart coverage differs: ' : ''}query ${selected.name} cannot give a complete local answer: ${value.denied?.message ?? 'choose a query within held coverage'}`);
    return ms(origin);
  };
  try {
    const credential = await identity(options, deadline);
    const config = { url: options.url, ...credential, sessionStore: memorySessionStore(), device, fetch: transport };
    // Observe acquisition before starting the SDK. The first query follows that
    // barrier: this measures a complete local answer, not a server fallback.
    const prepared = await prepareClient(config, () => createLocalClient(config));
    client = prepared.client;
    const backend = await call({ op: 'backend' });
    const program = options.query ? backend.programs.find(p => p.name === options.query && p.kind === 'Query')
      : backend.programs.find(p => p.kind === 'Query' && p.runs !== 'server' && !p.ephemeral && Object.keys(p.args).length === 0);
    if (!program || program.runs === 'server' || program.ephemeral) fail('E_INPUT', 'choose a device query with --query NAME --args JSON (automatic selection needs a zero-argument device query)');
    selected = { name: program.name, args: options.query ? options.args : {} };
    for (const key of Object.keys(selected.args)) if (!Object.hasOwn(program.args, key)) fail('E_INPUT', `unknown query argument ${key}`);
    for (const key of Object.keys(program.args)) if (!Object.hasOwn(selected.args, key)) fail('E_INPUT', `query ${program.name} needs argument ${key}; pass --args JSON (null for optional arguments)`);
    client.onAcquired(value => { if (value) acquiredMs ??= ms(started); });
    await prepared.start();
    await waitFor(() => client.acquired, deadline);
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
      const offline = await coverage(client, core);
      verifyRetained(result.coverage, offline);
      result.restart = { firstLocalMs: restartFirst, offline, retained: false };
      linkDown = false; phase = 'reconnect';
      await client.sync();
      const reconnected = await coverage(client, core);
      verifyRetained(result.coverage, reconnected);
      const sync = requests.filter(request => request.phase === 'reconnect' && request.path === '/sync');
      if (!sync.length || sync.some(s => s.status !== 200 || s.events !== 0)) fail('E_WITNESS_RECEIPT', 'reconnect did not prove zero downloaded rows/events; keep the fixture stable and retry');
      Object.assign(result.restart, { retained: true, reconnected, downloadedRows: 0, syncResponses: sync.length, snapshotResponses: sync.filter(s => s.snapshot).length });
    }
    result.afterHost = host(); result.requests = requests;
    result.serverSyncMs = requests.filter(r => r.phase === 'acquire' && r.path === '/sync').every(r => r.serverMs !== null)
      ? requests.filter(r => r.phase === 'acquire' && r.path === '/sync').reduce((sum, r) => sum + (r.serverMs.total ?? 0), 0) : null;
    return result;
  } catch (error) {
    if (deadline.aborted) fail('E_WITNESS_TIMEOUT', `${phase} did not finish within --timeout ${options.timeout} seconds, or was interrupted`);
    throw error;
  } finally {
    try { await client?.close(); } finally {
      stopChildren(); deadline.removeEventListener('abort', stopChildren);
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export async function run(args) {
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
  } catch (e) { error = e; receipt.error = controller.signal.aborted ? String(controller.signal.reason) : String(e); }
  finally {
    receipt.finishedAt = new Date().toISOString();
    await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
  if (options.json) console.log(JSON.stringify(receipt));
  else {
    console.error(`${NOTE}\nReceipt: ${path}`);
    for (const sample of receipt.runs) {
      const c = sample.coverage;
      console.log(`acquired ${c.groups.toLocaleString('en-US')} table/groups / ${c.rows.toLocaleString('en-US')} rows / ${(c.residency.totalBytes / 1e6).toFixed(1)} MB in ${(sample.acquiredMs / 1000).toFixed(3)} s; first local ${sample.query.name} ${(sample.firstLocalMs / 1000).toFixed(3)} s; server sync ${sample.serverSyncMs === null ? 'unavailable' : `${(sample.serverSyncMs / 1000).toFixed(3)} s`}${sample.restart ? `; cold restart retained ${c.groups.toLocaleString('en-US')} table/groups in ${(sample.restart.firstLocalMs / 1000).toFixed(3)} s` : ''}`);
    }
  }
  if (error) throw error;
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await run(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\nsee snapback4 guide bounds`); process.exitCode = 1; }
}
