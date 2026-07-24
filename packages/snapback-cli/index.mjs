// @ref LLP 0041#cli-commands — the package-owned commands orchestrate the
// external developer loop; every existing host operation delegates to the
// same native CLI instead of growing a second lifecycle dialect.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { generate } from '@snapback/codegen';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RUNTIME_PACKAGES = new Map([
  ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
]);

export function diagnosticError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'cli',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

export function scrubDynamicLoaderEnvironment(environment = process.env) {
  const clean = { ...environment };
  for (const key of Object.keys(clean)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete clean[key];
  }
  return clean;
}

export function resolveRuntimeBinary(options = {}) {
  const override = options.runtimeBinary ?? process.env.SNAPBACK_RUNTIME_BINARY;
  if (override) {
    const binary = resolve(override);
    if (!existsSync(binary)) {
      throw diagnosticError('SNAPBACK_RUNTIME_BINARY_MISSING', `runtime override does not exist: ${binary}`, { binary });
    }
    return { binary, source: 'override', platform: `${process.platform}-${process.arch}` };
  }
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const packageName = RUNTIME_PACKAGES.get(platform);
  if (!packageName) {
    throw diagnosticError(
      'SNAPBACK_IBEX_HOST_UNSUPPORTED',
      `no prebuilt Snapback runtime is published for ${platform}`,
      { platform, supported: [...RUNTIME_PACKAGES.keys()] },
    );
  }
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_RUNTIME_PACKAGE_MISSING',
      `${packageName} is not installed for ${platform}`,
      { platform, package: packageName },
    );
    error.cause = cause;
    throw error;
  }
  const binary = join(dirname(manifestPath), 'bin', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  if (!existsSync(binary)) {
    throw diagnosticError('SNAPBACK_RUNTIME_BINARY_MISSING', `runtime package has no executable at ${binary}`, {
      package: packageName,
      binary,
    });
  }
  return { binary, source: packageName, platform };
}

export function doctor(options = {}) {
  let runtime;
  try {
    runtime = resolveRuntimeBinary(options);
  } catch (error) {
    return { schemaVersion: 'snapback.cli-doctor.v1', ok: false, checks: [error.diagnostic] };
  }
  const launch = spawnSync(runtime.binary, ['--help'], {
    encoding: 'utf8',
    env: scrubDynamicLoaderEnvironment(options.env),
    timeout: 15_000,
  });
  if (launch.status !== 0) {
    return {
      schemaVersion: 'snapback.cli-doctor.v1',
      ok: false,
      runtime,
      checks: [{
        code: 'SNAPBACK_IBEX_RUNTIME_LOAD_FAILED',
        severity: 'error',
        subsystem: 'runtime',
        message: 'the installed Snapback binary did not launch with dynamic-loader overrides scrubbed',
        details: { status: launch.status, signal: launch.signal, stderr: launch.stderr?.slice(0, 2_000) ?? '' },
      }],
    };
  }
  return {
    schemaVersion: 'snapback.cli-doctor.v1',
    ok: true,
    runtime,
    checks: [{
      code: 'SNAPBACK_RUNTIME_LAUNCH_OK',
      severity: 'note',
      subsystem: 'runtime',
      message: 'the packaged Snapback binary launched without ambient dynamic-loader paths',
    }],
  };
}

function safeProjectName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && name !== '.' && name !== '..';
}

function packageVersion() {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
}

export function scaffoldApp(target, options = {}) {
  const template = options.template ?? 'todo-contract';
  const destination = resolve(target);
  if (!safeProjectName(destination.split(/[/\\]/).pop())) {
    throw diagnosticError('SNAPBACK_NEW_NAME_INVALID', `invalid Snapback project name: ${target}`);
  }
  if (existsSync(destination)) {
    throw diagnosticError('SNAPBACK_NEW_TARGET_EXISTS', `refusing to overwrite existing target ${destination}`, { target: destination });
  }
  const templateRoot = join(packageRoot, 'templates', template);
  if (!existsSync(templateRoot)) {
    throw diagnosticError('SNAPBACK_NEW_TEMPLATE_UNKNOWN', `unknown template ${template}`, { template });
  }
  cpSync(templateRoot, destination, { recursive: true, errorOnExist: true });
  const manifestPath = join(destination, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.name = destination.split(/[/\\]/).pop().toLowerCase();
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, value] of Object.entries(manifest[section] ?? {})) {
      if (value === '__SNAPBACK_VERSION__') manifest[section][name] = `^${packageVersion()}`;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { schemaVersion: 'snapback.scaffold.v1', ok: true, template, target: destination };
}

export async function generateApp(backendDirectory, options = {}) {
  const targetProfile = options.targetProfile ?? 'local-dev-sqlite-ibex';
  const result = await generate(resolve(backendDirectory), { targetProfile });
  return {
    schemaVersion: 'snapback.generate.v1',
    ...result,
    targetProfile,
  };
}

export function readReadyDescriptor(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_DEV_READY_FILE_INVALID', `could not parse readiness descriptor ${path}`, { path });
    error.cause = cause;
    throw error;
  }
  if (
    value?.schemaVersion !== 'snapback.v0'
    || value?.descriptorKind !== 'snapbackHostReady'
    || value?.ready !== true
    || !Number.isInteger(value?.pid)
    || typeof value?.serverUrl !== 'string'
  ) {
    throw diagnosticError('SNAPBACK_DEV_READY_FILE_INVALID', `file is not a ready Snapback host descriptor: ${path}`, { path });
  }
  return value;
}

export function validateDevTarget(descriptor, { readyFile, database }) {
  const observed = descriptor?.database?.path ? resolve(descriptor.database.path) : null;
  const expected = database ? resolve(database) : null;
  if (expected !== observed) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names a different database target',
      { readyFile: resolve(readyFile), expectedDatabase: expected, observedDatabase: observed },
    );
  }
  return descriptor;
}

export function native(binary, args, options = {}) {
  return spawnSync(binary, args, {
    cwd: options.cwd,
    env: scrubDynamicLoaderEnvironment(options.env),
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
  });
}

function requireNativeSuccess(result, code, operation) {
  if (result.status !== 0) {
    throw diagnosticError(code, `${operation} failed`, {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 4_000) ?? '',
      stderr: result.stderr?.slice(0, 4_000) ?? '',
    });
  }
  return result;
}

export function managedAdminToken(descriptor, database) {
  const declared = descriptor?.adminTokenFile;
  if (typeof declared !== 'string') return null;
  const expected = `${resolve(database)}.admin-token`;
  if (resolve(declared) !== expected) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names an unexpected admin-token carrier',
      { expectedAdminTokenFile: expected, observedAdminTokenFile: resolve(declared) },
    );
  }
  let metadata;
  try {
    metadata = lstatSync(expected);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the managed database admin-token carrier is missing or unreadable',
      { path: expected },
    );
    error.cause = cause;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the managed database admin-token carrier must be an owner-only regular file',
      { path: expected },
    );
  }
  const token = readFileSync(expected, 'utf8').trim();
  if (!token) {
    throw diagnosticError('SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID', 'the managed database admin-token carrier is empty', { path: expected });
  }
  return token;
}

export async function waitForReady(path, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return readReadyDescriptor(path);
    if (child.exitCode !== null) {
      throw diagnosticError('SNAPBACK_DEV_SERVER_START_FAILED', `Snapback exited before writing ${path}`, {
        status: child.exitCode,
      });
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw diagnosticError('SNAPBACK_DEV_SERVER_READY_TIMEOUT', `Snapback did not write ${path} within ${timeoutMs}ms`, { path });
}

function loadGenerated(binary, projectRoot, backendRoot, readyFile, adminToken, { seed = false } = {}) {
  const generated = join(backendRoot, 'generated');
  const targetArgs = ['--ready-file', readyFile, ...(adminToken ? ['--token', adminToken] : [])];
  requireNativeSuccess(native(binary, [
    'load', ...targetArgs,
    '--schema', join(generated, 'schema.manifest.json'),
    '--functions', join(generated, 'functions.manifest.json'),
  ], { cwd: projectRoot }), 'SNAPBACK_DEV_SERVER_LOAD_FAILED', 'schema/function load');
  const seedPath = join(backendRoot, 'seed.json');
  if (seed && existsSync(seedPath)) {
    requireNativeSuccess(
      native(binary, ['reset', ...targetArgs, '--seed', seedPath], { cwd: projectRoot }),
      'SNAPBACK_DEV_SERVER_SEED_FAILED',
      'seed load',
    );
  }
}

// Resolve the client arm named by `snapback dev --client` / `--client-command`.
// The CLI stays surface-agnostic: it runs the surface's own dev command in the
// surface directory and never embeds frontend dev-server logic — the SC-2a
// plugin inside that command attaches to the CLI-managed server through the
// shared ready file (LLP 0041's boundary with LLP 0030).
//
// @ref LLP 0079#sc-2b-wire-the-client-arm-into-the-dev-loop-watch-process-from-llp-0078-r1-a3 —
//   the client arm is one spawned command in the same watch process; default
//   discovery is the surface package.json `dev` script under the repo runner.
function resolveClientArm(client, projectRoot) {
  if (client === undefined || client === null || client === false) return null;
  const spec = typeof client === 'string' ? { directory: client } : client;
  const directory = resolve(projectRoot, spec.directory ?? '.');
  if (typeof spec.command === 'string' && spec.command.trim()) {
    return { directory, command: spec.command };
  }
  const manifestPath = join(directory, 'package.json');
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = null;
    }
  }
  if (typeof manifest?.scripts?.dev !== 'string') {
    throw diagnosticError(
      'SNAPBACK_DEV_CLIENT_COMMAND_MISSING',
      `no client dev command: ${directory} has no package.json "dev" script; pass --client-command`,
      { directory, manifestPath },
    );
  }
  return { directory, command: 'bun run dev' };
}

export async function runDev(options = {}) {
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const stateRoot = join(projectRoot, '.snapback');
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = resolve(options.readyFile ?? join(stateRoot, 'dev.ready.json'));
  const database = resolve(options.database ?? join(stateRoot, 'dev.sqlite3'));
  const databaseExistedBeforeStart = existsSync(database);
  const runtime = resolveRuntimeBinary(options);
  const clientArm = resolveClientArm(options.client, projectRoot);
  const generated = await generateApp(backendRoot);
  if (!generated.ok) return { ...generated, state: 'generation-failed' };

  let managed = false;
  let child = null;
  let descriptor;
  if (existsSync(readyFile)) {
    descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
  } else {
    if (options.attach === true) {
      throw diagnosticError('SNAPBACK_DEV_READY_FILE_REQUIRED', `--attach requires ${readyFile}`, { readyFile });
    }
    child = spawn(runtime.binary, ['start', '--ready-file', readyFile, '--db', database], {
      cwd: projectRoot,
      env: scrubDynamicLoaderEnvironment(options.env),
      stdio: options.serverStdio ?? ['ignore', 2, 2],
    });
    managed = true;
    try {
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGTERM');
      throw error;
    }
  }
  const closeManaged = () => {
    if (managed && child?.exitCode === null) {
      native(runtime.binary, ['stop', '--ready-file', readyFile], { cwd: projectRoot });
    }
  };
  let adminToken;
  try {
    adminToken = managedAdminToken(descriptor, database);
    requireNativeSuccess(
      native(runtime.binary, [
        'inspect', '--ready-file', readyFile,
        ...(adminToken ? ['--token', adminToken] : []),
      ], { cwd: projectRoot }),
      'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
      'ready-file attach',
    );
    loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken, {
      seed: managed && !databaseExistedBeforeStart,
    });
  } catch (error) {
    closeManaged();
    throw error;
  }

  const result = {
    schemaVersion: 'snapback.dev.v1',
    ok: true,
    state: 'generated-and-loaded',
    managed,
    readyFile,
    serverUrl: descriptor.serverUrl,
    runtime,
  };
  options.onEvent?.(result);
  if (options.watch === false) {
    return { ...result, child, close: closeManaged };
  }

  let timer = null;
  let closed = false;
  let restarting = false;
  let queuedFilename = null;
  let lastLoad = { state: result.state, changed: null, ok: true };
  const emitDevEvent = (event) => {
    if (event.state === 'generated-and-loaded' || event.state === 'generated-but-not-loaded' || event.state === 'generation-failed') {
      lastLoad = { state: event.state, changed: event.changed ?? null, ok: event.ok === true };
    }
    options.onEvent?.(event);
    return event;
  };

  const regenerateAndLoad = async (filename, extra = {}) => {
    let next;
    try {
      next = await generateApp(backendRoot);
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'generation-failed',
        changed: filename,
        ...extra,
        diagnostics: [error.diagnostic ?? {
          code: error.code ?? 'SNAPBACK_DEV_GENERATION_FAILED',
          severity: 'error',
          subsystem: 'codegen',
          message: error.message,
        }],
      });
    }
    if (!next.ok) {
      return emitDevEvent({ ...next, schemaVersion: 'snapback.dev.v1', state: 'generation-failed', changed: filename, ...extra });
    }
    if (closed) return null;
    try {
      loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken);
      return emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'generated-and-loaded', changed: filename, ...extra });
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'generated-but-not-loaded',
        changed: filename,
        ...extra,
        diagnostics: [error.diagnostic],
      });
    }
  };

  // One dev operation at a time: watcher passes, forced reloads, and backend
  // restarts serialize on the same chain, so a verb never races a hot-push.
  let workChain = Promise.resolve();
  const withDevLock = (task) => {
    const run = workChain.then(task, task);
    workChain = run.then(() => undefined, () => undefined);
    return run;
  };
  const drainGenerationQueue = () => withDevLock(async () => {
    while (!closed && queuedFilename !== null) {
      const filename = queuedFilename;
      queuedFilename = null;
      await regenerateAndLoad(filename);
    }
  });
  const watcher = watch(backendRoot, { recursive: true }, (_event, filename) => {
    // Ignore codegen's own outputs: the committed `generated/` tree and the
    // `.generated.tmp-*` staging directories it renames into place —
    // otherwise every regeneration retriggers the watcher forever.
    if (closed || !filename || filename.startsWith('generated') || filename.startsWith('.generated')) return;
    queuedFilename = filename;
    clearTimeout(timer);
    timer = setTimeout(() => void drainGenerationQueue(), 100);
  });

  const attachExitWatch = (proc) => {
    proc?.once('exit', (code, signal) => {
      if (closed || restarting || proc !== child) return;
      emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: false, state: 'server-exited', code, signal });
      options.onServerExit?.(code, signal);
    });
  };
  attachExitWatch(child);

  // The client arm: one spawned surface dev command, streamed as events so
  // the machine-readable stdout stays one JSON-line stream.
  let clientProcess = null;
  const startClientArm = () => {
    const spawned = spawn(clientArm.command, {
      shell: true,
      cwd: clientArm.directory,
      // Own process group: the shell-spawned tree (runner, Vite, esbuild)
      // tears down as one unit on close.
      detached: true,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    clientProcess = {
      child: spawned,
      pid: spawned.pid ?? null,
      command: clientArm.command,
      directory: clientArm.directory,
      exitCode: null,
      signal: null,
    };
    const forward = (stream, name) => {
      let buffer = '';
      stream.setEncoding('utf8');
      const emitLines = (flush) => {
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.length > 0 && !closed) {
            emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'client-output', stream: name, line });
          }
        }
        if (flush && buffer.length > 0 && !closed) {
          emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'client-output', stream: name, line: buffer });
          buffer = '';
        }
      };
      stream.on('data', (chunk) => {
        buffer += chunk;
        emitLines(false);
      });
      stream.on('close', () => emitLines(true));
    };
    forward(spawned.stdout, 'stdout');
    forward(spawned.stderr, 'stderr');
    spawned.once('exit', (code, signal) => {
      clientProcess.exitCode = code;
      clientProcess.signal = signal;
      if (!closed) {
        emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: code === 0, state: 'client-exited', code, signal });
      }
    });
    spawned.once('error', (error) => {
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'client-exited',
        code: null,
        signal: null,
        diagnostics: [{
          code: 'SNAPBACK_DEV_CLIENT_SPAWN_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: `client dev command failed to spawn: ${error.message}`,
          details: { command: clientArm.command, directory: clientArm.directory },
        }],
      });
    });
    emitDevEvent({
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-started',
      pid: clientProcess.pid,
      command: clientArm.command,
      directory: clientArm.directory,
    });
  };
  const closeClientArm = () => {
    if (!clientProcess || clientProcess.exitCode !== null || clientProcess.signal !== null) return;
    const { child: proc } = clientProcess;
    const signalGroup = (signal) => {
      try {
        process.kill(-proc.pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // already gone
        }
      }
    };
    signalGroup('SIGTERM');
    const escalate = setTimeout(() => {
      if (clientProcess.exitCode === null && clientProcess.signal === null) signalGroup('SIGKILL');
    }, 5_000);
    escalate.unref?.();
  };
  // The client spawns only after the managed server is up and the first
  // generate+load completed, so its plugin's `auto` mode attaches to the
  // CLI-managed server through the ready file instead of racing to spawn one.
  if (clientArm) startClientArm();

  const clientStatus = () => {
    if (clientArm === null && clientProcess === null) return null;
    if (clientProcess === null) return { running: false, pid: null, exitCode: null, signal: null };
    return {
      running: clientProcess.exitCode === null && clientProcess.signal === null,
      pid: clientProcess.pid,
      exitCode: clientProcess.exitCode,
      signal: clientProcess.signal,
      command: clientProcess.command,
      directory: clientProcess.directory,
    };
  };

  // The dev-loop verb slice: status / reload / restart, each usable from the
  // interactive keybindings and the machine-readable stdin command channel,
  // and available with or without a client arm. Every verb resolves to the
  // event it emitted; none of them throws.
  const statusVerb = ({ requestId } = {}) => Promise.resolve(emitDevEvent({
    schemaVersion: 'snapback.dev.v1',
    ok: true,
    state: 'status',
    verb: 'status',
    ...(requestId === undefined ? {} : { requestId }),
    server: {
      managed,
      pid: descriptor.pid ?? null,
      serverUrl: descriptor.serverUrl,
      readyFile,
      database,
      running: child ? child.exitCode === null : null,
    },
    lastLoad,
    client: clientStatus(),
  }));
  const reloadVerb = ({ requestId } = {}) => withDevLock(
    () => regenerateAndLoad('(reload)', {
      verb: 'reload',
      ...(requestId === undefined ? {} : { requestId }),
    }),
  );
  // Restart stops the managed server (nonce-verified native stop) and starts
  // it again against the same ready file and database, then re-runs the
  // generate+load pass. The client arm keeps running: its relay re-resolves
  // the backend target from the rewritten ready file, so restart never
  // requires restarting the client process.
  const restartVerb = ({ requestId } = {}) => withDevLock(async () => {
    const tag = requestId === undefined ? {} : { requestId };
    if (closed) return null;
    if (!managed || child === null) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'restart-failed',
        verb: 'restart',
        ...tag,
        diagnostics: [{
          code: 'SNAPBACK_DEV_RESTART_UNMANAGED',
          severity: 'error',
          subsystem: 'cli',
          message: 'dev attached to an externally started server; restart only manages the child this process spawned',
          details: { readyFile },
        }],
      });
    }
    restarting = true;
    try {
      const previousPid = descriptor.pid ?? null;
      if (child.exitCode === null && child.signalCode === null) {
        const stop = native(runtime.binary, ['stop', '--ready-file', readyFile], { cwd: projectRoot });
        if (stop.status !== 0 && child.exitCode === null) child.kill('SIGTERM');
      }
      const deadline = Date.now() + 10_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (existsSync(readyFile)) rmSync(readyFile, { force: true });
      child = spawn(runtime.binary, ['start', '--ready-file', readyFile, '--db', database], {
        cwd: projectRoot,
        env: scrubDynamicLoaderEnvironment(options.env),
        stdio: options.serverStdio ?? ['ignore', 2, 2],
      });
      attachExitWatch(child);
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
      adminToken = managedAdminToken(descriptor, database);
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'server-restarted',
        verb: 'restart',
        ...tag,
        previousPid,
        pid: descriptor.pid ?? null,
        serverUrl: descriptor.serverUrl,
      });
      return await regenerateAndLoad('(restart)', { ...tag });
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'restart-failed',
        verb: 'restart',
        ...tag,
        diagnostics: [error.diagnostic ?? {
          code: error.code ?? 'SNAPBACK_DEV_RESTART_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: error.message,
        }],
      });
    } finally {
      restarting = false;
    }
  });

  return {
    ...result,
    child,
    verbs: { status: statusVerb, reload: reloadVerb, restart: restartVerb },
    close() {
      closed = true;
      clearTimeout(timer);
      watcher.close();
      closeClientArm();
      closeManaged();
    },
  };
}

// The two dev-loop control channels over stdin. A TTY gets single-key verbs
// (s=status, r=reload, R=restart backend, q=quit); anything else is the
// machine-readable channel: newline-delimited JSON commands
// (`{"schemaVersion":"snapback.dev-command.v1","verb":"status"|"reload"|"restart"}`,
// optional `requestId` echoed on the response event). Responses and events
// ride the one `snapback.dev.v1` JSON-line stream on stdout; unknown or
// malformed commands produce a structured `command-error` event, never a
// crash. Returns a detach function.
export function attachDevControlChannel({ verbs, stop, onEvent, stdin = process.stdin }) {
  const emit = (event) => onEvent?.({ schemaVersion: 'snapback.dev.v1', ...event });
  const commandError = (code, message, details) => emit({
    ok: false,
    state: 'command-error',
    diagnostics: [{ code, severity: 'error', subsystem: 'cli', message, ...(details ? { details } : {}) }],
  });
  const invoke = (verb, context) => {
    Promise.resolve(verbs[verb](context)).catch((error) => {
      commandError(error.code ?? 'SNAPBACK_DEV_COMMAND_FAILED', `dev verb ${verb} failed: ${error.message}`, { verb });
    });
  };
  if (stdin.isTTY) {
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onKey = (key) => {
      if (key === 's') invoke('status', {});
      else if (key === 'r') invoke('reload', {});
      else if (key === 'R') invoke('restart', {});
      else if (key === 'q' || key === '\u0003') stop();
    };
    stdin.on('data', onKey);
    emit({
      ok: true,
      state: 'control-ready',
      channel: 'tty',
      keys: { s: 'status', r: 'regenerate and reload', R: 'restart backend', q: 'quit' },
    });
    return () => {
      stdin.off('data', onKey);
      stdin.setRawMode?.(false);
      stdin.pause();
    };
  }
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      commandError('SNAPBACK_DEV_COMMAND_INVALID', 'dev commands are newline-delimited JSON objects', { line: line.slice(0, 200) });
      return;
    }
    if (command?.schemaVersion !== 'snapback.dev-command.v1' || typeof command?.verb !== 'string') {
      commandError(
        'SNAPBACK_DEV_COMMAND_INVALID',
        'expected {"schemaVersion":"snapback.dev-command.v1","verb":"..."}',
        { line: line.slice(0, 200) },
      );
      return;
    }
    const context = typeof command.requestId === 'string' ? { requestId: command.requestId } : {};
    if (!Object.hasOwn(verbs, command.verb)) {
      emit({
        ok: false,
        state: 'command-error',
        ...context,
        diagnostics: [{
          code: 'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB',
          severity: 'error',
          subsystem: 'cli',
          message: `unknown dev verb ${command.verb}`,
          details: { verb: command.verb, supported: Object.keys(verbs) },
        }],
      });
      return;
    }
    invoke(command.verb, context);
  });
  lines.on('close', () => stop());
  emit({
    ok: true,
    state: 'control-ready',
    channel: 'json',
    commandSchemaVersion: 'snapback.dev-command.v1',
    verbs: Object.keys(verbs),
  });
  return () => lines.close();
}

function takeFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', `${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function printResult(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`${result.schemaVersion}: ok`);
  else console.error(JSON.stringify(result, null, 2));
}

export async function runCli(argv, options = {}) {
  const args = [...argv];
  const command = args.shift();
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  if (command === 'doctor') {
    const result = doctor(options);
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'new') {
    const target = args.shift();
    if (!target) throw diagnosticError('SNAPBACK_NEW_NAME_REQUIRED', 'usage: snapback new <name> [--template todo-contract]');
    const template = takeFlag(args, '--template', 'todo-contract');
    const result = scaffoldApp(target, { template });
    printResult(result, json);
    return 0;
  }
  if (command === 'generate') {
    const targetProfile = takeFlag(args, '--target-profile', 'local-dev-sqlite-ibex');
    const result = await generateApp(args.shift() ?? 'snapback', { targetProfile });
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'dev') {
    const attach = args.includes('--attach');
    if (attach) args.splice(args.indexOf('--attach'), 1);
    const noWatch = args.includes('--no-watch');
    if (noWatch) args.splice(args.indexOf('--no-watch'), 1);
    const readyFile = takeFlag(args, '--ready-file');
    const database = takeFlag(args, '--db');
    const clientDirectory = takeFlag(args, '--client');
    const clientCommand = takeFlag(args, '--client-command');
    // A restart replaces the managed child, so unexpected-exit detection goes
    // through runDev's onServerExit callback instead of a listener pinned to
    // the first child process.
    let onUnexpectedServerExit = null;
    const result = await runDev({
      backendDirectory: args.shift() ?? 'snapback',
      attach,
      watch: !noWatch,
      ...(readyFile ? { readyFile } : {}),
      ...(database ? { database } : {}),
      ...(clientDirectory || clientCommand
        ? {
          client: {
            ...(clientDirectory ? { directory: clientDirectory } : {}),
            ...(clientCommand ? { command: clientCommand } : {}),
          },
        }
        : {}),
      onEvent(event) { console.log(JSON.stringify(event)); },
      onServerExit(code, signal) { onUnexpectedServerExit?.(code, signal); },
      ...options,
    });
    if (noWatch) {
      result.close?.();
    } else if (result.ok) {
      await new Promise((resolveStop, rejectStop) => {
        let stopping = false;
        let detachInput = () => {};
        const settle = () => {
          stopping = true;
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          detachInput();
          result.close?.();
        };
        function stop() {
          if (stopping) return;
          settle();
          resolveStop();
        }
        onUnexpectedServerExit = (code, signal) => {
          if (stopping) return;
          settle();
          rejectStop(diagnosticError(
            'SNAPBACK_DEV_SERVER_EXITED',
            'the managed Snapback server exited while dev watch was active',
            { code, signal },
          ));
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        detachInput = attachDevControlChannel({
          verbs: result.verbs,
          stop,
          onEvent(event) { console.log(JSON.stringify(event)); },
          stdin: options.stdin ?? process.stdin,
        });
      });
    }
    return result.ok ? 0 : 1;
  }
  if (command === 'mcp-control') {
    // @ref LLP 0042#implementation-decisions-recorded-for-sc-1b-2026-07-23 —
    // the control-plane MCP server ships inside @snapback/cli as a JS
    // command, reusing the CLI lifecycle helpers instead of the native
    // binary's guide-only `snapback mcp`.
    const readyFile = takeFlag(args, '--ready-file');
    const database = takeFlag(args, '--db');
    const { runMcpControl } = await import('./mcp-control.mjs');
    return runMcpControl({
      backendDirectory: args.shift() ?? 'snapback',
      ...(readyFile ? { readyFile } : {}),
      ...(database ? { database } : {}),
      ...options,
    });
  }
  const runtime = resolveRuntimeBinary(options);
  const delegatedArgs = command === undefined ? [] : [command, ...args];
  const result = spawnSync(runtime.binary, delegatedArgs, {
    stdio: 'inherit',
    env: scrubDynamicLoaderEnvironment(options.env),
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export const __test = { loadGenerated, readReadyDescriptor, scrubDynamicLoaderEnvironment };
