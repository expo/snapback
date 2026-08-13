// LLP 0090 mixed-route successor: format-2 emission and the byte-frozen
// LLP 0112 format-1 sibling.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  generate,
  routeMixedGroupEligible,
  routeRegisterGroupEligible,
} from './index.mjs';

const defineUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), 'define.mjs'),
).href;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The pinned digests must survive LEGITIMATE generation-input rotation
// (expectedGeneration and content hashes ride every reference and rotate on
// unrelated landings — twice on 2026-08-03 alone) while still failing on the
// defect this guard exists for: a field added, removed, reordered, or
// reinterpreted on the artifact. Volatile hash VALUES are normalized to
// sentinels before digesting; the recursive key structure stays exact.
const normalizeVolatile = (value) => {
  if (Array.isArray(value)) return value.map(normalizeVolatile);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeVolatile(entry)]));
  }
  if (typeof value === 'string') {
    if (/^sha256:[0-9a-f]{8,64}$/u.test(value)) return 'sha256:<volatile>';
    if (/^[0-9a-f]{64}$/u.test(value)) return '<volatile-hex>';
    if (/^gen1:/u.test(value)) return 'gen1:<volatile>';
  }
  return value;
};
const stableDigest = (value) => digest(normalizeVolatile(value));

// These are SHA-256 over the exact JSON.stringify bytes of the generated
// runtime artifacts. Format 1 is deliberately frozen beside the v2 golden so
// later mixed-profile work cannot add, remove, reorder, or reinterpret a v1
// byte without an explicit regression failure. LLP 0247's generated
// authRequirement is the one sanctioned format-1 shape extension. The pins
// rotate whenever generation inputs legitimately rotate (expectedGeneration
// hashes ride every reference); re-pin only after verifying the SHAPE is
// unchanged — any further unreviewed field on format 1 is the defect this
// guard exists to catch.
const FORMAT_1_BYTES_SHA256 = 'fd7d82b5298eba82cb6c68157476df43addcb9fda061ab6ae829430d0012c757';
const FORMAT_2_BYTES_SHA256 = '19c2e49b0fc33b3e62c4784ea35268ec2f8b60d6905ff13f829ecaf24df85090';

test('mixed route emits format 2 from bound liveness while format 1 stays byte-exact', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-mixed-route-v2-'));
  const app = join(root, 'golden-app', 'snapback');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).sync() });
`);
  writeFileSync(join(app, 'functions.mjs'), `
import { defineLiveQuery, defineQuery } from '${defineUrl}';
export const liveTodos = defineLiveQuery({ table: 'todos', args: {} });
export const plainTodos = defineQuery({ table: 'todos', args: {} });
export const otherLiveTodos = defineLiveQuery({ table: 'todos', args: {} });
`);
  writeFileSync(join(app, 'routes.mjs'), `
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([
  { route: '/all-live', queries: [
    { function: 'liveTodos', args: {} },
    { function: 'otherLiveTodos', args: {} },
  ] },
  { route: '/mixed', queries: [
    { function: 'plainTodos', args: {} },
    { function: 'liveTodos', args: {} },
  ] },
]);
`);

  const generated = await generate(app);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const api = await import(`${pathToFileURL(join(app, 'generated', 'api.mjs')).href}?mixed-v2`);
  const allLive = api.groups['/all-live'];
  const mixed = api.groups['/mixed'];

  assert.equal(allLive.formatVersion, 1);
  assert.equal(allLive.profile, undefined);
  assert.equal(allLive.planHash, undefined);
  assert.equal(allLive.id, 'golden-app:query-group:/all-live');
  assert.equal(stableDigest(allLive), FORMAT_1_BYTES_SHA256, 'LLP 0112 format-1 shape/literals changed');
  assert.deepEqual(
    allLive.queries.map((child) => child.ref.authRequirement),
    ['optional-user', 'optional-user'],
  );

  assert.equal(mixed.formatVersion, 2);
  assert.equal(mixed.profile, 'mixed-route.v2');
  assert.equal(mixed.id, 'golden-app:query-group-v2:/mixed');
  assert.equal(stableDigest(mixed), FORMAT_2_BYTES_SHA256, 'mixed-route v2 emission shape/literals changed');
  assert.deepEqual(
    mixed.queries.map((child) => child.ref.authRequirement),
    ['optional-user', 'optional-user'],
  );
  assert.deepEqual(
    mixed.queries.map((child) => child.liveness),
    [
      { kind: 'none' },
      { delivery: 'live_replace', kind: 'admitted', pageDomain: 'whole-result' },
    ],
  );
  for (const child of mixed.queries) {
    assert.deepEqual(
      child.liveness,
      child.nodePlan.capability.live,
      'the explicit child fact is exactly the PlanHashV1-bound capability fact',
    );
  }
  assert.deepEqual(
    mixed.queries[0].nodePlan.normalizedPlan,
    mixed.queries[1].nodePlan.normalizedPlan,
    'the A3 near-miss starts with byte-identical normalized storage plans',
  );
  assert.notEqual(
    mixed.queries[0].nodePlanHash,
    mixed.queries[1].nodePlanHash,
    'only the explicit Query/LiveQuery capability binding rotates node identity',
  );

  const routes = JSON.parse(readFileSync(join(app, 'generated', 'routes.manifest.json'), 'utf8'));
  const allLiveRoute = routes.routes.find((entry) => entry.route === '/all-live');
  const mixedRoute = routes.routes.find((entry) => entry.route === '/mixed');
  assert.equal(allLiveRoute.registerGroupEligible, true);
  assert.equal(Object.hasOwn(allLiveRoute, 'mixedGroupEligible'), false);
  assert.equal(mixedRoute.mixedGroupEligible, true);
  assert.equal(Object.hasOwn(mixedRoute, 'registerGroupEligible'), false);

  const authored = {
    liveTodos: { __kind: 'LiveQuery', args: {} },
    plainTodos: { __kind: 'Query', args: {} },
  };
  assert.equal(routeRegisterGroupEligible([
    { function: 'liveTodos', args: {} },
  ], authored), true);
  assert.equal(routeRegisterGroupEligible([
    { function: 'liveTodos', args: {} },
    { function: 'plainTodos', args: {} },
  ], authored), false);
  assert.equal(routeMixedGroupEligible([
    { function: 'liveTodos', args: {} },
    { function: 'plainTodos', args: {} },
  ], authored), true);

  const declarations = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.d.mts'), 'utf8');
  assert.match(
    declarations,
    /export function routeMixedGroupEligible\(/u,
    'the public runtime predicate must retain its package declaration',
  );
});
