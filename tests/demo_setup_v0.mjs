import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverDemoSetups, provisionDemo } from '../scripts/demo-setup';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const demos = discoverDemoSetups(repoRoot);
assert(demos.has('graffiti'), 'Graffiti is discovered from demo.snapback.json');
assert.deepEqual([...demos.keys()].sort(), [
  'access-desk',
  'all-aboard',
  'backend-bakeoff',
  'card-game',
  'catalog-lens',
  'cursors-web',
  'dispatch-board',
  'graffiti',
  'partiful-matrix',
  'public-dashboard',
  'pulse-monitor',
  'rbac',
  'shindig',
  'team-chat',
  'todo',
  'todo-v2',
]);

for (const [id, setup] of demos) {
  const calls = [];
  const client = {
    health: async () => calls.push(['health']),
    loadSchema: async (manifest) => calls.push(['schema', manifest.artifactKind]),
    loadFunctions: async (manifest) => calls.push(['functions', manifest.artifactKind]),
    reset: async (seed) => calls.push(['reset', seed]),
    seed: async () => calls.push(['seed']),
  };
  const result = await provisionDemo({ demo: id, repoRoot, client });
  assert.equal(calls.filter(([kind]) => kind === 'reset').length, 1, `${id}: exactly one reset`);
  assert.equal(calls.filter(([kind]) => kind === 'seed').length, 0, `${id}: no second seed/reset call`);
  assert.equal(result.seeded, setup.seedPath !== null, `${id}: seed fact follows metadata`);
  assert.equal(calls.at(-1)[1] !== undefined, setup.seedPath !== null, `${id}: seed is carried by reset when declared`);
}

console.log(`demo_setup_v0.mjs: ${demos.size} metadata-declared demos provision through one reset`);
