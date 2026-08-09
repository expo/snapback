import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  ],
}));
await writeFile(join(generated, 'api.d.ts'), [
  'export interface CliTestApi {',
  "  readonly list: 'cli-test:list';",
  "  readonly privateList: 'cli-test:privateList';",
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
const requests = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
  requests.push({ path: request.url, body, authorization: request.headers.authorization ?? null });
  const send = (value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.url === '/inspect') return send({
    appId: 'cli-test',
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
  if (request.url === '/query/list') return send({ rows: [{ echoed: body.args }], version: 1 });
  if (request.url === '/query/privateList') return send({ rows: [{ private: true }], version: 1 });
  return send({ diagnostic: { code: 'SNAPBACK_TEST_UNEXPECTED' } }, 404);
});

const start = (args) => {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: 'sbadm_cli_test_must_not_transmit' },
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
  console.log('cli.test.mjs: introspect, call, preflight, types topology, and external-script run pass');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
