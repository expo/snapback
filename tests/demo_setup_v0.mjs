import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverDemoSetups, provisionDemo } from '../scripts/demo-setup';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const EXPECTED_DEMO_IDS = Object.freeze([
  'access-desk',
  'all-aboard',
  'backend-bakeoff',
  'browser-auth',
  'browser-local-first',
  'campfire',
  'card-game',
  'catalog-lens',
  'chirp',
  'cursors-web',
  'dispatch-board',
  'file-drop',
  'fleet-observatory-move1',
  'graffiti',
  'latency-kanban',
  'media-happy-post',
  'messaging-snapback',
  'partiful-matrix',
  'party-wall',
  'pointing-room',
  'public-dashboard',
  'pulse-monitor',
  'rbac',
  'shindig',
  'team-chat',
  'tiny-triumphs',
  'todo',
  'todo-v2',
  'triage-graph',
]);

export function auditDemoInventory({ root = repoRoot, expectedIds = EXPECTED_DEMO_IDS } = {}) {
  const demos = discoverDemoSetups(root);
  const discovered = [...demos.keys()].sort();
  const expected = [...expectedIds].sort();
  return {
    demos,
    discovered,
    expected,
    unexpected: discovered.filter((id) => !expected.includes(id)),
    missing: expected.filter((id) => !discovered.includes(id)),
  };
}

export function inspectDemoInventory(options = {}) {
  const audit = auditDemoInventory(options);
  assert.deepEqual(
    { unexpected: audit.unexpected, missing: audit.missing },
    { unexpected: [], missing: [] },
    'metadata-declared demo IDs drifted from the reviewed materialization inventory',
  );
  return audit;
}

async function main() {
  const { demos } = inspectDemoInventory();
  assert(demos.has('graffiti'), 'Graffiti is discovered from demo.snapback.json');
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
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();
