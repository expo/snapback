import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-generated-ir-'));

try {
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  cards: defineTable({
    title: v.string(), locked: v.boolean(), revision: v.integer(), position: v.integer(),
    owner: v.optional(v.string()), custodian: v.optional(v.principal()),
  }).visibility({ kind: 'owner', field: 'custodian' }).sync(),
});
`);
  writeFileSync(join(root, 'functions.mjs'), `
import {
  add, arg, authKind, authUserId, bindingRef, defineMutation, eqv, field, get, guard, insert, lit,
  patch, returnBinding, runtimeId, v,
} from ${JSON.stringify(defineUrl)};
export const createCard = defineMutation({
  args: { title: v.string(), position: v.integer() },
  plan: insert('cards', {
    title: arg('title'), locked: lit(false), revision: lit(0), position: arg('position'),
  }, { bindIdAs: 'cardId' }),
  returns: returnBinding('cardId'),
});
export const editCard = defineMutation({
  args: { cardId: v.id('cards'), title: v.string() },
  refusals: ['CARD_NOT_FOUND', 'CARD_LOCKED'],
  plan: [
    get('cards', arg('cardId'), 'card', { elseError: 'CARD_NOT_FOUND' }),
    guard(eqv(field(bindingRef('card'), 'locked'), lit(false)), 'CARD_LOCKED'),
    patch('cards', arg('cardId'), {
      title: arg('title'), revision: add(field(bindingRef('card'), 'revision'), lit(1)),
    }),
  ],
});
export const dynamicMint = defineMutation({
  args: {},
  plan: patch('cards', runtimeId(), { title: lit('server') }),
});
export const capturedPrincipalValue = defineMutation({
  args: { title: v.string(), position: v.integer() },
  plan: insert('cards', {
    title: arg('title'), locked: lit(false), revision: lit(0),
    position: arg('position'), owner: authUserId(),
  }),
});
export const authoritativeValue = defineMutation({
  args: { title: v.string(), position: v.integer() },
  plan: insert('cards', {
    title: arg('title'), locked: lit(false), revision: lit(0),
    position: arg('position'), owner: authKind(),
  }),
});
`);

  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const api = await import(`${pathToFileURL(join(root, 'generated', 'api.mjs')).href}?v=1`);
  const create = api.api.createCard.mutationIr;
  assert.equal(create.format, 'snapback.generated-mutation-ir.v1');
  assert.equal(create.capabilityClass, 'local-executable');
  assert.match(create.operationHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(create.mintSites, ['plan/steps/0/insert/row-id']);
  assert.deepEqual(create.declaredReads, []);
  assert.deepEqual(create.localReadRequirements, []);
  assert.equal(create.sourceIdentity.implementationHash, api.api.createCard.implementationHash);
  assert.deepEqual(create.sourceIdentity.activation, api.api.createCard.expectedGeneration);
  assert.equal(
    create.sourceIdentity.activation.schemaHash,
    generated.schemaManifest.schemaHash,
    'mutation references carry the codegen-time schema identity used at migration floors',
  );
  assert.equal(Object.isFrozen(create.plan), true);

  const edit = api.api.editCard.mutationIr;
  assert.equal(edit.capabilityClass, 'local-executable');
  assert.deepEqual(edit.declaredReads, ['cards']);
  assert.deepEqual(edit.localReadRequirements, [{
    kind: 'point',
    table: 'cards',
    idArg: 'cardId',
    binding: 'card',
    requiredFields: ['_id', 'locked', 'revision'],
  }]);
  assert.deepEqual(edit.plan.steps.map((step) => Object.keys(step)[0]), [
    'Get', 'Guard', 'Patch',
  ]);

  assert.equal(api.api.dynamicMint.mutationIr.capabilityClass, 'server-only');
  assert.equal(
    api.api.dynamicMint.mutationIr.capabilityCode,
    'SNAPBACK_GENERATED_IR_POINT_ID_SERVER_ONLY',
  );
  // @ref LLP 0155#move-3--shared-mutation-ir-for-local-prediction-and-server-authority — an owner create's
  // authenticated principal is a captured prediction input; generation keeps
  // the exact capability even when an individual call cannot capture it.
  assert.equal(api.api.capturedPrincipalValue.mutationIr.capabilityClass, 'local-executable');
  assert.equal(api.api.authoritativeValue.mutationIr.capabilityClass, 'server-only');
  assert.equal(
    api.api.authoritativeValue.mutationIr.capabilityCode,
    'SNAPBACK_GENERATED_IR_AUTHORITATIVE_EXPR_SERVER_ONLY',
  );
  const apiTypes = readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /mutationIr\?: GeneratedMutationIrV1/u);
  assert.match(
    apiTypes,
    /export type ProvisionalId<Table extends string> = string & \{ readonly __snapbackProvisionalIdTable: Table \};/u,
    'generated clients expose provisional identity without weakening canonical Id<Table>',
  );

  const firstHash = create.operationHash;
  const regenerated = await generate(root);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  const apiAgain = await import(`${pathToFileURL(join(root, 'generated', 'api.mjs')).href}?v=2`);
  assert.equal(apiAgain.api.createCard.mutationIr.operationHash, firstHash);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('generated-mutation-ir.test.mjs: generated plan/read/identity checks passed');
