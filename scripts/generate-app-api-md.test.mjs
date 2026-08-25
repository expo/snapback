import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import {
  AppApiMdError,
  envelopeSha256,
  generateApiMarkdown,
  main,
} from './generate-app-api-md.mjs';

// @ref LLP 0204#d2--surface-1-the-third-party-api — the S0 API.md acceptance
//   fixture proves the envelope projection, token walkthrough, and finite routes.

const ROOT = resolve(import.meta.dirname, '..');
const GENERATOR = resolve(ROOT, 'scripts/generate-app-api-md.mjs');

function functionDefinition(id, name, kind, authRequirement) {
  const runtimeKind = kind === 'LiveQuery' ? 'Query' : kind;
  return {
    id,
    name,
    exportedName: null,
    kind,
    stream: false,
    sequences: [],
    resultContract: { kind: 'unknown' },
    requiredCapabilities: [],
    authRequirement,
    authorityIndependent: false,
    publicInline: false,
    rqsEligible: false,
    authorityCreating: false,
    retainable: false,
    authorizationDependence: [],
    authorityProfileDependence: [],
    syncabilityClass: null,
    readSetSummary: {},
    writeSetSummary: {},
    permissionEpochBumps: [],
    bundleEntrypoint: null,
    uses: [],
    runtime: { HostPlan: runtimeKind },
  };
}

function fixtureEnvelope() {
  const functions = [
    functionDefinition('fn-action', 'rebuildSearch', 'Action', 'authenticated'),
    functionDefinition('fn-query-z', 'zebra.list', 'Query', null),
    functionDefinition('fn-mutation', 'posts.create', 'Mutation', 'authenticated'),
    functionDefinition('fn-query-a', 'alpha.find', 'Query', 'public'),
  ];
  return {
    artifactKind: 'apiEnvelope',
    formatVersion: 'snapback.api-envelope.v1',
    appId: 'fixture-app',
    tuple: { schemaVersion: 'snapback.v1', authMode: 'sessions' },
    inputsHash: 'inputs-fixture',
    bundleHash: 'bundle-fixture',
    functions: {
      artifactKind: 'functions',
      schemaVersion: 'snapback.v1',
      appId: 'fixture-app',
      bundleHash: 'bundle-fixture',
      inputsHash: 'inputs-fixture',
      generatedAt: null,
      unsupportedDependencyDiagnostics: [],
      functions,
      cronJobs: [],
      config: [],
    },
    operations: {
      'fn-action': {
        name: 'rebuildSearch',
        argsSchema: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: {
              type: 'string',
              enum: ['incremental', 'full'],
              description: 'Rebuild strategy.',
            },
          },
          additionalProperties: false,
        },
      },
      'fn-query-z': {
        name: 'zebra.list',
        argsSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      'fn-mutation': {
        name: 'posts.create',
        argsSchema: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, description: 'Post title.' },
            metadata: {
              type: 'object',
              description: 'Optional publishing metadata.',
              required: ['note'],
              properties: {
                note: { type: 'string', description: 'Required only when metadata is present.' },
                featured: { type: 'boolean', description: 'Whether to feature the post.' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      'fn-query-a': {
        name: 'alpha.find',
        argsSchema: {
          type: 'object',
          required: ['filter'],
          properties: {
            cursor: {
              type: ['string', 'null'],
              description: 'Optional pagination cursor.',
            },
            filter: {
              type: 'object',
              description: 'Required search filter.',
              required: ['term'],
              properties: {
                limit: { type: 'integer', minimum: 1, description: 'Optional result limit.' },
                term: { type: 'string', minLength: 1, description: 'Text to find.' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
    declarations: { appBindings: 'declare const fixture: true;\n' },
    memberDigests: {
      'operation:fn-action': 'fixture-action-member',
      'operation:fn-query-z': 'fixture-query-z-member',
      'operation:fn-mutation': 'fixture-mutation-member',
      'operation:fn-query-a': 'fixture-query-a-member',
      'declaration:appBindings': 'fixture-declaration-member',
    },
  };
}

function exposedOnlyFixtureEnvelope() {
  const exposed = structuredClone(fixtureEnvelope());
  const exposedIds = new Set(['fn-query-a', 'fn-mutation']);
  exposed.functions.functions = exposed.functions.functions
    .filter((definition) => exposedIds.has(definition.id))
    .map((definition) => ({
      ...definition,
      apiExposure: { expose: true, since: '2026-08-09' },
    }));
  exposed.operations = Object.fromEntries(
    Object.entries(exposed.operations).filter(([id]) => exposedIds.has(id)),
  );
  exposed.memberDigests = Object.fromEntries(
    Object.entries(exposed.memberDigests).filter(
      ([key]) => key === 'declaration:appBindings'
        || exposedIds.has(key.replace(/^operation:/u, '')),
    ),
  );
  return exposed;
}

function fixtureDiscovery(envelope) {
  return {
    artifactKind: 'appApiDiscovery',
    formatVersion: 'snapback.app-api-discovery.v1',
    appId: envelope.appId,
    tuple: {
      schemaVersion: envelope.tuple.schemaVersion,
      authMode: envelope.tuple.authMode,
      schemaHash: 'schema-fixture',
      bundleHash: envelope.bundleHash,
      inputsHash: envelope.inputsHash,
    },
    envelope: { state: 'current', sha256: envelopeSha256(envelope) },
    appCliTarget: false,
    appCliDescriptor: null,
    engineRange: null,
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let scratch;
let envelope;
let discovery;
let envelopePath;
let discoveryPath;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'snapback-app-api-md-'));
  envelope = fixtureEnvelope();
  discovery = fixtureDiscovery(envelope);
  envelopePath = join(scratch, 'envelope.json');
  discoveryPath = join(scratch, 'discovery.json');
  writeFileSync(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  writeFileSync(discoveryPath, `${JSON.stringify(discovery, null, 2)}\n`);
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test('output is deterministic byte-for-byte and --out writes the same bytes', () => {
  const first = runCli(['--envelope', envelopePath, '--discovery', discoveryPath]);
  const second = runCli(['--envelope', envelopePath, '--discovery', discoveryPath]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stderr, '');
  assert.equal(second.stderr, '');
  assert.match(first.stdout, new RegExp(envelopeSha256(envelope), 'u'));
  assert.match(first.stdout, /"schemaHash":"schema-fixture"/u);
  assert.doesNotMatch(first.stdout, /generatedAt|generated at|timestamp/iu);

  const standalone = runCli(['--envelope', envelopePath]);
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.match(standalone.stdout, /Generation tuple \(envelope-carried fields\)/u);
  assert.match(standalone.stdout, /does not carry the discovery tuple's `schemaHash`/u);
  assert.doesNotMatch(standalone.stdout, /"schemaHash":"schema-fixture"/u);

  const outPath = join(scratch, 'API.md');
  const written = runCli([
    '--envelope', envelopePath,
    '--discovery', discoveryPath,
    '--out', outPath,
  ]);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, '');
  assert.equal(readFileSync(outPath, 'utf8'), first.stdout);
});

test('functions are grouped by protocol kind and sorted by operation name', async () => {
  const markdown = await generateApiMarkdown({ envelopePath, discoveryPath });
  const queries = markdown.indexOf('## Queries');
  const mutations = markdown.indexOf('## Mutations');
  const actions = markdown.indexOf('## Actions');
  assert(queries >= 0 && mutations > queries && actions > mutations);

  const alpha = markdown.indexOf('### `alpha.find`');
  const zebra = markdown.indexOf('### `zebra.list`');
  const mutation = markdown.indexOf('### `posts.create`');
  const action = markdown.indexOf('### `rebuildSearch`');
  assert(alpha > queries && zebra > alpha && zebra < mutations);
  assert(mutation > mutations && mutation < actions);
  assert(action > actions);
  assert.match(markdown, /Route: `POST \/query\/alpha\.find`/u);
  assert.match(markdown, /Route: `POST \/mutation\/posts\.create`/u);
  assert.match(markdown, /Route: `POST \/action\/rebuildSearch`/u);
});

test('an exposure-filtered API envelope renders only versioned external routes', async () => {
  const exposed = exposedOnlyFixtureEnvelope();
  const path = join(scratch, 'exposed-only-envelope.json');
  writeFileSync(path, `${JSON.stringify(exposed, null, 2)}\n`);
  const markdown = await generateApiMarkdown({ envelopePath: path });

  assert.match(markdown, /`POST \/api\/v1\/query\/\{name\}`/u);
  assert.match(markdown, /Route: `POST \/api\/v1\/query\/alpha\.find`/u);
  assert.match(markdown, /Route: `POST \/api\/v1\/mutation\/posts\.create`/u);
  assert.doesNotMatch(markdown, /zebra\.list|rebuildSearch/u);
  const example = markdown.slice(markdown.indexOf('#### Example'));
  assert.match(example, /SNAPBACK_BASE_URL\/api\/v1\/query\/alpha\.find/u);
  assert.doesNotMatch(example, /read_set|expectedGeneration/u);
});

test('nested and optional argument fields render readably and examples are minimal', async () => {
  const markdown = await generateApiMarkdown({ envelopePath, discoveryPath });
  assert.match(
    markdown,
    /\| `filter` \| object \| yes \| Required search filter\. \|/u,
  );
  assert.match(
    markdown,
    /\| `filter\.term` \| string \| yes \| Text to find\. \|/u,
  );
  assert.match(
    markdown,
    /\| `filter\.limit` \| integer \| no \| Optional result limit\. \|/u,
  );
  assert.match(
    markdown,
    /\| `metadata\.note` \| string \| when parent is present \| Required only when metadata is present\. \|/u,
  );
  assert.match(
    markdown,
    /"args": \{\n    "filter": \{\n      "term": "x"\n    \}\n  \},\n  "read_set": \[\]/u,
  );
  assert.doesNotMatch(
    markdown.slice(markdown.indexOf('### `alpha.find`'), markdown.indexOf('### `zebra.list`')),
    /"cursor"|"limit"/u,
  );
  assert.match(markdown, /auth\.agents\.mode/u);
  assert.match(markdown, /POST \/auth\/agents\/register/u);
  assert.match(markdown, /auth\/pairing-codes/u);
  assert.match(markdown, /auth\/agents\/pair/u);
  assert.match(markdown, /POST \/auth\/agents\/token/u);
  assert.match(markdown, /POST \/auth\/agents\/token\/release/u);
  assert.match(markdown, /scoped, expiring, and revocable/u);
});

async function assertTypedAndCliRefusal(mutated, expectedCode, name) {
  const path = join(scratch, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(mutated, null, 2)}\n`);
  await assert.rejects(
    () => generateApiMarkdown({ envelopePath: path }),
    (error) => {
      assert(error instanceof AppApiMdError);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
  const cli = runCli(['--envelope', path]);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, new RegExp(expectedCode, 'u'));
}

test('schema version and artifactKind mismatches are typed nonzero refusals', async () => {
  await assertTypedAndCliRefusal(
    {
      ...envelope,
      tuple: { ...envelope.tuple, schemaVersion: 'snapback.v2' },
    },
    'SNAPBACK_APP_API_MD_SCHEMA_VERSION_MISMATCH',
    'bad-schema-version',
  );
  await assertTypedAndCliRefusal(
    { ...envelope, formatVersion: 'snapback.api-envelope.v2' },
    'SNAPBACK_APP_API_MD_ENVELOPE_VERSION_UNSUPPORTED',
    'bad-version',
  );
  await assertTypedAndCliRefusal(
    { ...envelope, artifactKind: 'someOtherArtifact' },
    'SNAPBACK_APP_API_MD_ARTIFACT_KIND_INVALID',
    'bad-kind',
  );
});

test('a malformed envelope is a typed nonzero refusal', async () => {
  const malformed = structuredClone(envelope);
  delete malformed.functions.functions[0].resultContract;
  await assertTypedAndCliRefusal(
    malformed,
    'SNAPBACK_APP_API_MD_ENVELOPE_INVALID',
    'malformed',
  );
});

test('--server fetches discovery then its content-addressed envelope', async () => {
  const serverEnvelope = structuredClone(envelope);
  serverEnvelope.functions.functions = serverEnvelope.functions.functions.map((definition) => {
    const zeroValueProjection = { ...definition };
    delete zeroValueProjection.stream;
    delete zeroValueProjection.authorizationDependence;
    delete zeroValueProjection.authorityProfileDependence;
    return zeroValueProjection;
  });
  const serverDiscovery = fixtureDiscovery(serverEnvelope);
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/app-api/current') {
      response.end(JSON.stringify(serverDiscovery));
      return;
    }
    if (request.url === `/app-api/envelope/${serverDiscovery.envelope.sha256}`) {
      response.end(JSON.stringify(serverEnvelope));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'unexpected fixture path' }));
  });
  // The execution sandbox forbids binding a loopback socket. Drive the real
  // http.createServer request handler through the generator's fetch seam so
  // server mode still exercises both HTTP resources and their exact order.
  const fetchImpl = async (url) => new Promise((resolvePromise, reject) => {
    const request = { url: new URL(url).pathname, headers: { accept: 'application/json' } };
    let status = 200;
    let headers = {};
    const response = {
      statusCode: 200,
      writeHead(nextStatus, nextHeaders = {}) {
        status = nextStatus;
        headers = nextHeaders;
      },
      end(body = '') {
        resolvePromise(new Response(body, { status: this.statusCode === 200 ? status : this.statusCode, headers }));
      },
    };
    try {
      server.emit('request', request, response);
    } catch (error) {
      reject(error);
    }
  });
  const previousFetch = globalThis.fetch;
  let markdown = '';
  try {
    globalThis.fetch = fetchImpl;
    const status = await main(
      ['--server', 'http://127.0.0.1:43210'],
      { stdout: { write: (chunk) => { markdown += chunk; } } },
    );
    assert.equal(status, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(paths, [
    '/app-api/current',
    `/app-api/envelope/${serverDiscovery.envelope.sha256}`,
  ]);
  assert.match(markdown, /Generation tuple: .*"schemaHash":"schema-fixture"/u);
  assert.match(markdown, /The envelope is the authority/u);
});
