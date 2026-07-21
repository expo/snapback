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
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '@snapback/codegen';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RUNTIME_PACKAGES = new Map([
  ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
]);

function diagnosticError(code, message, details = undefined) {
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

function scrubDynamicLoaderEnvironment(environment = process.env) {
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

function readReadyDescriptor(path) {
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

function native(binary, args, options = {}) {
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

function managedAdminToken(descriptor, database) {
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

async function waitForReady(path, child, timeoutMs = 15_000) {
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

export async function runDev(options = {}) {
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const stateRoot = join(projectRoot, '.snapback');
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = resolve(options.readyFile ?? join(stateRoot, 'dev.ready.json'));
  const database = resolve(options.database ?? join(stateRoot, 'dev.sqlite3'));
  const databaseExistedBeforeStart = existsSync(database);
  const runtime = resolveRuntimeBinary(options);
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
      stdio: options.serverStdio ?? 'inherit',
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
  let generationRunning = false;
  let queuedFilename = null;
  const drainGenerationQueue = async () => {
    if (generationRunning || closed) return;
    generationRunning = true;
    try {
      while (!closed && queuedFilename !== null) {
        const filename = queuedFilename;
        queuedFilename = null;
        let next;
        try {
          next = await generateApp(backendRoot);
        } catch (error) {
          options.onEvent?.({
            schemaVersion: 'snapback.dev.v1',
            ok: false,
            state: 'generation-failed',
            changed: filename,
            diagnostics: [error.diagnostic ?? {
              code: error.code ?? 'SNAPBACK_DEV_GENERATION_FAILED',
              severity: 'error',
              subsystem: 'codegen',
              message: error.message,
            }],
          });
          continue;
        }
        if (!next.ok) {
          options.onEvent?.({ ...next, schemaVersion: 'snapback.dev.v1', state: 'generation-failed', changed: filename });
          continue;
        }
        if (closed) break;
        try {
          loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken);
          options.onEvent?.({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'generated-and-loaded', changed: filename });
        } catch (error) {
          options.onEvent?.({
            schemaVersion: 'snapback.dev.v1',
            ok: true,
            state: 'generated-but-not-loaded',
            changed: filename,
            diagnostics: [error.diagnostic],
          });
        }
      }
    } finally {
      generationRunning = false;
      if (!closed && queuedFilename !== null) void drainGenerationQueue();
    }
  };
  const watcher = watch(backendRoot, { recursive: true }, (_event, filename) => {
    if (closed || !filename || filename.startsWith('generated')) return;
    queuedFilename = filename;
    clearTimeout(timer);
    timer = setTimeout(() => void drainGenerationQueue(), 100);
  });
  return {
    ...result,
    child,
    close() {
      closed = true;
      clearTimeout(timer);
      watcher.close();
      closeManaged();
    },
  };
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
    const result = await runDev({
      backendDirectory: args.shift() ?? 'snapback',
      attach,
      watch: !noWatch,
      ...(readyFile ? { readyFile } : {}),
      ...(database ? { database } : {}),
      onEvent(event) { console.log(JSON.stringify(event)); },
      ...options,
    });
    if (noWatch) {
      result.close?.();
    } else if (result.ok) {
      await new Promise((resolveStop, rejectStop) => {
        let stopping = false;
        const stop = () => {
          if (stopping) return;
          stopping = true;
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          result.close?.();
          resolveStop();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        result.child?.once('exit', (code, signal) => {
          if (stopping) return;
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          rejectStop(diagnosticError(
            'SNAPBACK_DEV_SERVER_EXITED',
            'the managed Snapback server exited while dev watch was active',
            { code, signal },
          ));
        });
      });
    }
    return result.ok ? 0 : 1;
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
