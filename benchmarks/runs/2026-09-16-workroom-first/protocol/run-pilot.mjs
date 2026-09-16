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
function verifyBoundFile(packet, relativePath, expected) {
  const path = join(packet, relativePath);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail('PILOT_PACKET_FILE_MISSING', relativePath);
  const actualPath = realpathSync(path);
  if (!within(packet, actualPath)) fail('PILOT_PACKET_PATH_ESCAPE', relativePath);
  const actual = fileReceipt(actualPath);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    fail('PILOT_PACKET_FILE_CHANGED', relativePath);
  }
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
  for (const file of manifest.files ?? []) verifyBoundFile(packet, file.staged, file.copied);
  verifyBoundFile(packet, manifest.brief.staged, manifest.brief.rendered);
  verifyBoundFile(packet, manifest.prompt.staged, manifest.prompt.copied);
  for (const profile of ['starter', 'conformance']) {
    for (const file of manifest.generatedProfiles[profile].files ?? []) {
      verifyBoundFile(packet, file.path, file);
    }
  }
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
  const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
  const stderrFd = openSync(stderrPath, 'wx', 0o600);
  const heartbeatFd = openSync(heartbeatPath, 'wx', 0o600);
  const env = childEnvironment();
  const version = spawnSync('codex', ['--version'], { env, encoding: 'utf8' });
  if (version.status !== 0) fail('PILOT_CODEX_UNAVAILABLE', version.stderr?.trim() ?? 'codex --version failed');

  const finalPath = join(app, 'FINAL.md');
  const command = ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox',
    '--ignore-user-config', '--skip-git-repo-check', '--json', '--color', 'never',
    '-m', MODEL, '-c', `model_reasoning_effort=${EFFORT}`, '-C', app,
    '-o', finalPath, '-'];
  const commandHash = sha256(JSON.stringify(command));
  const spawnedAt = iso();
  const monotonicStart = performance.now();
  const child = spawn(command[0], command.slice(1), {
    cwd: app, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.pid) fail('PILOT_SPAWN_FAILED');
  const pgid = child.pid; // POSIX detached spawn creates a new group led by the child.
  writePrivate(join(privateDir, 'pid.json'), { pid: child.pid, expectedPgid: pgid, detachedChild: true, recordedAt: iso() });
  const observed = spawnSync('ps', ['-o', 'pgid=', '-p', String(child.pid)], { env, encoding: 'utf8' });
  if (observed.status !== 0 || Number(observed.stdout.trim()) !== pgid) {
    process.kill(-pgid, 'SIGTERM');
    fail('PILOT_PROCESS_GROUP_UNVERIFIED', observed.stdout.trim());
  }
  writePrivate(join(privateDir, 'process-group.json'), { pid: child.pid, pgid, verifiedAt: iso(), source: 'ps' });

  const deadlineAt = new Date(Date.now() + MAX_MS).toISOString();
  writePrivate(join(privateDir, 'start.json'), {
    kind: 'workroom-diagnostic-pilot', spawnedAt, promptDeliveredAt: iso(), deadlineAt,
    pid: child.pid, pgid, cwd: app, model: MODEL, effort: EFFORT,
    command, commandSha256: commandHash, ephemeral: false,
    codexVersion: version.stdout.trim(), node: process.version,
    prompt: { path: promptPath, bytes: prompt.length, sha256: sha256(prompt) },
    stageManifest: fileReceipt(manifestPath), environmentKeys: Object.keys(env).sort(),
    initialFreeBytes: initialFree.toString(), stdout: stdoutPath, stderr: stderrPath,
  });

  let threadId = null;
  let stdoutText = '';
  child.stdout.on('data', chunk => {
    writeSync(stdoutFd, chunk);
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
  });
  child.stderr.on('data', chunk => writeSync(stderrFd, chunk));
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  let stop = null;
  let escalation = null;
  function stopGroup(reason, signal = 'SIGTERM') {
    if (stop) return;
    stop = { reason, signal, requestedAt: iso(), pid: child.pid, pgid };
    writePrivate(join(privateDir, 'termination.json'), stop);
    try { process.kill(-pgid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-pgid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }, 30_000);
  }
  const onSigint = () => stopGroup('driver-SIGINT');
  const onSigterm = () => stopGroup('driver-SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  function heartbeat() {
    const free = diskFree(root);
    const record = {
      at: iso(), elapsedSeconds: Math.round((performance.now() - monotonicStart) / 1000),
      pid: child.pid, pgid, freeBytes: free.toString(),
      ...(telemetry ? { loadAverage: loadavg(), memory: { free: freemem(), total: totalmem() } } : {}),
    };
    writeSync(heartbeatFd, JSON.stringify(record) + '\n');
    console.log(`[pilot] heartbeat ${record.at} elapsed=${record.elapsedSeconds}s pid=${child.pid} freeGiB=${(Number(free) / 2 ** 30).toFixed(2)}`);
    if (free < MIN_FREE_BYTES) stopGroup('disk-floor');
  }
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  const ceilingTimer = setTimeout(() => stopGroup('four-hour-operational-ceiling'), MAX_MS);

  const result = await new Promise(resolveResult => {
    child.once('error', error => resolveResult({ code: null, signal: null, spawnError: error.message }));
    child.once('close', (code, signal) => resolveResult({ code, signal, spawnError: null }));
  });
  clearInterval(heartbeatTimer); clearTimeout(ceilingTimer); if (escalation) clearTimeout(escalation);
  process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);
  closeSync(stdoutFd); closeSync(stderrFd); closeSync(heartbeatFd);

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
  const end = {
    kind: 'workroom-diagnostic-pilot', endedAt: iso(),
    wallSeconds: Math.round((performance.now() - monotonicStart) / 1000),
    pid: child.pid, pgid, model: MODEL, effort: EFFORT,
    exitCode: result.code, exitSignal: result.signal, spawnError: result.spawnError,
    termination: stop, threadId, nativeRollout: nativeReceipt,
    stdout: fileReceipt(stdoutPath), stderr: fileReceipt(stderrPath), final: fileReceipt(finalPath),
  };
  writePrivate(join(privateDir, 'end.json'), end);
  console.log(`[pilot] exit=${result.code ?? 'null'} signal=${result.signal ?? 'none'} lifecycle=${privateDir}`);
  if (stop?.reason === 'four-hour-operational-ceiling') return 124;
  if (stop?.reason === 'disk-floor') return 125;
  if (stop?.reason === 'driver-SIGINT') return 130;
  if (stop?.reason === 'driver-SIGTERM') return 143;
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
