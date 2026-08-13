import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '../snapback-client/index.mjs';
import { SEARCH_REQUEST_ARGS_CONTRACT_HASH } from '../snapback-client/search-contract.generated.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(packageRoot));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-typed-search-wrapper-'));

try {
  const snapbackModules = join(backend, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(
    join(repositoryRoot, 'packages', 'snapback-client'),
    join(snapbackModules, 'snapback-client'),
    'dir',
  );
  symlinkSync(packageRoot, join(snapbackModules, 'snapback-codegen'), 'dir');

  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};

export const rooms = defineTable({ name: v.string() });
export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'roomMembers',
  resource: 'roomId',
  principal: 'userId',
  role: 'role',
  roles: ['member'],
});
export const messages = defineTable({
  roomId: v.id('rooms'),
  body: v.string(),
}).searchIndex('search_messages', {
  semanticVersion: 'typed-search-wrapper.v1',
  textFields: { body: { weight: 4, classification: 'private' } },
  fieldClassifications: { roomId: 'private' },
  storedFields: ['body'],
  visibility: {
    kind: 'membership',
    declaration: 'roomMembers',
    resourceField: 'roomId',
  },
});
export const incidents = defineTable({
  title: v.string(),
}).searchIndex('search_incidents', {
  semanticVersion: 'typed-search-wrapper.v1',
  textFields: { title: { weight: 4, classification: 'public' } },
  storedFields: ['title'],
  visibility: { kind: 'public-read' },
});

export default defineSchema(
  { rooms, roomMembers, messages, incidents },
  { auth: { mode: 'sessions' } },
);
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineSearchQuery } from ${JSON.stringify(defineUrl)};
import { incidents, messages } from './schema.mjs';

export const searchIncidents = defineSearchQuery({
  table: incidents,
  index: 'search_incidents',
});
export const searchMessages = defineSearchQuery({
  table: messages,
  index: 'search_messages',
  resourceArg: 'roomId',
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const { default: api } = await import(
    `${pathToFileURL(join(backend, 'generated', 'api.mjs')).href}?test=${Date.now()}`
  );

  // @ref LLP 0131#amendment-2026-08-09-typed-search-selector-witness-for-resource-scoped-references
  // — both real codegen variants carry the same request-grammar witness, while
  // the resource-scoped operation keeps its distinct complete-args witness.
  assert.equal(api.searchIncidents.searchRequestContractHash, SEARCH_REQUEST_ARGS_CONTRACT_HASH);
  assert.equal(api.searchMessages.searchRequestContractHash, SEARCH_REQUEST_ARGS_CONTRACT_HASH);
  assert.equal(api.searchIncidents.argsContractHash, SEARCH_REQUEST_ARGS_CONTRACT_HASH);
  assert.notEqual(api.searchMessages.argsContractHash, SEARCH_REQUEST_ARGS_CONTRACT_HASH);
  assert.equal(api.searchIncidents.searchResourceArg, null);
  assert.equal(api.searchMessages.searchResourceArg, 'roomId');

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ version: 1, rows: [], cursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const query = { all: [{ Term: { value: 'release' } }] };
  try {
    const client = new SnapbackClient('http://snapback.test', {
      bearerToken: 'sbses_typed_search_wrapper',
    });
    await client.search(api.searchIncidents, { query });
    await client.search(api.searchMessages, { roomId: 'room_01', query });
    assert.deepEqual(
      requests.map(({ body }) => body.args),
      [
        { query },
        { query, roomId: 'room_01' },
      ],
    );
    await assert.rejects(
      client.search({
        ...api.searchMessages,
        searchRequestContractHash: `sha256:${'0'.repeat(64)}`,
      }, { roomId: 'room_01', query }),
      (error) => error.code === 'SNAPBACK_SEARCH_REFERENCE_INVALID'
        && /contract generation/u.test(error.message),
    );
    await assert.rejects(
      client.search(api.searchMessages, { query }),
      (error) => error.code === 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED'
        && error.diagnostic?.details?.path === 'args.roomId',
    );
    assert.equal(requests.length, 2, 'reference and complete-argument validation must refuse before I/O');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const fixturePath = join(backend, 'typed-search.fixture.ts');
  writeFileSync(fixturePath, `
import { SnapbackClient, search } from '@expo/snapback-client';
import api, { type Id } from './generated/api';

declare const roomId: Id<'rooms'>;
const client = new SnapbackClient('http://snapback.test');
const query = search.all(search.term('release'));
client.search(api.searchIncidents, { query });
client.search(api.searchMessages, { roomId, query });
// @ts-expect-error generated resource-scoped search requires its resource argument.
client.search(api.searchMessages, { query });
// @ts-expect-error plain search has no resource argument.
client.search(api.searchIncidents, { roomId, query });
`);
  const tsc = spawnSync(
    join(repositoryRoot, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      fixturePath,
    ],
    { cwd: backend, encoding: 'utf8' },
  );
  assert.equal(
    tsc.status,
    0,
    `generated typed-search consumer failed strict typecheck\n${tsc.stdout}\n${tsc.stderr}`,
  );
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('typed-search-wrapper.test.mjs: generated plain/resource refs compose with client.search');
