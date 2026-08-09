#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { SnapbackAppDataClient } from '@expo/snapback-client/app-data';

import {
  invokeAppFunction,
  jcsCanonical,
  loadAppArtifacts,
  loadServedApp,
  renderCodeModeTypes,
  runCodeMode,
  startAppFunctionLive,
} from './index.mjs';
import {
  DEFAULT_DIGEST_BUDGET_BYTES,
  DEFAULT_DIGEST_BUDGET_ITEMS,
  buildAgentDigest,
} from './digest.mjs';
import {
  assertPrincipalAdmitted,
  assertSupportedHost,
  onboardAgentProfile,
  preflightFunctionPrincipal,
  principalClient,
  readCredentialReference,
  readPrivateSecretFile,
  selectPrincipal,
} from './auth.mjs';
import {
  buildResultCore,
  classifyDiagnosticExit,
  diagnosticRecord,
  resultExitCode,
  wrapCallResult,
} from './result-core.mjs';
import { runIbexCodeMode } from './code-mode-ibex.mjs';
import { loginWithOAuth } from './oauth.mjs';

const PACKAGE_VERSION = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).version;
const ENGINE = Object.freeze({ name: '@expo/snapback-app-cli', version: PACKAGE_VERSION });
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  '--artifacts', '--server', '--app', '--principal', '--dev-user',
  '--session-bearer-file', '--agent-profile', '--args-json', '--request',
  '--pairing-code-file', '--scopes-json', '--profile-out', '--credential-file',
  '--credential-env', '--admission-wait-ms', '--token-ttl-ms',
  '--out', '--timeout', '--timeout-ms', '--call-timeout-ms', '--max-calls',
  '--max-subscriptions', '--max-output-bytes', '--max-stderr-bytes', '--heap-mb', '--grace-ms',
  '--changed-since', '--budget-bytes', '--budget-items',
  '--scopes', '--profile-dir',
]);
const BOOLEAN_FLAGS = new Set(['--json', '--offline', '--watch', '--first-change', '--no-browser', '--help', '--version', '-V']);

const parsed = (() => {
  const flags = new Map();
  const positionals = [];
  const tail = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      tail.push(...argv.slice(index + 1));
      break;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw Object.assign(new Error(`${arg} requires a value`), { code: 'SNAPBACK_APP_CLI_USAGE' });
      if (flags.has(arg)) throw Object.assign(new Error(`${arg} may be supplied once`), { code: 'SNAPBACK_APP_CLI_USAGE' });
      flags.set(arg, value);
      index += 1;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      if (flags.has(arg)) throw Object.assign(new Error(`${arg} may be supplied once`), { code: 'SNAPBACK_APP_CLI_USAGE' });
      flags.set(arg, true);
    } else if (arg.startsWith('-') && arg !== '-') {
      throw Object.assign(new Error(`unknown flag '${arg}'`), { code: 'SNAPBACK_APP_CLI_USAGE' });
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals, tail };
})();

const value = (flag) => parsed.flags.get(flag) ?? null;
const has = (flag) => parsed.flags.has(flag);
const appBoundBridge = globalThis.__ibexAppBoundWorkerV1 ?? null;
const appBoundContract = appBoundBridge === null ? null : JSON.parse(appBoundBridge.contract);
const positionalTarget = /^https?:\/\//iu.test(parsed.positionals[0] ?? '')
  ? parsed.positionals[0]
  : null;
const commandPositionals = positionalTarget === null
  ? parsed.positionals
  : parsed.positionals.slice(1);
const server = appBoundContract?.origin ?? value('--server') ?? positionalTarget;
const command = commandPositionals[0]
  ?? (appBoundContract === null && server !== null ? 'surface' : 'help');
const numberValue = (flag) => {
  const selected = value(flag);
  if (selected === null) return undefined;
  const parsedNumber = Number(selected);
  if (!Number.isSafeInteger(parsedNumber)) {
    throw Object.assign(new Error(`${flag} must be an integer`), { code: 'SNAPBACK_APP_CLI_USAGE' });
  }
  return parsedNumber;
};

const stdinText = async () => {
  const chunks = [];
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.once('error', reject);
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
};

const stdinScript = async () => {
  const script = await stdinText();
  if (!/\S/u.test(script)) {
    const error = new Error('run - reached stdin EOF without non-whitespace script source');
    error.code = 'SNAPBACK_APP_CLI_SCRIPT_EMPTY';
    error.diagnostic = Object.freeze({
      code: error.code,
      message: error.message,
      details: Object.freeze({
        source: 'stdin',
        repair: Object.freeze({
          kind: 'provideScriptSource',
          alternatives: Object.freeze([
            'pass a script file path',
            'pipe non-whitespace source to stdin',
          ]),
        }),
      }),
    });
    throw error;
  }
  return script;
};

const pastedAuthorizationCode = async () => {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await input.question('Paste the authorization code or callback URL: ');
  } finally {
    input.close();
  }
};

const jsonInput = async (flag, fallback) => {
  const selected = value(flag);
  const encoded = selected === '-' ? await stdinText() : selected ?? fallback;
  try { return JSON.parse(encoded); } catch (cause) {
    throw Object.assign(new Error(`${flag} must be valid JSON`, { cause }), { code: 'SNAPBACK_APP_CLI_USAGE' });
  }
};

const publicInspection = async (baseUrl) => {
  if (baseUrl === null) return null;
  const anonymous = new SnapbackAppDataClient(baseUrl, { custody: 'anonymous-public' });
  return anonymous.inspect();
};

const loadSurface = async ({ includeInspection = false } = {}) => {
  const artifactsDir = value('--artifacts');
  if (artifactsDir !== null) {
    const artifacts = await loadAppArtifacts(artifactsDir);
    const inspection = await publicInspection(server);
    return Object.freeze({
      ...artifacts,
      source: 'local',
      offline: false,
      inspection: includeInspection ? inspection : null,
      appCliDescriptor: inspection?.capabilityManifest?.appCliTarget ?? null,
    });
  }
  if (server === null) throw Object.assign(new Error('--server or --artifacts is required'), { code: 'SNAPBACK_APP_CLI_ARTIFACTS_REQUIRED' });
  const served = await loadServedApp(server, {
    offline: has('--offline'),
    appId: appBoundContract?.appId ?? value('--app'),
  });
  if (served?.status === 'unavailable') {
    throw Object.assign(
      new Error('this target serves no API envelope; supply its local generated artifact directory with --artifacts'),
      { code: 'SNAPBACK_APP_CLI_ARTIFACTS_REQUIRED' },
    );
  }
  return Object.freeze({
    ...served,
    inspection: includeInspection && !served.offline ? await publicInspection(server) : null,
  });
};

const selection = async () => selectPrincipal({
  requested: value('--principal') ?? 'anonymous',
  devUser: value('--dev-user'),
  sessionBearerFile: value('--session-bearer-file'),
  agentProfile: value('--agent-profile'),
});

const print = (document) => process.stdout.write(`${JSON.stringify(document, null, has('--json') ? 0 : 2)}\n`);
const printJsonLine = (document) => process.stdout.write(`${JSON.stringify(document)}\n`);

const resolveFunction = (surface, selector) => {
  const byId = surface.functions.filter((entry) => entry.id === selector);
  if (byId.length === 1) return byId[0];
  const byName = surface.functions.filter((entry) => entry.name === selector);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw Object.assign(new Error(`function selector '${selector}' is ambiguous; use a stable id`), { code: 'SNAPBACK_APP_CLI_USAGE' });
  }
  throw Object.assign(new Error(`function '${selector}' was not found`), { code: 'SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND' });
};

const snapshotQueue = () => {
  let queued = null;
  let waiter = null;
  let terminal = null;
  return Object.freeze({
    push(snapshot) {
      if (terminal !== null) return;
      if (waiter !== null) {
        const { resolve } = waiter;
        waiter = null;
        resolve(snapshot);
      } else queued = snapshot; // LLP 0062 latest-wins for a slow consumer.
    },
    fail(error) {
      terminal = error;
      if (waiter !== null) {
        const { reject } = waiter;
        waiter = null;
        reject(error);
      }
    },
    next() {
      if (queued !== null) {
        const snapshot = queued;
        queued = null;
        return Promise.resolve(snapshot);
      }
      if (terminal !== null) return Promise.reject(terminal);
      return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
    },
  });
};

const timeoutError = () => Object.assign(new Error('live subscription timed out'), {
  code: 'SNAPBACK_APP_CLI_TIMEOUT',
  exitCode: 9,
});

const awaitWithin = (promise, timeoutMs) => {
  if (timeoutMs === undefined) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
};

const openLive = async (principal, surface, fn, args) => {
  const snapshots = snapshotQueue();
  const started = startAppFunctionLive(principal.client, surface, fn.name, {
    args,
    connectionId: `snapback-app-cli-${process.pid}-${Date.now()}`,
    transport: 'stream',
    onUpdate: (rows) => snapshots.push(rows),
    onAuthorizationError: (error) => snapshots.fail(error),
    onConnectionChange: (connection, detail) => {
      if (connection === 'disconnected' && detail?.error) snapshots.fail(detail.error);
    },
  });
  await started.started();
  return Object.freeze({ started, snapshots });
};

// @ref LLP 0062#2-subcommand-surface — the per-app CLI's command grammar is
// discoverable from the same registry that renders exact per-command help.
const APP_CLI_COMMANDS = Object.freeze([
  Object.freeze({ name: 'introspect', usage: 'snapback-app [target/principal flags] introspect [--changed-since <digestCursor|envelopeHash>] [--budget-bytes <n>] [--budget-items <n>] [--json]', description: 'Return the budgeted agent digest for the admitted app surface.' }),
  Object.freeze({ name: 'whoami', usage: 'snapback-app [target/principal flags] whoami [--json]', description: 'Report the selected principal class and custody source.' }),
  Object.freeze({ name: 'login', usage: 'snapback-app --server <url> login [--scopes <bundle[,bundle...]>] [--no-browser] [--profile-dir <directory>] [--json]', description: 'Authorize through the app OAuth facade and store its short-lived bearer in an owner-only profile.', details: Object.freeze(['--scopes overrides the default read-bundle heuristic.', '--no-browser uses out-of-band callback/code paste instead of a loopback listener.', '--profile-dir overrides the target-keyed ~/.snapback/app-cli/oauth profile directory.']) }),
  Object.freeze({ name: 'call', usage: 'snapback-app --server <url> [target/principal flags] call <function> [--args-json <object|->] [--timeout-ms <ms>] [--json]', description: 'Invoke one query, mutation, action, or one-shot live query by stable id/name.' }),
  Object.freeze({ name: 'subscribe', usage: 'snapback-app --server <url> [target/principal flags] subscribe <live-query> [--args-json <object|->] [--watch|--first-change] [--timeout-ms <ms>] [--json]', description: 'Print the initial live snapshot, then the first changed snapshot or every changed snapshot.', details: Object.freeze(['--args-json supplies the live-query argument object.', '--watch streams every changed snapshot until signal or timeout.', '--first-change exits after the first snapshot that differs from the initial snapshot.', '--timeout-ms bounds the complete subscription observation.']) }),
  Object.freeze({ name: 'types', usage: 'snapback-app [target flags] types [--out <directory|->]', description: 'Render admitted API and code-mode TypeScript declarations.' }),
  Object.freeze({ name: 'run', usage: 'snapback-app --server <url> [target/principal flags] run <script.ts|-> [resource flags] [-- <args...>]', description: 'Execute a bounded TypeScript code-mode program; - reads the script from stdin.' }),
  Object.freeze({ name: 'pair', usage: 'snapback-app --server <url> pair --request <id> [--pairing-code-file <0600-file>] --profile-out <0600-profile> <--credential-file <0600-file>|--credential-env <name>> [--scopes-json <array|->] [--json]', description: 'Redeem an agent pairing request and persist the resulting owner-only profile.', details: Object.freeze(['--server selects the admitted origin.', '--request names the browser-created pairing request.', '--pairing-code-file carries the secret code; omit it to read stdin.', '--profile-out is the owner-only agent profile destination.', '--credential-file or --credential-env selects exactly one credential custody source.', '--scopes-json requests the bounded grant scopes.']) }),
]);

const help = (selected = null) => {
  const entry = APP_CLI_COMMANDS.find(({ name }) => name === selected) ?? null;
  if (entry !== null) {
    process.stdout.write([
      `Usage: ${entry.usage}`,
      '',
      entry.description,
      ...(entry.details ?? []),
      '',
    ].join('\n'));
    return;
  }
  process.stdout.write([
    'Usage: snapback-app <app-url>',
    'Usage: snapback-app --server <url> [--artifacts <generated-dir>] [--principal anonymous|dev|session|agent|auto] <command>',
    '',
    'Commands:',
    ...APP_CLI_COMMANDS.map(({ name, description }) => `  ${name.padEnd(10)} ${description}`),
    '',
    'Session custody: --session-bearer-file <0600-file> or SNAPBACK_APP_SESSION_BEARER',
    'Agent custody: --agent-profile <0600-profile> or SNAPBACK_APP_AGENT_PROFILE',
    'Run `snapback-app <command> --help` for exact command flags.',
    '',
  ].join('\n'));
};

try {
  if (positionalTarget !== null && value('--server') !== null) {
    throw Object.assign(new Error('supply the app URL positionally or with --server, not both'), { code: 'SNAPBACK_APP_CLI_USAGE' });
  }
  if (appBoundContract !== null && (has('--server') || has('--app') || has('--artifacts') || positionalTarget !== null)) {
    throw Object.assign(
      new Error('the app-bound executable fixes --server, --app, and its artifact source at build time'),
      { code: 'SNAPBACK_APP_CLI_USAGE' },
    );
  }
  if (has('--version') || has('-V')) {
    process.stdout.write(`snapback-app ${PACKAGE_VERSION}\n`);
  } else if (command === 'help' || has('--help')) {
    help(command === 'help' ? commandPositionals[1] ?? null : command);
  } else if (command === 'surface') {
    assertSupportedHost();
    const surface = await loadSurface();
    print({
      artifactKind: 'appCliSurface',
      formatVersion: 'snapback.app-cli-surface.v1',
      appId: surface.appId,
      envelopeDigest: surface.envelopeSha256 ?? null,
      functionCount: surface.functions.length,
      source: surface.source,
      availableVerbs: APP_CLI_COMMANDS.map(({ name }) => name),
      login: `snapback-app --server ${server} login`,
    });
  } else if (command === 'introspect') {
    assertSupportedHost();
    const surface = await loadSurface({ includeInspection: true });
    const selected = await selection();
    assertPrincipalAdmitted(surface.appCliDescriptor, selected.principalClass);
    const budgetBytes = numberValue('--budget-bytes') ?? DEFAULT_DIGEST_BUDGET_BYTES;
    const budgetItems = numberValue('--budget-items') ?? DEFAULT_DIGEST_BUDGET_ITEMS;
    print(buildAgentDigest({
      surface,
      inspection: surface.inspection,
      principalSource: selected.source,
      principalClass: selected.principalClass,
      changedSince: value('--changed-since'),
      budgetBytes,
      budgetItems,
    }));
  } else if (command === 'login') {
    assertSupportedHost();
    if (server === null) throw Object.assign(new Error('login requires --server or an app URL'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const receipt = await loginWithOAuth({
      origin: server,
      profileDirectory: value('--profile-dir'),
      requestedScopes: value('--scopes'),
      noBrowser: has('--no-browser'),
      loadInspection: () => publicInspection(server),
      readPastedCode: pastedAuthorizationCode,
      onAuthorizeUrl: (url, { mode }) => {
        process.stdout.write(`Authorize (${mode}): ${url}\n`);
      },
    });
    print(receipt);
  } else if (command === 'whoami') {
    assertSupportedHost();
    const selected = await selection();
    print({ principalClass: selected.principalClass, principalSource: selected.source });
  } else if (command === 'call') {
    assertSupportedHost();
    if (server === null) throw Object.assign(new Error('call requires --server'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const functionName = commandPositionals[1];
    if (!functionName) throw Object.assign(new Error('call requires a function selector'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const surface = await loadSurface();
    const selected = await selection();
    const fn = resolveFunction(surface, functionName);
    const args = await jsonInput('--args-json', '{}');
    preflightFunctionPrincipal(fn, selected);
    const principal = await principalClient(server, surface, selected, {
      admissionWaitMs: numberValue('--admission-wait-ms'),
      tokenTtlMs: numberValue('--token-ttl-ms'),
    });
    let live = null;
    try {
      let response;
      if (fn.kind === 'liveQuery') {
        live = await openLive(principal, surface, fn, args);
        response = { rows: await awaitWithin(live.snapshots.next(), numberValue('--timeout-ms') ?? numberValue('--timeout')) };
      } else {
        response = await awaitWithin(
          invokeAppFunction(principal.client, surface, fn.name, args),
          numberValue('--timeout-ms') ?? numberValue('--timeout') ?? 60_000,
        );
      }
      const kind = fn.kind === 'liveQuery' ? 'live-snapshot' : fn.kind;
      const appValue = (kind === 'query' || kind === 'live-snapshot') ? (response?.rows ?? response)
        : kind === 'mutation' ? (response?.result ?? response)
          : (response?.value ?? response?.result ?? response);
      const facts = response && typeof response === 'object'
        ? Object.fromEntries(Object.entries(response).filter(([key]) => !['rows', 'result', 'value', 'attribution'].includes(key)))
        : undefined;
      const core = buildResultCore({
        kind,
        outcome: 'ok',
        value: appValue,
        ...(facts && Object.keys(facts).length > 0 ? { facts } : {}),
        diagnostics: [],
        ...(response?.attribution === undefined ? {} : { attribution: response.attribution }),
      });
      print(wrapCallResult(core, {
        engine: ENGINE,
        ...(surface.envelopeSha256 ? { envelope: { envelopeDigest: surface.envelopeSha256, inputsHash: surface.generation?.inputsHash } } : {}),
      }));
      process.exitCode = resultExitCode(core);
    } finally {
      live?.started.dispose();
      await live?.started.settled();
      await principal.close();
    }
  } else if (command === 'subscribe') {
    assertSupportedHost();
    if (server === null) throw Object.assign(new Error('subscribe requires --server'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    if (has('--watch') && has('--first-change')) {
      throw Object.assign(new Error('--watch and --first-change are mutually exclusive'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    }
    const functionName = commandPositionals[1];
    if (!functionName) throw Object.assign(new Error('subscribe requires a function selector'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const surface = await loadSurface();
    const fn = resolveFunction(surface, functionName);
    if (fn.kind !== 'liveQuery') {
      throw Object.assign(new Error(`function '${functionName}' is not a live query`), { code: 'SNAPBACK_APP_CLI_USAGE' });
    }
    const selected = await selection();
    preflightFunctionPrincipal(fn, selected);
    const args = await jsonInput('--args-json', '{}');
    const principal = await principalClient(server, surface, selected, {
      admissionWaitMs: numberValue('--admission-wait-ms'),
      tokenTtlMs: numberValue('--token-ttl-ms'),
    });
    let live = null;
    let removeSignalHandlers = () => {};
    try {
      live = await openLive(principal, surface, fn, args);
      const timeoutMs = numberValue('--timeout-ms') ?? numberValue('--timeout');
      const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
      let rejectSignal;
      const signal = new Promise((_, reject) => { rejectSignal = reject; });
      const onSignal = (name, exitCode) => () => rejectSignal(Object.assign(new Error(name), {
        code: 'SNAPBACK_APP_CLI_SIGNAL',
        exitCode,
        signalExit: true,
      }));
      const onInterrupt = onSignal('SIGINT', 130);
      const onTerminate = onSignal('SIGTERM', 143);
      process.once('SIGINT', onInterrupt);
      process.once('SIGTERM', onTerminate);
      removeSignalHandlers = () => {
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onTerminate);
      };
      const next = () => awaitWithin(Promise.race([
        live.snapshots.next(),
        signal,
        ...(principal.renewalTerminal ? [principal.renewalTerminal.then((error) => Promise.reject(error))] : []),
      ]), deadline === null ? undefined : Math.max(1, deadline - Date.now()));
      let previous = null;
      const first = await next();
      previous = jcsCanonical(first);
      printJsonLine(first);
      if (has('--watch')) {
        for (;;) {
          const snapshot = await next();
          const canonical = jcsCanonical(snapshot);
          if (canonical === previous) continue;
          previous = canonical;
          printJsonLine(snapshot);
        }
      } else {
        for (;;) {
          const snapshot = await next();
          const canonical = jcsCanonical(snapshot);
          if (canonical === previous) continue;
          printJsonLine(snapshot);
          break;
        }
      }
    } finally {
      removeSignalHandlers();
      live?.started.dispose();
      await live?.started.settled();
      await principal.close();
    }
  } else if (command === 'types') {
    assertSupportedHost();
    const surface = await loadSurface();
    const declarations = renderCodeModeTypes(surface);
    const output = value('--out');
    if (output === null || output === '-') process.stdout.write(declarations);
    else {
      await mkdir(output, { recursive: true });
      const apiDeclarations = surface.apiDeclarations ?? surface.appBindings;
      if (typeof apiDeclarations !== 'string') {
        throw Object.assign(new Error('the admitted surface carries no api.d.ts declaration member'), { code: 'SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH' });
      }
      await Promise.all([
        writeFile(join(output, 'api.d.ts'), apiDeclarations, 'utf8'),
        writeFile(join(output, 'code-mode.d.ts'), declarations, 'utf8'),
      ]);
      print({ written: [join(output, 'api.d.ts'), join(output, 'code-mode.d.ts')], appId: surface.appId });
    }
  } else if (command === 'run') {
    assertSupportedHost();
    if (server === null) throw Object.assign(new Error('run requires --server'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const scriptPath = commandPositionals[1];
    if (!scriptPath) throw Object.assign(new Error('run requires a script path or -'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    // @ref LLP 0062#3-code-mode — stdin is a script-source contract, so EOF
    // without source is absence, not a successfully executed empty program.
    // Read it before artifact/principal setup so the refusal has no network or
    // credential side effects; an open producer still keeps the command alive.
    const script = scriptPath === '-' ? await stdinScript() : await readFile(scriptPath, 'utf8');
    const surface = await loadSurface();
    const selected = await selection();
    const principal = await principalClient(server, surface, selected, {
      admissionWaitMs: numberValue('--admission-wait-ms'),
      tokenTtlMs: numberValue('--token-ttl-ms'),
    });
    try {
      const result = await (appBoundBridge === null ? runCodeMode : runIbexCodeMode)({
        client: principal.client,
        surface,
        script,
        scriptSource: scriptPath === '-' ? 'stdin' : scriptPath,
        args: parsed.tail,
        principalClass: selected.principalClass,
        timeoutMs: numberValue('--timeout-ms') ?? numberValue('--timeout'),
        callTimeoutMs: numberValue('--call-timeout-ms'),
        maxCalls: numberValue('--max-calls'),
        maxSubscriptions: numberValue('--max-subscriptions'),
        maxOutputBytes: numberValue('--max-output-bytes'),
        maxStderrBytes: numberValue('--max-stderr-bytes'),
        heapMb: numberValue('--heap-mb'),
        graceMs: numberValue('--grace-ms'),
        requireLiveStream:
          appBoundBridge !== null
          && process.env.SNAPBACK_APP_CLI_QUALIFICATION_REQUIRE_LIVE_STREAM === '1',
        onStderr: (frame) => process.stderr.write(`${JSON.stringify(frame)}\n`),
      });
      if (result.hasValue) print(result.value);
      process.exitCode = 0;
    } finally {
      await principal.close();
    }
  } else if (command === 'pair') {
    assertSupportedHost();
    if (server === null) throw Object.assign(new Error('pair requires --server'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    const surface = await loadSurface();
    assertPrincipalAdmitted(surface.appCliDescriptor, 'agent');
    const pairingRequestId = value('--request');
    const profileOut = value('--profile-out');
    const credentialFile = value('--credential-file');
    const credentialEnv = value('--credential-env');
    if (!pairingRequestId || !profileOut || (credentialFile === null) === (credentialEnv === null)) {
      throw Object.assign(new Error('pair requires --request, --profile-out, and exactly one credential reference'), { code: 'SNAPBACK_APP_CLI_USAGE' });
    }
    // Secret challenge material never rides argv: file or stdin only.
    const pairingCode = value('--pairing-code-file') === null
      ? (await stdinText()).trim()
      : (await readPrivateSecretFile(value('--pairing-code-file'), 'pairing code')).trim();
    const credentialReference = credentialFile === null
      ? { kind: 'env', name: credentialEnv }
      : { kind: 'file', path: credentialFile };
    const credential = await readCredentialReference(credentialReference);
    const profile = await onboardAgentProfile({
      origin: server,
      appId: surface.appId,
      profilePath: profileOut,
      credential,
      credentialReference,
      pairingRequestId,
      pairingCode,
      requestedScopes: await jsonInput('--scopes-json', '[]'),
    });
    print({
      paired: true,
      grantId: profile.grantId,
      profile: profile.path,
      nextCommand: `snapback-app --server ${server} --principal agent --agent-profile ${profile.path} introspect`,
    });
  } else {
    throw Object.assign(new Error(`unknown command '${command}'`), { code: 'SNAPBACK_APP_CLI_COMMAND_UNKNOWN' });
  }
} catch (error) {
  const diagnostic = error.diagnostic ?? { code: error.code ?? 'SNAPBACK_APP_CLI_FAILED', message: error.message };
  if (error.signalExit !== true) process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = Number.isSafeInteger(error.exitCode)
    ? error.exitCode
    : classifyDiagnosticExit(diagnosticRecord({
      code: diagnostic.code,
      locus: typeof error.status === 'number' ? 'request' : 'engine',
      ...(typeof error.status === 'number' ? { httpStatus: error.status } : {}),
    }));
}
