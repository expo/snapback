#!/usr/bin/env node
// Run the one 2026-09-16 Workroom diagnostic pilot in the foreground.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statfsSync,
  writeFileSync, writeSync,
} from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE = 'v24.13.1';
const MODEL = 'gpt-5.6-sol';
const EFFORT = 'xhigh';
const MAX_MS = 4 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const MIN_FREE_BYTES = 2n * 1024n * 1024n * 1024n;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const iso = () => new Date().toISOString();
function fail(code, detail = '') { throw new Error(detail ? `${code}: ${detail}` : code); }
function writePrivate(path, value) {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
}
function within(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`);
}
function gitRoot(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? resolve(result.stdout.trim()) : null;
}
function diskFree(path) {
  const fs = statfsSync(path, { bigint: true });
  return fs.bavail * fs.bsize;
}
function fileReceipt(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) return null;
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
function expectedPacketFiles(manifest) {
  const files = [];
  for (const file of manifest.files ?? []) files.push([file.staged, file.copied]);
  files.push([manifest.brief?.staged, manifest.brief?.rendered]);
  files.push([manifest.prompt?.staged, manifest.prompt?.copied]);
  for (const profile of ['starter', 'conformance']) {
    for (const file of manifest.generatedProfiles?.[profile]?.files ?? []) files.push([file.path, file]);
  }
  return files;
}
function packetIntegrity(packet, manifest, capturedManifest) {
  const failures = [];
  let checked = 0;
  for (const [relativePath, expected] of expectedPacketFiles(manifest)) {
    checked++;
    try {
      if (typeof relativePath !== 'string' || !expected) fail('PILOT_PACKET_BINDING_INVALID');
      const path = join(packet, relativePath);
      if (!existsSync(path) || !lstatSync(path).isFile()) fail('PILOT_PACKET_FILE_MISSING');
      const actualPath = realpathSync(path);
      if (!within(packet, actualPath)) fail('PILOT_PACKET_PATH_ESCAPE');
      const actual = fileReceipt(actualPath);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail('PILOT_PACKET_FILE_CHANGED');
    } catch (error) {
      failures.push({ path: relativePath ?? null, reason: error.message });
    }
  }
  if (capturedManifest) {
    checked++;
    const current = fileReceipt(capturedManifest.path);
    if (!current || current.bytes !== capturedManifest.bytes || current.sha256 !== capturedManifest.sha256) {
      failures.push({ path: 'stage-manifest.json', reason: 'PILOT_STAGE_MANIFEST_CHANGED' });
    }
  }
  return { ok: failures.length === 0, checked, failures };
}
function childEnvironment() {
  const allowed = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'NO_COLOR', 'USER', 'LOGNAME', 'SHELL'];
  const env = {};
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key];
  if (!env.HOME || !env.PATH) fail('PILOT_ENV_REQUIRED', 'HOME and PATH must be supplied');
  env.TMPDIR ??= '/tmp';
  return env;
}
function findExactRollout(home, threadId) {
  if (!threadId) return { status: 'unavailable', reason: 'thread.started did not provide an id' };
  const root = join(home, '.codex', 'sessions');
  if (!existsSync(root)) return { status: 'unavailable', reason: 'native sessions directory absent' };
  const wanted = `-${threadId}.jsonl`;
  const matches = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(wanted)) matches.push(path);
    }
  }
  visit(root);
  if (matches.length !== 1) return {
    status: 'unavailable',
    reason: matches.length === 0 ? 'no exact thread-id rollout found' : 'multiple exact thread-id rollouts found',
    matchCount: matches.length,
  };
  return { status: 'found', path: matches[0] };
}
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

export async function runPilot(rootArgument, { telemetry = false } = {}) {
  if (process.platform === 'win32') fail('PILOT_POSIX_REQUIRED');
  if (process.version !== REQUIRED_NODE) fail('PILOT_NODE_VERSION', `need ${REQUIRED_NODE}, got ${process.version}`);
  const root = realpathSync(resolve(rootArgument));
  if (gitRoot(root)) fail('PILOT_ROOT_IN_REPO', root);
  const app = realpathSync(join(root, 'app'));
  const packet = realpathSync(join(root, 'packet'));
  if (!within(root, app) || !within(root, packet)) fail('PILOT_STAGED_PATH_ESCAPE');
  if (readdirSync(app).length !== 0) fail('PILOT_APP_NOT_FRESH', app);
  const manifestPath = join(packet, 'stage-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.kind !== 'workroom-diagnostic-pilot-packet'
      || manifest.snapback4 !== '0.2.26' || manifest.rawHoldoutsDelivered !== false) {
    fail('PILOT_STAGE_MANIFEST_INVALID');
  }
  for (const profile of ['starter', 'conformance']) {
    if (manifest.generatedProfiles?.[profile]?.verified?.verified !== true) fail('PILOT_PROFILE_UNVERIFIED', profile);
  }
  const capturedManifest = fileReceipt(manifestPath);
  const initialIntegrity = packetIntegrity(packet, manifest, capturedManifest);
  if (!initialIntegrity.ok) fail('PILOT_PACKET_INTEGRITY', JSON.stringify(initialIntegrity.failures));
  const promptPath = join(packet, 'pilot-prompt.md');
  const prompt = readFileSync(promptPath);
  if (sha256(prompt) !== manifest.prompt.copied.sha256 || prompt.length !== manifest.prompt.copied.bytes) {
    fail('PILOT_PROMPT_CHANGED');
  }
  const initialFree = diskFree(root);
  if (initialFree < MIN_FREE_BYTES) fail('PILOT_DISK_FLOOR', `${initialFree} bytes available`);

  const privateDir = join(root, 'private');
  if (existsSync(privateDir)) fail('PILOT_RUN_ALREADY_EXISTS', privateDir);
  mkdirSync(privateDir, { mode: 0o700 });
  const stdoutPath = join(privateDir, 'codex.stdout.jsonl');
  const stderrPath = join(privateDir, 'codex.stderr.log');
  const heartbeatPath = join(privateDir, 'heartbeat.ndjson');
  const cleanupPath = join(privateDir, 'process-group.ndjson');
  const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
  const stderrFd = openSync(stderrPath, 'wx', 0o600);
  const heartbeatFd = openSync(heartbeatPath, 'wx', 0o600);
  const cleanupFd = openSync(cleanupPath, 'wx', 0o600);
  const env = childEnvironment();
  const childNode = spawnSync('node', ['--version'], { env, encoding: 'utf8' });
  const childNodeVersion = childNode.stdout?.trim() ?? '';
  if (childNode.status !== 0 || childNodeVersion !== REQUIRED_NODE) {
    fail('PILOT_CHILD_NODE_VERSION', `need ${REQUIRED_NODE}, got ${childNodeVersion || childNode.stderr?.trim() || childNode.error?.message || 'unavailable'}`);
  }
  const version = spawnSync('codex', ['--version'], { env, encoding: 'utf8' });
  if (version.status !== 0) fail('PILOT_CODEX_UNAVAILABLE', version.stderr?.trim() ?? 'codex --version failed');

  const builderFinalPath = join(app, 'FINAL.md');
  const lastMessagePath = join(privateDir, 'last-message.md');
  const command = ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox',
    '--ignore-user-config', '--skip-git-repo-check', '--json', '--color', 'never',
    '-m', MODEL, '-c', `model_reasoning_effort=${EFFORT}`, '-C', app,
    '-o', lastMessagePath, '-'];
  const commandHash = sha256(JSON.stringify(command));
  const spawnedAt = iso();
  const monotonicStart = performance.now();
  const child = spawn(command[0], command.slice(1), {
    cwd: app, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.pid) fail('PILOT_SPAWN_FAILED');
  const pgid = child.pid; // POSIX detached spawn creates a new group led by the child.
  const exitPromise = new Promise(resolveExit => {
    child.once('error', error => resolveExit({ code: null, signal: null, spawnError: error.message }));
    child.once('exit', (code, signal) => resolveExit({ code, signal, spawnError: null }));
  });
  const closePromise = new Promise(resolveClose => {
    child.once('error', error => resolveClose({ code: null, signal: null, spawnError: error.message }));
    child.once('close', (code, signal) => resolveClose({ code, signal, spawnError: null }));
  });
  const groupEvents = [];
  const recordGroup = (event, detail = {}) => {
    const record = { at: iso(), event, pid: child.pid, pgid, ...detail };
    groupEvents.push(record);
    try { writeSync(cleanupFd, JSON.stringify(record) + '\n'); } catch { /* end.json retains the in-memory record */ }
  };
  let groupValidated = false;
  const groupExists = () => {
    if (!groupValidated) return false;
    try { process.kill(-pgid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  const waitForGroupGone = async milliseconds => {
    const until = Date.now() + milliseconds;
    while (groupExists() && Date.now() < until) await delay(100);
    return !groupExists();
  };
  let cleanupPromise = null;
  const cleanupGroup = reason => cleanupPromise ??= (async () => {
    if (!groupValidated) {
      recordGroup('group-not-targeted', { reason: 'group identity was not validated' });
      return { disappeared: false, unverified: true };
    }
    if (!groupExists()) {
      recordGroup('group-disappeared', { reason, after: 'no-signal' });
      return { disappeared: true, after: 'no-signal' };
    }
    recordGroup('signal', { reason, signal: 'SIGTERM' });
    try { process.kill(-pgid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (await waitForGroupGone(30_000)) {
      recordGroup('group-disappeared', { reason, after: 'SIGTERM' });
      return { disappeared: true, after: 'SIGTERM' };
    }
    recordGroup('signal', { reason, signal: 'SIGKILL' });
    try { process.kill(-pgid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const disappeared = await waitForGroupGone(10_000);
    recordGroup(disappeared ? 'group-disappeared' : 'group-still-present', { reason, after: 'SIGKILL' });
    return { disappeared, after: 'SIGKILL' };
  })();
  const cleanupExactChild = async reason => {
    const alive = () => child.exitCode === null && child.signalCode === null;
    if (!alive()) {
      recordGroup('exact-child-disappeared', { reason, after: 'no-signal' });
      return { disappeared: true, exactChildOnly: true, after: 'no-signal' };
    }
    recordGroup('exact-child-signal', { reason, signal: 'SIGTERM' });
    try { child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([exitPromise, delay(5_000)]);
    if (!alive()) {
      recordGroup('exact-child-disappeared', { reason, after: 'SIGTERM' });
      return { disappeared: true, exactChildOnly: true, after: 'SIGTERM' };
    }
    recordGroup('exact-child-signal', { reason, signal: 'SIGKILL' });
    try { child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([exitPromise, delay(5_000)]);
    const disappeared = !alive();
    recordGroup(disappeared ? 'exact-child-disappeared' : 'exact-child-still-present', { reason, after: 'SIGKILL' });
    return { disappeared, exactChildOnly: true, after: 'SIGKILL' };
  };
  let threadId = null;
  let stdoutText = '';
  let streamError = null;
  const onStdout = chunk => {
    try { writeSync(stdoutFd, chunk); }
    catch (error) { streamError ??= error.message; requestStop('stdout-log-failure'); }
    stdoutText += chunk.toString('utf8');
    let newline;
    while ((newline = stdoutText.indexOf('\n')) >= 0) {
      const line = stdoutText.slice(0, newline); stdoutText = stdoutText.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && typeof (event.thread_id ?? event.threadId ?? event.id) === 'string') {
          threadId ??= event.thread_id ?? event.threadId ?? event.id;
        }
      } catch { /* Raw output is authoritative; malformed/non-JSON lines remain there. */ }
    }
  };
  const onStderr = chunk => {
    try { writeSync(stderrFd, chunk); }
    catch (error) { streamError ??= error.message; requestStop('stderr-log-failure'); }
  };
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.stdin.on('error', () => {});
  let stop = null;
  function requestStop(reason) {
    if (stop) return;
    stop = { reason, requestedAt: iso(), pid: child.pid, pgid };
    try { writePrivate(join(privateDir, 'termination.json'), stop); } catch (error) { stop.recordError = error.message; }
    cleanupGroup(reason).catch(error => { streamError ??= `group cleanup: ${error.message}`; });
  }
  const onSigint = () => requestStop('driver-SIGINT');
  const onSigterm = () => requestStop('driver-SIGTERM');
  let heartbeatTimer = null;
  let ceilingTimer = null;
  let result = { code: null, signal: null, spawnError: null };
  let lifecycleError = null;
  let groupCleanup = null;
  try {
    writePrivate(join(privateDir, 'pid.json'), { pid: child.pid, expectedPgid: pgid, detachedChild: true, recordedAt: iso() });
    const observed = spawnSync('ps', ['-o', 'pgid=', '-p', String(child.pid)], { env, encoding: 'utf8' });
    if (observed.status !== 0 || Number(observed.stdout.trim()) !== pgid) {
      fail('PILOT_PROCESS_GROUP_UNVERIFIED', observed.stdout.trim());
    }
    groupValidated = true;
    writePrivate(join(privateDir, 'process-group.json'), { pid: child.pid, pgid, verifiedAt: iso(), source: 'ps' });
    const deadlineAt = new Date(Date.now() + MAX_MS).toISOString();
    writePrivate(join(privateDir, 'start.json'), {
      kind: 'workroom-diagnostic-pilot', spawnedAt, promptDeliveredAt: iso(), deadlineAt,
      pid: child.pid, pgid, cwd: app, model: MODEL, effort: EFFORT,
      command, commandSha256: commandHash, ephemeral: false,
      codexVersion: version.stdout.trim(), node: process.version, childNode: childNodeVersion,
      prompt: { path: promptPath, bytes: prompt.length, sha256: sha256(prompt) },
      stageManifest: capturedManifest, packetIntegrity: initialIntegrity,
      environmentKeys: Object.keys(env).sort(), initialFreeBytes: initialFree.toString(),
      stdout: stdoutPath, stderr: stderrPath, lastMessage: lastMessagePath,
    });
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    const heartbeat = () => {
      try {
        const free = diskFree(root);
        const record = {
          at: iso(), elapsedSeconds: Math.round((performance.now() - monotonicStart) / 1000),
          pid: child.pid, pgid, freeBytes: free.toString(),
          ...(telemetry ? { loadAverage: loadavg(), memory: { free: freemem(), total: totalmem() } } : {}),
        };
        writeSync(heartbeatFd, JSON.stringify(record) + '\n');
        console.log(`[pilot] heartbeat ${record.at} elapsed=${record.elapsedSeconds}s pid=${child.pid} freeGiB=${(Number(free) / 2 ** 30).toFixed(2)}`);
        if (free < MIN_FREE_BYTES) requestStop('disk-floor');
      } catch (error) {
        streamError ??= `heartbeat: ${error.message}`;
        requestStop('heartbeat-failure');
      }
    };
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    ceilingTimer = setTimeout(() => requestStop('four-hour-operational-ceiling'), MAX_MS);
    child.stdin.end(prompt);
    result = await exitPromise;
  } catch (error) {
    lifecycleError = error.message;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ceilingTimer) clearTimeout(ceilingTimer);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    if (groupValidated) {
      try { groupCleanup = await cleanupGroup(stop?.reason ?? (lifecycleError ? 'lifecycle-error' : 'leader-exited')); }
      catch (error) { groupCleanup = { disappeared: false, error: error.message }; lifecycleError ??= `group cleanup: ${error.message}`; }
    } else {
      recordGroup('group-not-targeted', { reason: 'group identity was not validated' });
      try { groupCleanup = await cleanupExactChild(lifecycleError ? 'lifecycle-error' : 'group-unverified'); }
      catch (error) { groupCleanup = { disappeared: false, exactChildOnly: true, error: error.message }; lifecycleError ??= `exact child cleanup: ${error.message}`; }
    }
    await Promise.race([closePromise, delay(2_000)]);
    child.stdout.off('data', onStdout); child.stderr.off('data', onStderr);
    child.stdout.destroy(); child.stderr.destroy();
    for (const fd of [stdoutFd, stderrFd, heartbeatFd, cleanupFd]) {
      try { closeSync(fd); } catch { /* end record carries lifecycle errors already observed */ }
    }
  }
  let nativeReceipt;
  try {
    const native = findExactRollout(env.HOME, threadId);
    nativeReceipt = native;
    if (native.status === 'found') {
      const retained = join(privateDir, basename(native.path));
      copyFileSync(native.path, retained, constants.COPYFILE_EXCL);
      chmodSync(retained, 0o600);
      nativeReceipt = { status: 'retained', source: native.path, ...fileReceipt(retained) };
    }
  } catch (error) {
    nativeReceipt = { status: 'unavailable', reason: `native rollout retention failed: ${error.message}` };
  }
  const finalIntegrity = packetIntegrity(packet, manifest, capturedManifest);
  const end = {
    kind: 'workroom-diagnostic-pilot', endedAt: iso(),
    wallSeconds: Math.round((performance.now() - monotonicStart) / 1000),
    pid: child.pid, pgid, model: MODEL, effort: EFFORT,
    exitCode: result.code, exitSignal: result.signal, spawnError: result.spawnError,
    lifecycleError, streamError, termination: stop, groupCleanup, groupEvents,
    threadId, nativeRollout: nativeReceipt, packetIntegrity: finalIntegrity,
    stdout: fileReceipt(stdoutPath), stderr: fileReceipt(stderrPath),
    builderFinal: fileReceipt(builderFinalPath), lastMessage: fileReceipt(lastMessagePath),
  };
  writePrivate(join(privateDir, 'end.json'), end);
  console.log(`[pilot] exit=${result.code ?? 'null'} signal=${result.signal ?? 'none'} lifecycle=${privateDir}`);
  if (stop?.reason === 'four-hour-operational-ceiling') return 124;
  if (stop?.reason === 'disk-floor') return 125;
  if (stop?.reason === 'driver-SIGINT') return 130;
  if (stop?.reason === 'driver-SIGTERM') return 143;
  if (!finalIntegrity.ok) return 126;
  if (lifecycleError || streamError || groupCleanup?.disappeared === false) return 1;
  return result.code ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const telemetry = args[0] === '--telemetry';
    if (telemetry) args.shift();
    if (args.length !== 1) fail('PILOT_USAGE', 'run-pilot.mjs [--telemetry] STAGED_DESTINATION');
    process.exitCode = await runPilot(args[0], { telemetry });
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}
