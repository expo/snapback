import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  API_ENVELOPE_ARTIFACT_KIND,
  API_ENVELOPE_FORMAT_V1,
  DECLARATION_MEMBER_KEY,
  envelopeDigest,
  jcsCanonical,
  memberDigest,
  operationMemberKey,
} from './envelope.mjs';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('./package.json', import.meta.url));
const scratch = await mkdtemp(join(packageRoot, '.cli-test-'));
await chmod(scratch, 0o700);
const generated = join(scratch, 'generated');
await mkdir(generated, { mode: 0o700 });
await mkdir(join(generated, 'operations'), { mode: 0o700 });
await writeFile(join(generated, 'artifacts.json'), JSON.stringify({
  artifactKind: 'artifactIndex',
  appId: 'cli-test',
  schemaVersion: 'snapback.v0',
  schemaHash: 'sha256:cli-test-schema',
  bundleHash: 'sha256:cli-test-bundle',
  inputsHash: 'cli-test-inputs',
}));
await writeFile(join(generated, 'functions.manifest.json'), JSON.stringify({
  artifactKind: 'functionManifest',
  appId: 'cli-test',
  bundleHash: 'sha256:cli-test-bundle',
  functions: [
    { id: 'cli-test:list', name: 'list', kind: 'Query', authRequirement: 'optional-user' },
    { id: 'cli-test:privateList', name: 'privateList', kind: 'Query', authRequirement: 'authenticated' },
    { id: 'cli-test:createTodo', name: 'createTodo', kind: 'Mutation', authRequirement: 'authenticated' },
  ],
}));
await writeFile(join(generated, 'api.d.ts'), [
  'export interface CliTestApi {',
  "  readonly list: 'cli-test:list';",
  "  readonly privateList: 'cli-test:privateList';",
  "  readonly createTodo: 'cli-test:createTodo';",
  '}',
  '',
].join('\n'));
await writeFile(join(generated, 'operations', 'list.args.schema.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    page: { type: 'integer' },
    from: { type: 'string' },
  },
  additionalProperties: false,
}));
await writeFile(join(generated, 'operations', 'privateList.args.schema.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
}));
await writeFile(join(generated, 'operations', 'createTodo.args.schema.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
}));

const servedInputsHash = `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`;
const servedBundleHash = `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`;
const servedOperations = {
  'cli-test:list': { name: 'list', argsSchema: { type: 'object', additionalProperties: false } },
  'cli-test:createTodo': { name: 'createTodo', argsSchema: { type: 'object', additionalProperties: false } },
};
const servedDeclaration = 'export declare const api: unknown;\n';
const servedMemberDigests = Object.fromEntries([
  ...Object.entries(servedOperations).map(([id, operation]) => [
    operationMemberKey(id), memberDigest(jcsCanonical(operation.argsSchema)),
  ]),
  [DECLARATION_MEMBER_KEY, memberDigest(servedDeclaration)],
]);
const servedEnvelopeDocument = {
  artifactKind: API_ENVELOPE_ARTIFACT_KIND,
  formatVersion: API_ENVELOPE_FORMAT_V1,
  appId: 'cli-test',
  tuple: { schemaVersion: 'snapback.v1', authMode: 'sessions' },
  inputsHash: servedInputsHash,
  bundleHash: servedBundleHash,
  functions: {
    artifactKind: 'functionManifest',
    appId: 'cli-test',
    inputsHash: servedInputsHash,
    bundleHash: servedBundleHash,
    functions: [
      { id: 'cli-test:list', name: 'list', kind: 'Query', authRequirement: 'optional-user' },
      { id: 'cli-test:createTodo', name: 'createTodo', kind: 'Mutation', authRequirement: 'authenticated' },
    ],
  },
  operations: servedOperations,
  declarations: { appBindings: servedDeclaration },
  memberDigests: servedMemberDigests,
};
const servedEnvelope = jcsCanonical(servedEnvelopeDocument);
const servedEnvelopeSha256 = envelopeDigest(servedEnvelope);
const requests = [];
let oauthFacadeEnabled = true;
let oauthRegistrations = 0;
let oauthCodeSequence = 0;
const oauthCodes = new Map();
const oauthBearer = 'sbagt_cli_oauth_token_must_never_be_echoed';
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] ?? '';
  const body = rawBody.length === 0 ? null
    : contentType.startsWith('application/json') ? JSON.parse(rawBody)
      : contentType.startsWith('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(rawBody))
        : rawBody;
  requests.push({
    method: request.method,
    path: request.url,
    body,
    authorization: request.headers.authorization ?? null,
    authClientProtocol: request.headers['x-snapback-auth-client-protocol'] ?? null,
  });
  const send = (value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.url === '/app-api/current') return send({
    artifactKind: 'appApiDiscovery',
    formatVersion: 'snapback.app-api-discovery.v1',
    appId: 'cli-test',
    tuple: {
      schemaVersion: 'snapback.v1',
      authMode: 'sessions',
      schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
      bundleHash: servedBundleHash,
      inputsHash: servedInputsHash,
    },
    envelope: { state: 'current', sha256: servedEnvelopeSha256 },
    appCliTarget: true,
    appCliDescriptor: {
      capabilityId: 'app-cli.target',
      principalClasses: ['anonymous', 'session'],
      servesEnvelopes: true,
      acceptsGenerationAssertions: true,
      perGrantTokenCap: null,
    },
    engineRange: null,
  });
  if (request.url === `/app-api/envelope/${servedEnvelopeSha256}`) {
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'identity',
      'cache-control': 'public, max-age=31536000, immutable, no-transform',
      etag: `"${servedEnvelopeSha256}"`,
    });
    response.end(servedEnvelope);
    return undefined;
  }
  if (request.url === '/inspect') return send({
    appId: 'cli-test',
    schema: {
      api: {
        enabled: true,
        disclosure: 'exposed-only',
        functions: { list: { expose: true }, createTodo: { expose: true } },
        oauth: {
          enabled: true,
          bearer: true,
          bundles: {
            'items.write': { functions: ['createTodo'] },
            reporting: { functions: ['list'] },
          },
        },
      },
    },
    functions: {
      functions: [
        { id: 'cli-test:list', name: 'list', kind: 'Query' },
        { id: 'cli-test:createTodo', name: 'createTodo', kind: 'Mutation' },
      ],
    },
    capabilityManifest: {
      appCliTarget: {
        capabilityId: 'app-cli.target',
        principalClasses: ['anonymous', 'dev', 'session', 'agent'],
        servesEnvelopes: true,
        acceptsGenerationAssertions: true,
        perGrantTokenCap: 10,
      },
    },
  });
  if (request.url === '/.well-known/oauth-authorization-server') {
    if (!oauthFacadeEnabled) return send({ diagnostic: { code: 'SNAPBACK_NOT_FOUND' } }, 404);
    const origin = `http://127.0.0.1:${server.address().port}`;
    return send({
      issuer: origin,
      authorization_endpoint: `${origin}/auth/oauth/authorize`,
      token_endpoint: `${origin}/auth/oauth/token`,
      registration_endpoint: `${origin}/auth/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['items.write', 'reporting'],
    });
  }
  if (request.url === '/auth/oauth/register') {
    oauthRegistrations += 1;
    return send({
      client_id: 'intg_cli_test',
      client_id_issued_at: Math.floor(Date.now() / 1_000),
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: 'none',
    });
  }
  if (request.url.startsWith('/auth/oauth/authorize?')) {
    const authorize = new URL(request.url, 'http://127.0.0.1');
    const code = `oauth-code-${oauthCodeSequence += 1}`;
    oauthCodes.set(code, {
      clientId: authorize.searchParams.get('client_id'),
      redirectUri: authorize.searchParams.get('redirect_uri'),
      challenge: authorize.searchParams.get('code_challenge'),
      scope: authorize.searchParams.get('scope'),
    });
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', authorize.searchParams.get('state'));
    response.writeHead(302, { location: callback.href }).end();
    return undefined;
  }
  if (request.url === '/auth/oauth/token') {
    const authorization = oauthCodes.get(body.code);
    const computedChallenge = createHash('sha256').update(body.code_verifier, 'utf8').digest('base64url');
    if (authorization === undefined
      || authorization.clientId !== body.client_id
      || authorization.redirectUri !== body.redirect_uri
      || authorization.challenge !== computedChallenge) {
      return send({ error: 'invalid_grant' }, 400);
    }
    oauthCodes.delete(body.code);
    return send({
      access_token: oauthBearer,
      token_type: 'Bearer',
      expires_in: 900,
      scope: authorization.scope,
    });
  }
  if (request.url === '/query/list') return send({ rows: [{ echoed: body.args }], version: 1 });
  if (request.url === '/query/privateList') return send({ rows: [{ private: true }], version: 1 });
  return send({ diagnostic: { code: 'SNAPBACK_TEST_UNEXPECTED' } }, 404);
});

const start = (args, { env = {} } = {}) => {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: 'sbadm_cli_test_must_not_transmit', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
  return { child, closed };
};

const run = async (args, { stdin = '' } = {}) => {
  const invocation = start(args);
  invocation.child.stdin.end(stdin);
  return invocation.closed;
};

const authorizeUrlFrom = (invocation) => new Promise((resolvePromise, reject) => {
  let buffered = '';
  const timer = setTimeout(() => reject(new Error('timed out waiting for OAuth authorize URL')), 5_000);
  const onData = (chunk) => {
    buffered += chunk.toString('utf8');
    const line = buffered.split('\n').find((candidate) => candidate.startsWith('Authorize ('));
    if (line === undefined) return;
    clearTimeout(timer);
    invocation.child.stdout.off('data', onData);
    resolvePromise(line.slice(line.indexOf('): ') + 3));
  };
  invocation.child.stdout.on('data', onData);
  invocation.child.once('close', (code) => {
    clearTimeout(timer);
    reject(new Error(`login exited ${code} before printing an authorize URL`));
  });
});

const finalJsonLine = (stdout) => JSON.parse(stdout.trim().split('\n').at(-1));

try {
  const packageVersion = JSON.parse(await readFile(packageJsonPath, 'utf8')).version;
  const version = await run(['--version']);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), `snapback-app ${packageVersion}`);

  const subscribeHelp = await run(['subscribe', '--help']);
  assert.equal(subscribeHelp.code, 0, subscribeHelp.stderr);
  for (const flag of ['--watch', '--first-change', '--timeout-ms', '--args-json']) {
    assert.match(subscribeHelp.stdout, new RegExp(flag), `subscribe help omits ${flag}`);
  }
  const pairHelp = await run(['pair', '--help']);
  assert.equal(pairHelp.code, 0, pairHelp.stderr);
  for (const flag of ['--server', '--request', '--pairing-code-file', '--profile-out', '--credential-file', '--credential-env', '--scopes-json']) {
    assert.match(pairHelp.stdout, new RegExp(flag), `pair help omits ${flag}`);
  }
  const loginHelp = await run(['login', '--help']);
  assert.equal(loginHelp.code, 0, loginHelp.stderr);
  for (const flag of ['--server', '--scopes', '--no-browser', '--profile-dir']) {
    assert.match(loginHelp.stdout, new RegExp(flag), `login help omits ${flag}`);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = ['--server', origin, '--artifacts', generated, '--json'];

  const introspect = await run([...base, 'introspect']);
  assert.equal(introspect.code, 0, introspect.stderr);
  const introspection = JSON.parse(introspect.stdout);
  assert.equal(introspection.artifactKind, 'agentDigest');
  assert.equal(introspection.formatVersion, 'snapback.agent-digest.v1');
  assert.equal(introspection.principalClass, 'anonymous');
  assert.equal(introspection.sections.dynamic.reason, 'coarse-resolution-v0-no-observation-retention');
  assert.match(introspection.digestCursor, /^sbad1\./);
  const localOperationKeys = introspection.sections.static.items
    .map(({ key }) => key)
    .filter((key) => key.startsWith('operation/'));
  assert.deepEqual(localOperationKeys, [
    'operation/cli-test:createTodo',
    'operation/cli-test:list',
    'operation/cli-test:privateList',
  ], 'the explicit trusted-local artifact path keeps the complete function manifest');

  const servedIntrospect = await run(['--server', origin, 'introspect', '--json']);
  assert.equal(servedIntrospect.code, 0, servedIntrospect.stderr);
  const servedDigest = JSON.parse(servedIntrospect.stdout);
  const servedOperationKeys = servedDigest.sections.static.items
    .map(({ key }) => key)
    .filter((key) => key.startsWith('operation/'));
  assert.deepEqual(servedOperationKeys, [
    'operation/cli-test:createTodo',
    'operation/cli-test:list',
  ], 'served mode lists only the functions carried by the exposure-filtered envelope');

  const direct = await run([origin, '--json']);
  assert.equal(direct.code, 0, direct.stderr);
  assert.deepEqual(JSON.parse(direct.stdout), {
    artifactKind: 'appCliSurface',
    formatVersion: 'snapback.app-cli-surface.v1',
    appId: 'cli-test',
    envelopeDigest: servedEnvelopeSha256,
    functionCount: 2,
    source: 'served',
    availableVerbs: ['introspect', 'whoami', 'login', 'call', 'subscribe', 'types', 'run', 'pair'],
    login: `snapback-app --server ${origin} login`,
  });

  const oauthProfile = join(scratch, 'oauth-profile');
  const firstLogin = start([
    '--server', origin,
    'login',
    '--profile-dir', oauthProfile,
    '--json',
  ]);
  const firstAuthorizeUrl = await authorizeUrlFrom(firstLogin);
  assert.equal(new URL(firstAuthorizeUrl).searchParams.get('scope'), 'reporting', 'the all-query bundle wins when no bundle is explicitly named read');
  const browserCompletion = await fetch(firstAuthorizeUrl);
  assert.equal(browserCompletion.status, 200);
  const firstLoginResult = await firstLogin.closed;
  assert.equal(firstLoginResult.code, 0, firstLoginResult.stderr);
  const firstReceipt = finalJsonLine(firstLoginResult.stdout);
  assert.equal(firstReceipt.clientRegistration, 'created');
  assert.equal(firstReceipt.completionMode, 'loopback');
  assert.deepEqual(firstReceipt.scopes, ['reporting']);
  assert.equal(firstReceipt.refreshSupported, false);
  assert.equal(oauthRegistrations, 1);
  const publicClientPath = join(oauthProfile, 'oauth-public-client.json');
  const bearerPath = join(oauthProfile, 'oauth-bearer-token.json');
  assert.equal((await stat(publicClientPath)).mode & 0o777, 0o600);
  assert.equal((await stat(bearerPath)).mode & 0o777, 0o600);
  const bearerRecord = JSON.parse(await readFile(bearerPath, 'utf8'));
  assert.equal(bearerRecord.credentialType, 'bearer');
  assert.equal(bearerRecord.accessToken, oauthBearer);
  assert.equal(bearerRecord.expiresAtMs - bearerRecord.issuedAtMs, 900_000);
  assert.equal(bearerRecord.refreshSupported, false);
  assert.equal(`${firstLoginResult.stdout}${firstLoginResult.stderr}`.includes(oauthBearer), false, 'login output never echoes its bearer');

  const reusedLogin = start([
    '--server', origin,
    'login',
    '--profile-dir', oauthProfile,
    '--json',
  ]);
  const reusedAuthorizeUrl = await authorizeUrlFrom(reusedLogin);
  assert.equal((await fetch(reusedAuthorizeUrl)).status, 200);
  const reusedLoginResult = await reusedLogin.closed;
  assert.equal(reusedLoginResult.code, 0, reusedLoginResult.stderr);
  assert.equal(finalJsonLine(reusedLoginResult.stdout).clientRegistration, 'reused');
  assert.equal(oauthRegistrations, 1, 'later logins reuse the cached DCR client id');

  const pastedLogin = start([
    '--server', origin,
    'login',
    '--profile-dir', oauthProfile,
    '--no-browser',
    '--scopes', 'items.write,reporting',
    '--json',
  ]);
  const pastedAuthorizeUrl = await authorizeUrlFrom(pastedLogin);
  assert.equal(new URL(pastedAuthorizeUrl).searchParams.get('scope'), 'items.write reporting');
  const redirect = await fetch(pastedAuthorizeUrl, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const pastedCallback = new URL(redirect.headers.get('location'));
  pastedLogin.child.stdin.end(`${pastedCallback.href}\n`);
  const pastedLoginResult = await pastedLogin.closed;
  assert.equal(pastedLoginResult.code, 0, pastedLoginResult.stderr);
  const pastedReceipt = finalJsonLine(pastedLoginResult.stdout);
  assert.equal(pastedReceipt.completionMode, 'paste');
  assert.deepEqual(pastedReceipt.scopes, ['items.write', 'reporting']);
  assert.equal(`${pastedLoginResult.stdout}${pastedLoginResult.stderr}`.includes(oauthBearer), false);
  assert.equal(oauthRegistrations, 1);
  assert.equal(
    requests
      .filter(({ path }) => ['/auth/oauth/register', '/auth/oauth/token'].includes(path))
      .every(({ authClientProtocol }) => authClientProtocol === '1'),
    true,
    'facade lifecycle requests offer the sessions auth-client protocol expected by the local server',
  );

  oauthFacadeEnabled = false;
  const unavailableLogin = await run([
    '--server', origin,
    'login',
    '--profile-dir', oauthProfile,
    '--no-browser',
  ]);
  assert.equal(unavailableLogin.code, 3);
  const unavailableDiagnostic = JSON.parse(unavailableLogin.stderr);
  assert.match(unavailableDiagnostic.message, /api\.oauth\.bearer/u);
  assert.match(unavailableDiagnostic.message, /pair path/u);
  oauthFacadeEnabled = true;

  const called = await run([...base, '--args-json', '{"page":2}', 'call', 'list']);
  assert.equal(called.code, 0, called.stderr);
  assert.deepEqual(JSON.parse(called.stdout).core.value, [{ echoed: { page: 2 } }]);

  const requestsBeforeArgsRefusal = requests.filter(({ path }) => path === '/query/list').length;
  const invalidArgs = await run([...base, '--args-json', '{"page":"two"}', 'call', 'list']);
  assert.equal(invalidArgs.code, 2);
  assert.equal(JSON.parse(invalidArgs.stderr).code, 'SNAPBACK_APP_CLI_USAGE');
  assert.equal(
    requests.filter(({ path }) => path === '/query/list').length,
    requestsBeforeArgsRefusal,
    'schema-invalid arguments refuse before dispatch',
  );

  const beforePreflight = requests.filter(({ path }) => path === '/query/privateList').length;
  const refused = await run([...base, 'call', 'privateList']);
  assert.equal(refused.code, 2);
  assert.equal(JSON.parse(refused.stderr).code, 'SNAPBACK_APP_CLI_USAGE');
  assert.equal(
    requests.filter(({ path }) => path === '/query/privateList').length,
    beforePreflight,
    'anonymous authenticated-function preflight dispatches nothing',
  );

  const dev = await run([
    ...base,
    '--principal', 'dev',
    '--dev-user', 'dev-user',
    'call', 'privateList',
  ]);
  assert.equal(dev.code, 0, dev.stderr);
  const devRequest = requests.findLast(({ path }) => path === '/query/privateList');
  assert.equal(devRequest.authorization, null);
  assert.equal(JSON.stringify(devRequest.body).includes('dev-user'), true);

  const scriptPath = join(scratch, 'analysis.ts');
  await writeFile(scriptPath, `
    const rows = await api.list({ from: args[0] });
    export default { rows, processType: typeof process, fetchType: typeof fetch };
  `);
  const codeMode = await run([...base, 'run', scriptPath, '--', 'code-mode']);
  assert.equal(codeMode.code, 0, codeMode.stderr);
  assert.deepEqual(JSON.parse(codeMode.stdout), {
    rows: [{ echoed: { from: 'code-mode' } }],
    processType: 'undefined',
    fetchType: 'undefined',
  });
  assert.equal(codeMode.stderr.includes('sbadm_cli_test_must_not_transmit'), false);

  const requestsBeforeEmptyStdin = requests.length;
  const emptyStdin = await run([...base, 'run', '-']);
  assert.equal(emptyStdin.code, 2);
  assert.equal(emptyStdin.stdout, '');
  assert.deepEqual(JSON.parse(emptyStdin.stderr), {
    code: 'SNAPBACK_APP_CLI_SCRIPT_EMPTY',
    message: 'run - reached stdin EOF without non-whitespace script source',
    details: {
      source: 'stdin',
      repair: {
        kind: 'provideScriptSource',
        alternatives: [
          'pass a script file path',
          'pipe non-whitespace source to stdin',
        ],
      },
    },
  });
  assert.equal(requests.length, requestsBeforeEmptyStdin, 'empty stdin must refuse before network setup');

  const whitespaceStdin = await run([...base, 'run', '-'], { stdin: ' \n\t' });
  assert.equal(whitespaceStdin.code, 2);
  assert.equal(JSON.parse(whitespaceStdin.stderr).code, 'SNAPBACK_APP_CLI_SCRIPT_EMPTY');
  assert.equal(requests.length, requestsBeforeEmptyStdin, 'whitespace stdin must refuse before network setup');

  const stdinCodeMode = await run([...base, 'run', '-'], {
    stdin: 'export default await api.list({ from: "stdin" });',
  });
  assert.equal(stdinCodeMode.code, 0, stdinCodeMode.stderr);
  assert.deepEqual(JSON.parse(stdinCodeMode.stdout), [{ echoed: { from: 'stdin' } }]);

  const noDefaultExport = await run([...base, 'run', '-'], {
    stdin: 'const complete: boolean = true;',
  });
  assert.equal(noDefaultExport.code, 0, noDefaultExport.stderr);
  assert.equal(noDefaultExport.stdout, '', 'a non-empty program may intentionally export no result');

  const heldStdin = start([...base, 'run', '-']);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(heldStdin.child.exitCode, null, 'run - must wait while its stdin producer remains open');
  heldStdin.child.stdin.end('export default { held: true };');
  const heldResult = await heldStdin.closed;
  assert.equal(heldResult.code, 0, heldResult.stderr);
  assert.deepEqual(JSON.parse(heldResult.stdout), { held: true });

  const types = await run([...base, 'types']);
  assert.equal(types.code, 0, types.stderr);
  assert.match(types.stdout, /declare const api/u);
  assert.match(types.stdout, /readonly "list"/u);

  const typesDirectory = join(scratch, 'types');
  const writtenTypes = await run([...base, 'types', '--out', typesDirectory]);
  assert.equal(writtenTypes.code, 0, writtenTypes.stderr);
  assert.deepEqual(JSON.parse(writtenTypes.stdout), {
    written: [
      join(typesDirectory, 'api.d.ts'),
      join(typesDirectory, 'code-mode.d.ts'),
    ],
    appId: 'cli-test',
  });
  assert.match(await readFile(join(typesDirectory, 'api.d.ts'), 'utf8'), /cli-test:list/u);
  assert.match(await readFile(join(typesDirectory, 'code-mode.d.ts'), 'utf8'), /declare const api/u);

  assert.equal(
    requests.every((request) => request.authorization === null
      && !JSON.stringify(request.body).includes('sbadm_cli_test_must_not_transmit')),
    true,
  );
  console.log('cli.test.mjs: projections, URL default, OAuth login, call, types, and external-script run pass');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
