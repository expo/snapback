import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../snapback-codegen/index.mjs';
import { applyDataPromotionPreview, previewDataPromotion } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(repoRoot, 'packages', 'snapback-codegen', 'define.mjs')).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-promotion-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({
    ownerId: v.principal(), title: v.string(), createdAt: v.integer(),
  })
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] }),
});
`);
  writeFileSync(join(root, 'functions.mjs'), 'export const nothing = 0;\n');
  return root;
}

function familiarFixture() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-promotion-familiar-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.ts'), `
import { defineSchema, defineTable, v } from './_generated/server';
export default defineSchema({
  todos: defineTable({
    ownerId: v.principal(), title: v.string(), createdAt: v.integer(),
  })
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] }),
});
`);
  writeFileSync(join(root, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }));
  return root;
}

test('promotion previews frozen facts, applies stale-safely, and replaces one generated member', async () => {
  const root = fixture();
  const initial = await generate(root);
  assert.equal(initial.ok, true, JSON.stringify(initial.diagnostics));
  const beforeId = initial.dataResources[0].normalizedDataResourceId;
  const preview = await previewDataPromotion('todos.update', 'explicit', { cwd: root });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.approvalRequired, true);
  assert.match(preview.patch, /normalizedDataResourceId/u);
  assert.match(preview.patch, /"todos\.update"/u);
  assert.equal(preview.semanticDiff.normalizedDataResourceId, 'unchanged');

  const stale = { ...preview, destinationSha256: 'sha256:stale' };
  const staleResult = applyDataPromotionPreview(stale);
  assert.equal(staleResult.code, 'SNAPBACK_DATA_PROMOTION_REFUSED');
  assert.equal(staleResult.guideAnchor, 'guide/data/resources#promote-one-write');
  const applied = applyDataPromotionPreview(preview);
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.match(readFileSync(join(root, 'functions.mjs'), 'utf8'), /__dataPromotion/u);

  const regenerated = await generate(root);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.equal(regenerated.dataResources[0].normalizedDataResourceId, beforeId);
  const promoted = regenerated.functionManifest.functions.find(({ name }) => name === 'todos.update');
  assert.deepEqual(promoted.standardPattern, { helper: 'owned-crud.v1', profile: 'owner.v1' });
  assert.equal(
    regenerated.functionManifest.functions.filter(({ name }) => name === 'todos.update').length,
    1,
  );
});

test('promotion refuses familiar owner writes with an explicit alternative', async () => {
  const root = familiarFixture();
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const refused = await previewDataPromotion('todos.create', 'familiar', { cwd: root });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SNAPBACK_DATA_PROMOTION_REFUSED');
  assert.equal(refused.guideAnchor, 'guide/data/resources#promote-one-write');
  assert.equal(
    refused.details.alternative,
    'snapback data promote todos.create --format explicit',
  );
  assert.match(refused.message, /cannot express the generated owner guard/u);
});
