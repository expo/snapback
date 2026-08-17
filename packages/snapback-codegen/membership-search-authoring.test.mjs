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

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(packageRoot));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dirs = [];

const schemaSource = ({
  appScoped = false,
  declaration = 'roomMembers',
  extraVisibility = '',
  owner = false,
  roles = "['member']",
} = {}) => `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};

export const rooms = defineTable({ name: v.string() }).visibility({ kind: 'public-read' });

export const roomMembers = defineTable({
  ${appScoped ? '' : "roomId: v.id('rooms'),"}
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'roomMembers',
  ${appScoped ? "scope: 'app'," : "resource: 'roomId',"}
  principal: 'userId',
  role: 'role',
  roles: ['member', 'admin'],
  pendingRoles: ['invited'],
});

export const messages = defineTable({
  roomId: v.id('rooms'),
  ownerId: v.principal(),
  body: v.string(),
}).visibility(${owner
    ? "{ kind: 'owner', field: 'ownerId' }"
    : (appScoped || declaration !== 'roomMembers' || roles !== "['member']" || extraVisibility
      ? "{ kind: 'public-read' }"
      : `{ kind: 'membership', declaration: ${declaration}, resourceField: 'roomId', roles: ${roles} }`)})
  .searchIndex('search_messages', {
  semanticVersion: 'membership-search-authoring.v1',
  textFields: { body: { weight: 4, classification: 'private' } },
  fieldClassifications: { ${owner ? "ownerId: 'private'" : "roomId: 'private'"} },
  storedFields: ['body'],
  highlightFields: ['body'],
  visibility: ${owner
    ? "{ kind: 'owner', field: 'ownerId' }"
    : `{ kind: 'membership', declaration: ${declaration}, resourceField: 'roomId', roles: ${roles}${extraVisibility} }`},
});

export default defineSchema({ rooms, roomMembers, messages }, { auth: { mode: 'sessions' } });
`;

const functionsSource = ({
  auth = '',
  mutateArgs = '',
  resourceArg = "resourceArg: 'roomId',",
} = {}) => `
import { defineSearchQuery${mutateArgs ? ', v' : ''} } from ${JSON.stringify(defineUrl)};
import { messages } from './schema.mjs';

export const searchMessages = defineSearchQuery({
  table: messages,
  index: 'search_messages',
  ${auth}
  ${resourceArg}
});
${mutateArgs}
`;

async function run({ schema = schemaSource(), functions = functionsSource() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-membership-search-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  const result = await generate(dir);
  return { dir, result };
}

function assertRefused(result, pattern, label) {
  assert.equal(result.ok, false, `${label} unexpectedly generated`);
  assert.match(
    result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('\n'),
    pattern,
    `${label} omitted its fail-closed diagnostic: ${JSON.stringify(result.diagnostics)}`,
  );
}

try {
  {
    const { dir, result } = await run();
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

    const functionsManifest = JSON.parse(readFileSync(
      join(dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const operation = functionsManifest.functions.find(({ name }) => name === 'searchMessages');
    assert.equal(operation.runtime.HostPlan.SearchQuery.resourceArg, 'roomId');
    assert.deepEqual(operation.readSetSummary.tables, ['messages', 'roomMembers']);
    const resourceContract = operation.argsContract.fields.find(({ name }) => name === 'roomId');
    assert.deepEqual(resourceContract, {
      name: 'roomId',
      required: true,
      value: { kind: 'id', table: 'rooms' },
    });

    const operationSchema = JSON.parse(readFileSync(
      join(dir, 'generated', 'operations', 'searchMessages.args.schema.json'),
      'utf8',
    ));
    assert.deepEqual(operationSchema.required, ['query', 'roomId']);
    assert.equal(operationSchema.additionalProperties, false);

    const schemaManifest = JSON.parse(readFileSync(
      join(dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const searchIndex = schemaManifest.tables
      .find(({ name }) => name === 'messages')
      .searchIndexes.find(({ name }) => name === 'search_messages');
    assert.deepEqual(searchIndex.visibility, {
      kind: 'membership',
      declaration: 'roomMembers',
      resourceField: 'roomId',
      roles: ['member'],
    });
    assert.deepEqual(Object.keys(searchIndex.visibility), [
      'declaration',
      'kind',
      'resourceField',
      'roles',
    ]);

    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert.match(
      apiTypes,
      /"searchMessages": FunctionReference<"searchMessages", 'Query', SearchRequestV1 & \{ roomId: Id<'rooms'> \},/u,
    );

    const snapbackModules = join(dir, 'node_modules', '@expo');
    mkdirSync(snapbackModules, { recursive: true });
    symlinkSync(
      join(repositoryRoot, 'packages', 'snapback-client'),
      join(snapbackModules, 'snapback-client'),
      'dir',
    );
    symlinkSync(
      join(repositoryRoot, 'packages', 'snapback-codegen'),
      join(snapbackModules, 'snapback-codegen'),
      'dir',
    );
    writeFileSync(join(dir, 'consumer.ts'), `
import api, { type FunctionArgs, type Id, type SearchRequestV1 } from './generated/api';

declare const request: SearchRequestV1;
declare const roomId: Id<'rooms'>;

const complete: FunctionArgs<typeof api.searchMessages> = { ...request, roomId };
void complete;
// @ts-expect-error membership search requires its equality-bound resource argument.
const missing: FunctionArgs<typeof api.searchMessages> = request;
void missing;
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
        'consumer.ts',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(
      tsc.status,
      0,
      `generated membership-search consumer failed exact typecheck\n${tsc.stdout}\n${tsc.stderr}`,
    );
  }

  {
    const { result } = await run({ functions: functionsSource({ resourceArg: '' }) });
    assertRefused(result, /singular membership partition/u, 'missing resourceArg');
  }

  {
    const { result } = await run({ functions: functionsSource({ auth: "auth: 'public'," }) });
    assertRefused(result, /membership search requires authenticated auth/u, 'public membership search');
  }

  {
    const { result } = await run({
      functions: functionsSource({ mutateArgs: 'searchMessages.args.roomId = v.string();' }),
    });
    assertRefused(result, /required equality-compatible scalar argument/u, 'mismatched resource argument validator');
  }

  {
    const { result } = await run({ schema: schemaSource({ owner: true }) });
    assertRefused(result, /owner search must not declare resourceArg/u, 'resourceArg on owner visibility');
  }

  {
    const { result } = await run({ schema: schemaSource({ declaration: "'missingMembers'" }) });
    assertRefused(result, /names unknown (?:membership )?declaration missingMembers/u, 'unknown declaration');
  }

  {
    const { result } = await run({ schema: schemaSource({ appScoped: true }) });
    assertRefused(result, /must be resource-scoped/u, 'app-scoped declaration');
  }

  {
    const { result } = await run({ schema: schemaSource({ roles: "['moderator']" }) });
    assertRefused(result, /role moderator is outside declaration roomMembers's vocabulary/u, 'role outside vocabulary');
  }

  {
    const { result } = await run({ schema: schemaSource({ extraVisibility: ', extra: true' }) });
    assertRefused(result, /membership visibility has unknown field extra/u, 'extra membership visibility key');
  }

  console.log('membership-search-authoring.test.mjs: generation, refusals, manifests, and types pass');
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
