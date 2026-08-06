import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {ACTOR_IDS, type ActorId} from '../scripts/bind-actors.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '..');
const GENERATED_FUNCTIONS = join(
  CONTROL_ROOT,
  'snapback/generated/functions.manifest.json',
);
const FIXTURE_ROOT = join(CONTROL_ROOT, 'fixtures/normal-seed-v1');

type Row = Record<string, unknown> & {_id: string};
type Tables = Record<string, Row[]>;

interface ActorBinding {
  role: 'crew' | 'user';
  sourceUserID: string;
  userID: string;
}

async function generatedHandler(name: string): Promise<(
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>> {
  const manifest = JSON.parse(await readFile(GENERATED_FUNCTIONS, 'utf8')) as {
    functions: Array<{
      authRequirement?: string;
      name: string;
      runtime: {IbexModule: {source: string; export: string}};
    }>;
  };
  const generated = manifest.functions.find(item => item.name === name);
  assert(generated, `generate must emit ${name} before this test runs`);
  const sandbox: {__snapbackHandlers?: Record<string, unknown>} = {};
  vm.runInNewContext(generated.runtime.IbexModule.source, sandbox, {
    filename: `${name}.generated.mjs`,
  });
  const handler = sandbox.__snapbackHandlers?.[generated.runtime.IbexModule.export];
  assert.equal(typeof handler, 'function');
  return handler as (
    ctx: unknown,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

async function fixtureContract(): Promise<{
  actors: Record<ActorId, ActorBinding>;
  tables: Tables;
}> {
  const metadata = JSON.parse(
    await readFile(join(FIXTURE_ROOT, 'fixture.json'), 'utf8'),
  ) as {actorBindings: Record<ActorId, ActorBinding>};
  const names = ['user', 'issue', 'viewState', 'searchEpoch'] as const;
  const tables = Object.fromEntries(await Promise.all(names.map(async name => [
    name,
    JSON.parse(await readFile(join(FIXTURE_ROOT, `${name}.json`), 'utf8')) as Row[],
  ]))) as Tables;
  tables.identityBinding = [];
  return {actors: metadata.actorBindings, tables};
}

function mockContext(tables: Tables, principal: string | null) {
  let inserted = 0;
  return {
    auth: principal === null ? null : {userId: principal},
    db: {
      query(table: string) {
        let limit = Number.POSITIVE_INFINITY;
        const equals: Array<[string, unknown]> = [];
        const builder = {
          withIndex() {
            return builder;
          },
          eq(field: string, value: unknown) {
            equals.push([field, value]);
            return builder;
          },
          take(nextLimit: number) {
            limit = nextLimit;
            return builder;
          },
          async collect() {
            return (tables[table] ?? [])
              .filter(row => equals.every(([field, value]) => row[field] === value))
              .slice(0, limit);
          },
          async first() {
            return (await builder.collect())[0] ?? null;
          },
        };
        return builder;
      },
      async get(table: string, id: string) {
        return (tables[table] ?? []).find(row => row._id === id) ?? null;
      },
      async insert(table: string, row: Record<string, unknown>) {
        inserted += 1;
        const id = `${table}_runtime_${inserted}`;
        (tables[table] ??= []).push({_id: id, ...row});
        return id;
      },
    },
  };
}

function installBinding(
  tables: Tables,
  principal: string,
  actor: ActorBinding,
): void {
  tables.identityBinding.push({
    _id: `identity_${principal}`,
    principal,
    sourceUserID: actor.sourceUserID,
    userID: actor.userID,
  });
}

test('Lane 2 functions explicitly require auth and private args carry no identity selector', async () => {
  const manifest = JSON.parse(await readFile(GENERATED_FUNCTIONS, 'utf8')) as {
    functions: Array<{authRequirement?: string; name: string}>;
  };
  const names = [
    'acceptanceBindActor',
    'acceptanceActorBindingSelf',
    'acceptanceCrewGuard',
    'acceptanceOwnershipGuard',
    'acceptancePrivateOverlay',
    'fixtureIngestBatch',
    'fixtureInspectTable',
  ];
  for (const name of names) {
    const fn = manifest.functions.find(item => item.name === name);
    assert(fn, `${name} is generated`);
    assert.equal(fn.authRequirement, 'authenticated', `${name} auth requirement`);
  }

  for (const name of [
    'acceptanceActorBindingSelf',
    'acceptanceCrewGuard',
    'acceptanceOwnershipGuard',
    'acceptancePrivateOverlay',
  ]) {
    const schema = JSON.parse(await readFile(
      join(CONTROL_ROOT, `snapback/generated/operations/${name}.args.schema.json`),
      'utf8',
    )) as {additionalProperties?: boolean; properties?: Record<string, unknown>};
    assert.deepEqual(schema.properties, {});
    assert.equal(schema.additionalProperties, false);
  }
});

test('acceptanceBindActor binds exactly the frozen five and refuses every rebind', async () => {
  const bind = await generatedHandler('acceptanceBindActor');
  const {actors, tables} = await fixtureContract();

  for (const actor of ACTOR_IDS) {
    const principal = `principal_${actor}`;
    const result = await bind(mockContext(tables, principal), {actor}) as Record<string, unknown>;
    assert.equal(result.actor, actor);
    assert.equal(result.principal, principal);
    assert.equal(result.sourceUserID, actors[actor].sourceUserID);
    assert.equal(result.userID, actors[actor].userID);
    await assert.rejects(
      () => bind(mockContext(tables, principal), {actor}),
      /already bound/,
    );
  }
  assert.equal(tables.identityBinding.length, 5);

  await assert.rejects(
    () => bind(mockContext(tables, 'principal_attacker'), {actor: 'attacker'}),
    /closed to the frozen manifest actors/,
  );
  await assert.rejects(
    () => bind(mockContext(tables, 'principal_sixth'), {actor: 'ordinary-user'}),
    /closed after the frozen actor set is complete/,
  );
  await assert.rejects(
    () => bind(mockContext(tables, null), {actor: 'ordinary-user'}),
    /authenticated session/,
  );
});

test('acceptanceBindActor refuses a missing or role-mismatched source user', async () => {
  const bind = await generatedHandler('acceptanceBindActor');
  const missing = await fixtureContract();
  missing.tables.user = missing.tables.user.filter(
    row => row.id !== missing.actors.creator.sourceUserID,
  );
  await assert.rejects(
    () => bind(mockContext(missing.tables, 'principal_missing'), {actor: 'creator'}),
    /source user is unknown/,
  );

  const wrongRole = await fixtureContract();
  const user = wrongRole.tables.user.find(
    row => row.id === wrongRole.actors.creator.sourceUserID,
  );
  assert(user);
  user.role = 'crew';
  await assert.rejects(
    () => bind(mockContext(wrongRole.tables, 'principal_wrong_role'), {actor: 'creator'}),
    /wrong frozen role/,
  );
});

test('principal resolution, crew visibility, ownership, and inspection closure fail closed', async () => {
  const self = await generatedHandler('acceptanceActorBindingSelf');
  const crewGuard = await generatedHandler('acceptanceCrewGuard');
  const ownerGuard = await generatedHandler('acceptanceOwnershipGuard');
  const privateOverlay = await generatedHandler('acceptancePrivateOverlay');
  const fixtureInspect = await generatedHandler('fixtureInspectTable');
  const {actors, tables} = await fixtureContract();

  await assert.rejects(
    () => self(mockContext(tables, 'principal_unbound'), {}),
    /not bound to a source user/,
  );

  installBinding(tables, 'principal_crew', actors['crew-admin']);
  installBinding(tables, 'principal_ordinary', actors['ordinary-user']);
  installBinding(tables, 'principal_creator', actors.creator);
  installBinding(tables, 'principal_assignee', actors.assignee);

  const crew = await crewGuard(mockContext(tables, 'principal_crew'), {}) as Row[];
  assert.equal(crew[0].sourceUserID, actors['crew-admin'].sourceUserID);
  await assert.rejects(
    () => crewGuard(mockContext(tables, 'principal_ordinary'), {}),
    /not authorized/,
  );

  const owner = await ownerGuard(mockContext(tables, 'principal_creator'), {}) as Row[];
  assert.equal(owner[0].sourceIssueID, 'zbav1_internal_issue');
  await assert.rejects(
    () => ownerGuard(mockContext(tables, 'principal_assignee'), {}),
    /not found or is not authorized/,
  );

  const overlay = await privateOverlay(mockContext(tables, 'principal_crew'), {}) as Row[];
  assert.equal(overlay[0].sourceUserID, actors['crew-admin'].sourceUserID);
  await assert.rejects(
    () => privateOverlay(mockContext(tables, 'principal_ordinary'), {}),
    /not authorized/,
  );
  await assert.rejects(
    () => fixtureInspect(mockContext(tables, 'principal_crew'), {table: 'viewState'}),
    /closed after actor binding begins/,
  );
});
