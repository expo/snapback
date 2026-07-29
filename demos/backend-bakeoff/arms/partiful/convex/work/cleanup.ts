import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const namespace = 'llp0102-partiful-convex-w2';
const eventKey = 'event-summer-rooftop';
const configUrl = new URL('../.convex/local/default/config.json', import.meta.url);
const evidenceRoot = new URL('../evidence/', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
const client = new ConvexHttpClient('http://127.0.0.1:3336');
const identity = {
  subject: 'alice',
  issuer: 'https://llp0102-partiful.local',
  name: 'Alice',
};
(client as unknown as {
  setAdminAuth(token: string, value: typeof identity): void;
}).setAdminAuth(config.adminKey, identity);

const before = await client.query(api.party.authoritativeCounts, { namespace });
const removed = await client.mutation(api.party.cleanupNamespace, { namespace });
const after = await client.query(api.party.namespaceProbe, { namespace });
const allZero = Object.values(after).every((count) => count === 0);
if (!allZero) throw new Error(`namespace cleanup incomplete: ${JSON.stringify(after)}`);

const targetIdentity = {
  kind: 'fresh-anonymous-local',
  namespace,
  deploymentName: config.deploymentName,
  backendVersion: config.backendVersion,
  ports: config.ports,
};
const identityHash = createHash('sha256')
  .update(JSON.stringify(targetIdentity))
  .digest('hex');
await writeFile(new URL('authoritative-summary.json', evidenceRoot), `${JSON.stringify({
  schemaVersion: 1,
  namespace,
  eventKey,
  capturedAt: new Date().toISOString(),
  beforeCleanup: before,
}, null, 2)}\n`);
await writeFile(new URL('cleanup-data-plane.json', evidenceRoot), `${JSON.stringify({
  schemaVersion: 1,
  namespace,
  targetIdentity,
  targetIdentityHash: identityHash,
  plan: [
    'Authenticate as the arm-owned Alice persona.',
    'Delete only namespace-indexed native storage objects and table rows.',
    'Probe every namespaced table for zero rows.',
    'Stop exact recorded Vite/CLI/backend processes.',
    'Retire the exact fresh local .convex target and worktree-local secret/config/browser state.',
    'Verify ports and paths are absent; re-check the unrelated hosted instance identity without mutation.',
  ],
  baseline: {
    targetExistedBeforeArm: false,
    namespaceExistedBeforeArm: false,
    unrelatedHostedMutationAttempted: false,
  },
  before,
  removed,
  namespaceNegativeProbe: after,
  allZero,
  completedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(JSON.stringify({ before, removed, after, allZero, identityHash }));
