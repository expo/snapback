#!/usr/bin/env node

// Single source of truth for the generated backends and committed projection
// roots reproduced by scripts/check-generated-artifacts. Publication may
// consult this registry, but must freeze its allowed leaf set at the
// qualification commit rather than trusting a later manifest or directory
// prefix.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODEGEN_JOBS = Object.freeze([
  { backend: 'demos/todo/snapback' },
  { backend: 'demos/todo-v2/snapback' },
  { backend: 'demos/todo-v2/snapback', targetProfile: 'remote-service-sqlite-ibex' },
  { backend: 'demos/latency-kanban/snapback' },
  { backend: 'demos/messaging-snapback/snapback' },
  { backend: 'demos/triage-graph/snapback' },
  { backend: 'demos/fleet-observatory-move1/snapback' },
  { backend: 'demos/zero-bakeoff/apps/contention-calendar/snapback' },
  { backend: 'demos/all-aboard/snapback', outboundActions: true },
  { backend: 'demos/all-aboard/tests/egress-probe', outboundActions: true },
  { backend: 'demos/competitive-checkpoint/snapback', outboundActions: true },
  { backend: 'demos/campfire/snapback' },
  { backend: 'demos/chirp/snapback' },
  { backend: 'demos/knockoff/snapback' },
  { backend: 'demos/cursors-web/snapback' },
  { backend: 'demos/graffiti/snapback' },
  { backend: 'demos/card-game/snapback' },
  { backend: 'demos/pointing-room/snapback' },
  { backend: 'demos/rbac/snapback' },
  { backend: 'demos/shindig/snapback' },
  { backend: 'demos/partiful-matrix/snapback' },
  { backend: 'demos/signal-desk/snapback' },
  { backend: 'demos/catalog-lens/snapback' },
  { backend: 'demos/dispatch-board/snapback' },
  { backend: 'demos/pulse-monitor/snapback' },
  { backend: 'demos/public-dashboard/snapback' },
  { backend: 'demos/browser-local-first/snapback' },
  { backend: 'demos/browser-local-first/snapback-sessions' },
  { backend: 'demos/access-desk/snapback' },
  { backend: 'demos/team-chat/snapback' },
  { backend: 'demos/party-wall/snapback' },
  { backend: 'demos/file-drop/snapback' },
  { backend: 'packages/snapback-cli/fixtures/comparator/app/snapback' },
  { backend: 'packages/snapback-react/fixtures/conversation/app/snapback' },
  {
    backend: 'packages/snapback-cli/fixtures/push-seam/app/snapback',
    outboundActions: true,
  },
]);

export const REVIEW_CACHE_ROOTS = Object.freeze([
  'demos/todo/snapback/generated',
  'demos/todo-v2/snapback/generated',
  'demos/todo-v2/snapback/generated-remote-service',
  'demos/latency-kanban/snapback/generated',
  'demos/messaging-snapback/snapback/generated',
  'demos/triage-graph/snapback/generated',
  'demos/fleet-observatory-move1/snapback/generated',
  'demos/all-aboard/snapback/generated',
  'demos/all-aboard/tests/egress-probe/generated',
  'demos/competitive-checkpoint/snapback/generated',
  'demos/campfire/snapback/generated',
  'demos/chirp/snapback/generated',
  'demos/knockoff/snapback/generated',
  'demos/cursors-web/snapback/generated',
  'demos/graffiti/snapback/generated',
  'demos/card-game/snapback/generated',
  'demos/pointing-room/snapback/generated',
  'demos/rbac/snapback/generated',
  'demos/shindig/snapback/generated',
  'demos/partiful-matrix/snapback/generated',
  'demos/signal-desk/snapback/generated',
  'demos/catalog-lens/snapback/generated',
  'demos/dispatch-board/snapback/generated',
  'demos/pulse-monitor/snapback/generated',
  'demos/public-dashboard/snapback/generated',
  'demos/browser-local-first/snapback/generated',
  'demos/browser-local-first/snapback-sessions/generated',
  'demos/access-desk/snapback/generated',
  'demos/party-wall/snapback/generated',
  'demos/file-drop/snapback/generated',
]);

export const FULLY_COMMITTED_ROOTS = Object.freeze([
  'demos/zero-bakeoff/apps/contention-calendar/snapback/generated',
  'demos/team-chat/snapback/generated',
  'packages/snapback-cli/fixtures/comparator/app/snapback/generated',
  'packages/snapback-react/fixtures/conversation/app/snapback/generated',
  'packages/snapback-cli/fixtures/push-seam/app/snapback/generated',
]);

export const ADMIN_GENERATED_ROOTS = Object.freeze(['admin-ui/generated']);

const FULLY_COMMITTED_ROOT_SET = new Set(FULLY_COMMITTED_ROOTS);
const CONTENT_ADDRESSED_APP_LEAF =
  /^(?:app\.binding\.[0-9a-f]{64}\.mjs|app\.descriptor\.[0-9a-f]{64}\.json)$/u;

// @ref LLP 0189#consequences — the filename hash is regenerated identity, not
// the publication-inventory claim; root membership and leaf kind remain exact.
export function isContentAddressedFullyCommittedLeaf(path) {
  const separator = path.lastIndexOf('/');
  return separator !== -1
    && FULLY_COMMITTED_ROOT_SET.has(path.slice(0, separator))
    && CONTENT_ADDRESSED_APP_LEAF.test(path.slice(separator + 1));
}

export function codegenOutputRoot(job) {
  const output = job.targetProfile === 'remote-service-sqlite-ibex'
    ? 'generated-remote-service'
    : 'generated';
  return `${job.backend}/${output}`;
}

function assertCompleteRegistry() {
  const jobs = CODEGEN_JOBS.map(codegenOutputRoot).sort();
  const policies = [...REVIEW_CACHE_ROOTS, ...FULLY_COMMITTED_ROOTS].sort();
  if (new Set(jobs).size !== jobs.length
      || new Set(policies).size !== policies.length
      || JSON.stringify(jobs) !== JSON.stringify(policies)) {
    throw new Error('generated-artifact policy must cover every codegen job exactly once');
  }
}

assertCompleteRegistry();

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const command = process.argv[2];
  let lines;
  if (command === 'jobs') {
    lines = CODEGEN_JOBS.map((job) => [
      job.outboundActions ? '1' : '0',
      job.targetProfile ?? '-',
      job.backend,
    ].join('\t'));
  } else if (command === 'review-cache-roots') {
    lines = REVIEW_CACHE_ROOTS;
  } else if (command === 'fully-committed-roots') {
    lines = FULLY_COMMITTED_ROOTS;
  } else if (command === 'admin-generated-roots') {
    lines = ADMIN_GENERATED_ROOTS;
  } else {
    process.stderr.write(
      'usage: generated-artifact-policy.mjs jobs|review-cache-roots|fully-committed-roots|admin-generated-roots\n',
    );
    process.exit(2);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}
