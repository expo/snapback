import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const packagesRoot = join(repoRoot, 'packages');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error?.message}`,
  );
  return result;
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function packageInventory() {
  const inventory = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const root = join(packagesRoot, entry.name);
    const manifestPath = join(root, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    inventory.set(manifest.name, { manifest, root: realpathSync(root) });
  }
  return inventory;
}

function packedDependencyClosure(rootNames) {
  const inventory = packageInventory();
  const closure = new Map();
  const pending = [...rootNames];
  while (pending.length > 0) {
    const name = pending.shift();
    if (closure.has(name)) continue;
    const source = inventory.get(name);
    assert.ok(source, `local packed closure is missing ${name}`);
    closure.set(name, source);
    for (const dependency of Object.keys(source.manifest.dependencies ?? {})) {
      if (dependency.startsWith('@expo/snapback-')) pending.push(dependency);
    }
  }
  return closure;
}

function localSpecifier(from, path) {
  let value = relative(from, path).split(sep).join('/');
  if (!value.startsWith('.')) value = `./${value}`;
  return `file:${value}`;
}

function materializePackedViteApp(appRoot) {
  const packageManager = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).packageManager;
  const expectedBun = /^bun@(.+)$/u.exec(packageManager)?.[1];
  assert.ok(expectedBun, 'repository packageManager must pin Bun');
  assert.equal(run('bun', ['--version']).stdout.trim(), expectedBun);

  const artifactRoot = join(appRoot, '.snapback', 'packed-packages');
  mkdirSync(artifactRoot, { recursive: true });
  const closure = packedDependencyClosure([
    '@expo/snapback-vite',
    '@expo/snapback-client',
  ]);
  const specifiers = {};
  for (const [name, source] of [...closure].sort(([left], [right]) => left.localeCompare(right))) {
    if (name === '@expo/snapback-codegen') {
      // The publication pipeline prepares these Rust-derived package bytes
      // before copying the explicit files closure into its staging directory.
      run(process.execPath, ['prepare-runtime-artifacts.mjs'], { cwd: source.root });
    }
    const filename = `${name.slice('@expo/snapback-'.length)}.tgz`;
    const artifact = join(artifactRoot, filename);
    run('bun', [
      'pm',
      'pack',
      '--ignore-scripts',
      '--filename', artifact,
      '--quiet',
    ], { cwd: source.root });
    assert.ok(existsSync(artifact), `${name} produced a package tarball`);
    specifiers[name] = localSpecifier(appRoot, artifact);
  }

  writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-vite-packed-password-browser',
    version: '1.0.0',
    private: true,
    type: 'module',
    packageManager,
    dependencies: {
      '@expo/snapback-client': specifiers['@expo/snapback-client'],
      '@expo/snapback-vite': specifiers['@expo/snapback-vite'],
      vite: '^8.0.0',
    },
    overrides: specifiers,
  }, null, 2)}\n`);
  run('bun', ['install'], { cwd: appRoot, timeout: 600_000 });

  for (const name of closure.keys()) {
    const installed = join(appRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installed)) continue; // Platform-inapplicable optional packages stay absent.
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} is materialized`);
    assert.ok(
      !realpathSync(installed).startsWith(packagesRoot),
      `${name} must not resolve into the source workspace`,
    );
  }
  const installedVite = join(appRoot, 'node_modules', '@expo', 'snapback-vite');
  const installedRouteAuthority = JSON.parse(readFileSync(
    join(installedVite, 'first-party-auth-relay-routes.generated.json'),
    'utf8',
  ));
  assert.equal(
    installedRouteAuthority.formatVersion,
    'snapback.vite-first-party-auth-relay-routes.v2',
  );
  assert.equal(installedRouteAuthority.source, 'snapback.server.route-registry.v1');
  assert.deepEqual(
    installedRouteAuthority.routes.map(({ method, path, retrySafe }) => ({ method, path, retrySafe })),
    [
      { method: 'POST', path: '/auth/password/change', retrySafe: false },
      { method: 'POST', path: '/auth/password/reset', retrySafe: false },
      { method: 'POST', path: '/auth/password/signin', retrySafe: false },
      { method: 'POST', path: '/auth/password/signup', retrySafe: false },
      { method: 'POST', path: '/auth/recovery/consume', retrySafe: false },
      { method: 'POST', path: '/auth/recovery/rotate', retrySafe: false },
    ],
    'the packed relay carries the six authority-derived non-replayable auth rows',
  );
  return installedVite;
}

function generatePackedBrowserBackend(appRoot) {
  const backendRoot = join(appRoot, 'snapback');
  mkdirSync(backendRoot, { recursive: true });
  writeFileSync(join(backendRoot, 'schema.mjs'), `
import { defineAuth, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({
  packedTodos: defineTable({
    title: v.string(),
    authority: v.string(),
    createdAt: v.integer(),
  }).visibility({ kind: 'public-read' }).index('by_created_at', ['createdAt']).sync(),
}, { auth: { mode: 'sessions' }, authProgram });
`);
  writeFileSync(join(backendRoot, 'functions.mjs'), `
import { desc, defineLiveQuery } from '@expo/snapback-codegen/define';

export const listPackedTodos = defineLiveQuery({
  auth: 'public',
  table: 'packedTodos',
  args: {},
  order: [desc('createdAt')],
  index: 'by_created_at',
});
`);
  const codegen = join(
    appRoot,
    'node_modules',
    '@expo',
    'snapback-codegen',
    'index.mjs',
  );
  run(process.execPath, [codegen, backendRoot], { cwd: appRoot });
  return JSON.parse(readFileSync(join(backendRoot, 'generated', 'app.descriptor.json'), 'utf8'));
}

function writeBrowserApp(appRoot) {
  writeFileSync(join(appRoot, 'index.html'), [
    '<!doctype html>',
    '<html><body><main id="proof">starting</main><script type="module" src="/main.js"></script></body></html>',
    '',
  ].join('\n'));
  writeFileSync(join(appRoot, 'main.js'), `
import { createSnapbackDevAppBinding } from 'virtual:snapback/dev';
import { createSnapbackAppClient } from '@expo/snapback-client';
import { app, listPackedTodos } from './snapback/generated/api.mjs';

const proof = document.querySelector('#proof');
const password = 'PackedRelayPassword!2026';
const recoveryCode = 'sbrv1_00' + 'R'.repeat(25);
const observedResponseHeaders = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const requestUrl = typeof input === 'string' ? input : input.url;
  const path = new URL(requestUrl, location.href).pathname;
  if (path.startsWith('/__snapback/auth/')) {
    observedResponseHeaders.push({
      path,
      cacheControl: response.headers.get('cache-control'),
      fixture: response.headers.get('x-snapback-fixture'),
    });
  }
  return response;
};

async function waitFor(check, label) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(label + ' did not settle');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

try {
  const binding = createSnapbackDevAppBinding(app);
  if (binding.target.origin !== '/__snapback') throw new Error('generated binding did not select the relay origin');
  if (!binding.capabilities.offered.includes('auth.passwords')) throw new Error('generated binding omitted auth.passwords');
  const appClient = await createSnapbackAppClient({
    app,
    binding,
    platform: Object.freeze({ kind: 'browser' }),
    storagePartition: 'packed-vite-password-lifecycle',
  });
  if (appClient.bootstrapState().status !== 'ready') throw new Error('application auth bootstrap did not reach ready');
  if (appClient.auth.currentPrincipal().status !== 'anonymous') throw new Error('application auth did not start anonymous');

  const liveUpdates = [];
  let live = null;
  let liveRows = [];
  let liveGeneration = 0;
  let resumeError = null;
  let resumeTask = Promise.resolve();
  const startLive = async (authorityCapture = null) => {
    const generation = ++liveGeneration;
    const next = await appClient.client.liveQuery(listPackedTodos, {
      connectionId: 'packed-password-lifecycle',
      pollCadenceMs: 60_000,
      ...(authorityCapture === null ? {} : { authorityCapture }),
      onUpdate(rows, detail) {
        if (generation !== liveGeneration) return;
        liveRows = rows;
        liveUpdates.push({ authority: rows[0]?.authority ?? 'blank', kind: detail?.kind ?? null });
      },
    });
    if (generation !== liveGeneration) {
      next.dispose();
      await next.settled();
      return;
    }
    live = next;
    liveRows = next.rows;
  };
  await startLive();
  const unregisterLiveBarrier = appClient.client.registerAuthBarrierParticipant({
    name: 'packed-generated-live-surface',
    async quiesce() {
      liveGeneration += 1;
      liveRows = [];
      const predecessor = live;
      live = null;
      predecessor?.dispose();
      await predecessor?.settled();
    },
    blank() {
      liveRows = [];
      liveUpdates.push({ authority: 'blank', kind: 'authorization_delete' });
    },
    clearMemory() {},
    async commitDurable() {},
    resume(context = {}) {
      const launch = () => {
        resumeTask = startLive(context.capture ?? null).catch((error) => {
          resumeError = error;
        });
      };
      if (typeof context.stagePublication === 'function' && context.capture !== undefined) {
        context.stagePublication(context.capture, launch);
      } else {
        launch();
      }
    },
  });
  const liveAuthorities = [];
  const subscriptionIds = [];
  const captureLiveAuthority = async (authority) => {
    await waitFor(
      () => {
        if (resumeError !== null) throw resumeError;
        return liveRows[0]?.authority === authority;
      },
      'live authority ' + authority + '; rows=' + JSON.stringify(liveRows)
        + '; subscription=' + (live?.subscriptionId ?? 'none'),
    );
    if (subscriptionIds.at(-1) === live?.subscriptionId) {
      throw new Error('auth transition did not fresh-subscribe the already-armed live surface');
    }
    liveAuthorities.push(authority);
    subscriptionIds.push(live.subscriptionId);
  };

  await captureLiveAuthority('anonymous');
  const signup = await appClient.auth.signUpWithPassword({
    email: 'packed@example.test',
    password,
  });
  if (Object.hasOwn(signup, 'token')) throw new Error('signup leaked credential custody');
  if (signup.recoveryCodes?.length !== 8) throw new Error('signup recovery projection was not validated');
  if (appClient.auth.currentPrincipal().status !== 'authenticated') throw new Error('signup principal did not settle');
  await captureLiveAuthority('signup');

  await appClient.auth.signOut();
  if (appClient.auth.currentPrincipal().status !== 'anonymous') throw new Error('logout principal did not settle');
  await captureLiveAuthority('anonymous');

  const signin = await appClient.auth.signInWithPassword({
    email: 'packed@example.test',
    password,
  });
  if (Object.hasOwn(signin, 'token')) throw new Error('signin leaked credential custody');
  if (appClient.auth.currentPrincipal().status !== 'authenticated') throw new Error('signin principal did not settle');
  await captureLiveAuthority('signin');

  await appClient.auth.signOut();
  if (appClient.auth.currentPrincipal().status !== 'anonymous') throw new Error('second logout principal did not settle');
  await captureLiveAuthority('anonymous');

  const recovery = await appClient.auth.consumeRecoveryCode({
    email: 'packed@example.test',
    code: recoveryCode,
  });
  if (Object.hasOwn(recovery, 'token')) throw new Error('recovery leaked credential custody');
  if (recovery.recoveryCodes?.length !== 8) throw new Error('recovery credential response was not validated');
  if (appClient.auth.currentPrincipal().status !== 'authenticated') throw new Error('recovery principal did not settle');
  await captureLiveAuthority('recovery');

  if (new Set(subscriptionIds).size !== subscriptionIds.length) {
    throw new Error('auth transitions reused a live subscription instead of crossing the barrier');
  }
  if (observedResponseHeaders.length < 6 || observedResponseHeaders.some((entry) => (
    entry.cacheControl !== 'no-store' || entry.fixture !== 'packed-backend'
  ))) throw new Error('application client auth traffic lost backend response policy through the relay');

  let ambiguousCommitError = null;
  try {
    await appClient.auth.rotateRecoveryCodes();
  } catch (error) {
    ambiguousCommitError = {
      code: error?.code ?? null,
      diagnosticCode: error?.diagnostic?.code ?? null,
    };
  }
  if (ambiguousCommitError?.code !== 'SNAPBACK_DEV_PROXY_UNREACHABLE') {
    throw new Error('commit-then-reset did not surface the classified relay error: '
      + JSON.stringify(ambiguousCommitError));
  }
  if (ambiguousCommitError.diagnosticCode !== ambiguousCommitError.code) {
    throw new Error('commit-then-reset error lost its structured diagnostic');
  }

  await resumeTask;
  await unregisterLiveBarrier();
  live?.dispose();
  await live?.settled();
  await appClient.dispose();
  proof.dataset.status = 'passed';
  proof.textContent = JSON.stringify({
    bindingOrigin: binding.target.origin,
    bindingDescriptor: binding.descriptorIdentity,
    liveAuthorities,
    liveUpdates,
    subscriptionIds,
    authResponseCount: observedResponseHeaders.length,
    ambiguousCommitError,
  });
} catch (error) {
  proof.dataset.status = 'failed';
  proof.textContent = error?.stack ?? String(error);
}
`);
}

function chromeLaunch() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(executable, 'packed Vite browser proof requires a Chrome-family browser');
  return { chromeBin: executable, launchPrefixArgs: [] };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const exceptions = [];
  let nextId = 1;
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params?.exceptionDetails?.exception?.description
        ?? message.params?.exceptionDetails?.text
        ?? 'unknown browser exception');
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result ?? {});
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectResult(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    });
  };
  return { socket, send, exceptions };
}

async function browserProof(browser, origin) {
  const cdp = await connectCdp(browser.ws);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: origin }, sessionId);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const proof = document.querySelector('#proof');
          return proof?.dataset.status ? { status: proof.dataset.status, text: proof.textContent } : null;
        })()`,
        returnByValue: true,
      }, sessionId);
      const value = result.result?.value;
      if (value?.status === 'failed') {
        assert.fail(`packed Vite browser lifecycle failed: ${value.text}; exceptions=${JSON.stringify(cdp.exceptions)}`);
      }
      if (value?.status === 'passed') return JSON.parse(value.text);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.fail(`packed Vite browser lifecycle timed out; exceptions=${JSON.stringify(cdp.exceptions)}`);
  } finally {
    cdp.socket.close();
  }
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-vite-packed-password-')));
const externalApp = join(root, 'app');
mkdirSync(externalApp);
let backend;
let viteServer;
let browser;
try {
  const installedVite = materializePackedViteApp(externalApp);
  const generatedApp = generatePackedBrowserBackend(externalApp);
  writeBrowserApp(externalApp);

  const appId = generatedApp.identity.app;
  const generatedLiveReference = generatedApp.api.queries.listPackedTodos;
  const incarnation = '018f0d90-7c31-7a22-8c33-445566778899';
  const userId = '018f0d90-7c32-7a22-8c33-445566778899';
  const recoveryCodes = Object.freeze(Array.from({ length: 8 }, (_, index) => (
    `sbrv1_${String(index).padStart(2, '0')}${'R'.repeat(25)}`
  )));
  const tokenRecords = new Map([
    ['signup-session', {
      label: 'signup',
      sessionId: '018f0d90-7c33-7a22-8c33-445566778899',
      authorityInstanceId: '018f0d90-7c34-7a22-8c33-445566778899',
      generation: 1,
    }],
    ['signin-session', {
      label: 'signin',
      sessionId: '018f0d90-7c35-7a22-8c33-445566778899',
      authorityInstanceId: '018f0d90-7c36-7a22-8c33-445566778899',
      generation: 2,
    }],
    ['recovery-session', {
      label: 'recovery',
      sessionId: '018f0d90-7c37-7a22-8c33-445566778899',
      authorityInstanceId: '018f0d90-7c38-7a22-8c33-445566778899',
      generation: 3,
    }],
  ]);
  const responseHeaders = {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-snapback-fixture': 'packed-backend',
  };
  const availability = Object.freeze({
    onlineRequestResponse: Object.freeze({ available: true, reason: null }),
    authScopedLive: Object.freeze({
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    }),
    retainedReads: Object.freeze({
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    }),
    queuedReplay: Object.freeze({
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    }),
  });
  const bearerFrom = (request) => (
    request.headers.authorization?.replace(/^Bearer /u, '') ?? null
  );
  const handshakeFor = (bearer) => {
    const record = bearer === null ? null : tokenRecords.get(bearer);
    assert.ok(bearer === null || record, `unknown fixture bearer ${bearer}`);
    return {
      protocolVersion: 1,
      serverStartupNonce: 'packed-password-relay',
      authorizationStreamIncarnation: incarnation,
      transitionGeneration: record?.generation ?? 0,
      activeMode: 'sessions',
      desiredMode: 'sessions',
      modeState: 'settled',
      appDataAvailability: 'available',
      quarantineCode: null,
      clientProtocols: {
        authClient: 1,
        authInvalidation: 1,
        authorityDescriptor: 1,
        authorizedLease: null,
      },
      availability,
      provider: { key: 'local-password', available: true },
      transports: ['bearer'],
      authority: record === null
        ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
        : {
            kind: 'humanSession',
            userId,
            sessionId: record.sessionId,
            isAuthenticated: true,
          },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: record?.authorityInstanceId ?? incarnation,
        sessionGeneration: record?.generation ?? 0,
      },
      deploymentIdentity: {
        schemaVersion: generatedLiveReference.expectedGeneration.schemaVersion,
        authMode: 'sessions',
        appId,
        schemaHash: generatedLiveReference.expectedGeneration.schemaHash,
        bundleHash: generatedLiveReference.expectedGeneration.bundleHash,
        inputsHash: generatedLiveReference.expectedGeneration.inputsHash,
      },
      authorizedLease: null,
    };
  };
  const credentialFor = (token, { withRecoveryCodes = false } = {}) => {
    const record = tokenRecords.get(token);
    assert.ok(record, `missing fixture credential ${token}`);
    const now = Date.now();
    return {
      tokenType: 'Bearer',
      token,
      refreshAfter: now + 60_000,
      session: {
        id: record.sessionId,
        userId,
        provider: 'local-password',
        createdAt: now,
        expiresAt: now + 120_000,
        absoluteExpiresAt: now + 240_000,
      },
      authorityDescriptor: {
        descriptorVersion: 1,
        authorityInstanceId: record.authorityInstanceId,
        sessionGeneration: record.generation,
      },
      ...(withRecoveryCodes ? { recoveryCodes: [...recoveryCodes] } : {}),
    };
  };
  const sendJson = (response, value, status = 200) => {
    response.writeHead(status, responseHeaders);
    response.end(JSON.stringify(value));
  };
  const observed = [];
  const connectionBearers = new Map();
  const subscriptions = new Set();
  const subscribeAuthorities = [];
  let nextConnection = 0;
  let nextSubscription = 0;
  let recoveryRotationCommits = 0;
  const startupNonce = 'packed-password-relay';
  backend = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, binary: { startupNonce } }));
      return;
    }
    const body = await requestBody(request);
    observed.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization ?? null,
      body,
    });
    const parsedBody = body === '' ? {} : JSON.parse(body);
    const bearer = bearerFrom(request);
    if (request.url === '/auth/session') {
      sendJson(response, handshakeFor(bearer));
      return;
    }
    if (request.url === '/auth/password/signup') {
      sendJson(response, credentialFor('signup-session', { withRecoveryCodes: true }));
      return;
    }
    if (request.url === '/auth/password/signin') {
      sendJson(response, credentialFor('signin-session'));
      return;
    }
    if (request.url === '/auth/recovery/consume') {
      sendJson(response, credentialFor('recovery-session', { withRecoveryCodes: true }));
      return;
    }
    if (request.url === '/auth/recovery/rotate') {
      // Model the ambiguous transport boundary: the one-time operation commits,
      // then its response connection resets before the caller can observe it.
      recoveryRotationCommits += 1;
      request.socket.destroy();
      return;
    }
    if (request.url === '/auth/logout') {
      assert.ok(tokenRecords.has(bearer), 'logout must carry client-owned credential custody');
      response.writeHead(204, responseHeaders);
      response.end();
      return;
    }
    if (request.url === '/connection/open') {
      nextConnection += 1;
      const connectionId = `packed-connection-${nextConnection}`;
      const connectionToken = `sct-packed-${nextConnection}`;
      connectionBearers.set(connectionToken, bearer);
      sendJson(response, {
        connectionId,
        connectionToken,
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: null,
      });
      return;
    }
    if (request.url === '/live/listPackedTodos/subscribe') {
      const connectionToken = request.headers['x-snapback-connection-token'];
      assert.equal(typeof connectionToken, 'string');
      const connectionBearer = connectionBearers.get(connectionToken) ?? null;
      const authority = tokenRecords.get(connectionBearer)?.label ?? 'anonymous';
      subscribeAuthorities.push(authority);
      nextSubscription += 1;
      const subscriptionId = `packed-subscription-${nextSubscription}`;
      subscriptions.add(subscriptionId);
      const supersession = parsedBody.supersedes
        ? subscriptions.delete(parsedBody.supersedes)
          ? { superseded: parsedBody.supersedes }
          : { supersessionRefusal: 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN' }
        : {};
      sendJson(response, {
        subscription_id: subscriptionId,
        snapshot: {
          version: nextSubscription,
          rows: [{
            _id: 'packed_todo_1',
            _version: nextSubscription,
            _createdAt: 1,
            _updatedAt: nextSubscription,
            title: 'Packed lifecycle',
            authority,
            createdAt: 1,
          }],
        },
        permission_epochs: {},
        ...supersession,
      });
      return;
    }
    if (request.url === '/live/listPackedTodos/unsubscribe') {
      subscriptions.delete(parsedBody.subscription_id);
      sendJson(response, {
        subscription_id: parsedBody.subscription_id,
        disposed: true,
      });
      return;
    }
    sendJson(response, {
      diagnostic: {
        code: 'SNAPBACK_TEST_UNEXPECTED_ROUTE',
        message: `unexpected packed lifecycle route ${request.url}`,
      },
    }, 500);
  });
  const backendUrl = await listen(backend);
  const database = join(externalApp, '.snapback', 'packed-relay.sqlite3');
  const readyFile = join(externalApp, '.snapback', 'packed-relay.ready.json');
  const applicationReadyFile = `${readyFile}.application-ready`;
  writeFileSync(database, '');
  const readyBytes = `${JSON.stringify({
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    ready: true,
    pid: process.pid,
    serverUrl: backendUrl,
    database: { path: database },
    startupNonce,
  })}\n`;
  writeFileSync(readyFile, readyBytes, { mode: 0o600 });
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  // @ref LLP 0224#dated-amendment-d01-lifecycle-identity-extension-2026-08-21 — even this fake transport backend is admitted to the packed Vite consumer through the authoritative application receipt, never through a host descriptor masquerading as application readiness.
  writeFileSync(applicationReadyFile, `${JSON.stringify({
    formatVersion: 'snapback.application-ready.v1',
    startupNonce,
    hostReadyDescriptorDigest: `sha256:${createHash('sha256').update(readyBytes).digest('hex')}`,
    application: {
      mode: 'dev-generated',
      deployment: handshakeFor(null).deploymentIdentity,
      obligationsDigest: `sha256:${'0'.repeat(64)}`,
    },
    targetProfile: 'local-dev-sqlite-ibex',
    artifacts: {
      schemaHash: generatedLiveReference.expectedGeneration.schemaHash,
      bundleHash: generatedLiveReference.expectedGeneration.bundleHash,
      databaseVersion: 0,
    },
    auth: { activeMode: 'sessions', modeState: 'settled', sessionActivationReady: true },
    binding: {
      format: 'snapback.app-binding.v1',
      source: 'supervised-dev',
      descriptorIdentity: generatedApp.identity.descriptor,
      target: {
        app: generatedApp.identity.app,
        schema: generatedApp.identity.schema,
        functions: generatedApp.identity.functions,
        origin: backendUrl,
        routing: 'loopback',
      },
      capabilities: {
        offered: [...new Set([
          ...(generatedApp.capabilities?.required ?? []),
          'auth.passwords',
        ])].sort(),
      },
      provenance: {
        supervisorGeneration: 'packed-password-relay',
        issuedAt,
        expiresAt,
      },
      integrity: { channel: 'local-supervised-ipc' },
    },
    clientOrigins: [],
    runtimeIdentity: {
      qualifiedBinary: {
        path: process.execPath,
        source: 'packed-relay-fixture',
        platform: `${process.platform}-${process.arch}`,
        bytes: 0,
        sha256: `sha256:${'0'.repeat(64)}`,
        buildIdentity: {},
        qualification: {
          receiptSchemaVersion: 'snapback.runtime-readiness.v1',
          receiptPath: 'packed-relay-fixture',
          probe: 'restricted-no-eval-handler-vm',
        },
      },
      wrapper: { package: '@expo/snapback-cli', version: 'packed-fixture' },
    },
    capabilityManifestDigest: `sha256:${'0'.repeat(64)}`,
    networkProfile: 'loopback-only',
    settledAtMs: Date.now(),
  })}\n`, { mode: 0o600 });

  const { createServer: createViteServer } = await import(
    pathToFileURL(join(externalApp, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href
  );
  const { default: snapbackDev } = await import(pathToFileURL(join(installedVite, 'index.mjs')).href);
  const viteEvents = [];
  viteServer = await createViteServer({
    root: externalApp,
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: { mode: 'attach', db: database, readyFile },
      projectRoot: externalApp,
      logJson: false,
      onEvent: (event) => viteEvents.push(event),
    })],
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await viteServer.listen();
  assert.ok(
    viteEvents.some((event) => event.event === 'server-ready' && event.ready === true),
    'packed Vite attach reaches ready through snapback.application-ready.v1',
  );
  const address = viteServer.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const pageOrigin = `http://127.0.0.1:${address.port}`;

  browser = await launchChromeCdp({
    ...chromeLaunch(),
    headless: true,
    startupTimeoutMs: 60_000,
    extraArgs: ['--remote-allow-origins=*', '--disable-background-networking'],
  });
  let browserResult;
  try {
    browserResult = await browserProof(browser, pageOrigin);
  } catch (error) {
    throw new Error(
      `${error.message}; observed=${JSON.stringify(observed)}`,
      { cause: error },
    );
  }
  assert.equal(browserResult.bindingOrigin, '/__snapback');
  assert.equal(browserResult.bindingDescriptor, generatedApp.identity.descriptor);
  assert.deepEqual(
    browserResult.liveAuthorities,
    ['anonymous', 'signup', 'anonymous', 'signin', 'anonymous', 'recovery'],
  );
  assert.equal(browserResult.subscriptionIds.length, 6);
  assert.equal(new Set(browserResult.subscriptionIds).size, 6);
  assert.ok(browserResult.authResponseCount >= 6);
  assert.deepEqual(browserResult.ambiguousCommitError, {
    code: 'SNAPBACK_DEV_PROXY_UNREACHABLE',
    diagnosticCode: 'SNAPBACK_DEV_PROXY_UNREACHABLE',
  });
  assert.equal(
    recoveryRotationCommits,
    1,
    'a recovery rotation committed before ECONNRESET must never be replayed',
  );
  assert.deepEqual(
    subscribeAuthorities,
    ['anonymous', 'signup', 'anonymous', 'signin', 'anonymous', 'recovery'],
    'the one already-armed generated live reference must cross every application auth barrier',
  );
  assert.doesNotMatch(
    JSON.stringify(browserResult),
    /signup-session|signin-session|recovery-session/u,
    'browser-visible client projections must not leak credential custody',
  );

  const lifecycleRequests = observed.filter(({ path }) => (
    path === '/auth/password/signup'
      || path === '/auth/logout'
      || path === '/auth/password/signin'
      || path === '/auth/recovery/consume'
  ));
  assert.deepEqual(
    lifecycleRequests.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /auth/password/signup',
      'POST /auth/logout',
      'POST /auth/password/signin',
      'POST /auth/logout',
      'POST /auth/recovery/consume',
    ],
  );
  const firstSubscribe = observed.findIndex(({ path }) => (
    path === '/live/listPackedTodos/subscribe'
  ));
  const firstPasswordEntry = observed.findIndex(({ path }) => path === '/auth/password/signup');
  assert.ok(firstSubscribe >= 0 && firstSubscribe < firstPasswordEntry, 'live query must arm before auth starts');
  assert.deepEqual(JSON.parse(lifecycleRequests[0].body), {
    email: 'packed@example.test',
    password: 'PackedRelayPassword!2026',
  });
  assert.equal(lifecycleRequests[1].authorization, 'Bearer signup-session');
  assert.equal(lifecycleRequests[3].authorization, 'Bearer signin-session');
  console.log(
    'packed Vite browser: real app client validates/custodies password credentials and resubscribes one generated live surface through every auth barrier',
  );
} finally {
  await browser?.stop();
  await viteServer?.close();
  if (backend?.listening) await close(backend);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
