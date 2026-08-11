import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineTable, owner, v } from './define.mjs';
import { formatCodegenSummary } from './codegen-summary.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function fixture(schema, functions = 'export const nothing = 0;\n') {
  const root = mkdtempSync(join(tmpdir(), 'snapback-table-visibility-'));
  roots.push(root);
  const app = join(root, 'fixture');
  const backend = join(app, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(app, 'demo.snapback.json'), JSON.stringify({ id: 'table-visibility-fixture' }));
  writeFileSync(join(backend, 'schema.mjs'), schema);
  writeFileSync(join(backend, 'functions.mjs'), functions);
  return backend;
}

async function refusal(schema, code) {
  const result = await generate(fixture(schema));
  assert.equal(result.ok, false, `expected ${code}: ${JSON.stringify(result.diagnostics)}`);
  assert(
    result.diagnostics.some((diagnostic) => diagnostic.code === code),
    `missing ${code}: ${JSON.stringify(result.diagnostics)}`,
  );
}

assert.throws(
  () => defineTable({ ownerId: v.string() }).visibility({ kind: 'private' }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID',
);
assert.deepEqual(
  defineTable({ ownerId: v.string() }).visibility(owner('ownerId')).visibilityDeclaration,
  { kind: 'owner', field: 'ownerId' },
  'the shipped owner(field) helper is accepted by table visibility',
);
assert.throws(
  () => defineTable({ ownerId: v.string() }).visibility({ kind: 'owner' }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_INVALID',
);
assert.throws(
  () => defineTable({ roomId: v.string() }).visibility({
    kind: 'membership',
    declaration: 'room-members',
    resourceField: 'roomId',
    roles: [],
  }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID',
);
assert.throws(
  () => defineTable({ roomId: v.string() }).visibility({
    kind: 'membership',
    resourceField: 'roomId',
  }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_INVALID',
);

try {
  const validSchema = `
import { defineSchema, defineTable, owner, v } from '${defineUrl}';
const roomMembers = defineTable({
  userId: v.principal(),
  roomId: v.id('rooms'),
  role: v.string(),
})
  .membership({
    id: 'roomMembers',
    principal: 'userId',
    resource: 'roomId',
    role: 'role',
    roles: ['member', 'moderator'],
  })
  .visibility({ kind: 'public-read' });
export default defineSchema({
  announcements: defineTable({ body: v.string() })
    .visibility({ kind: 'public-read' })
    .assetSharing({ kind: 'public-read' }),
  privateNotes: defineTable({ ownerId: v.principal(), body: v.string() })
    .visibility(owner('ownerId')),
  rooms: defineTable({ title: v.string() })
    .visibility({ kind: 'public-read' }),
  roomMembers,
  messages: defineTable({ roomId: v.id('rooms'), body: v.string() })
    .visibility({
      kind: 'membership',
      declaration: roomMembers,
      resourceField: 'roomId',
      roles: ['member'],
    }),
});
`;
  const valid = await generate(fixture(validSchema));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));
  const manifest = JSON.parse(
    readFileSync(join(valid.outDir, 'schema.manifest.json'), 'utf8'),
  );
  const tables = Object.fromEntries(manifest.tables.map((table) => [table.name, table]));
  assert.deepEqual(tables.announcements.visibility, { kind: 'public-read' });
  assert.deepEqual(tables.announcements.assetSharing, { kind: 'public-read' });
  assert.deepEqual(tables.privateNotes.visibility, { kind: 'owner', field: 'ownerId' });
  assert.deepEqual(tables.messages.visibility, {
    kind: 'membership',
    declaration: 'roomMembers',
    resourceField: 'roomId',
    roles: ['member'],
  });
  assert.equal(
    valid.diagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT'),
    false,
  );
  assert.deepEqual(valid.summary.tableVisibility, {
    declared: [
      { table: 'announcements', kind: 'public-read' },
      { table: 'messages', kind: 'membership' },
      { table: 'privateNotes', kind: 'owner' },
      { table: 'roomMembers', kind: 'public-read' },
      { table: 'rooms', kind: 'public-read' },
    ],
    implicit: [],
    counts: {
      total: 5,
      declared: 5,
      implicit: 0,
      publicRead: 3,
      owner: 1,
      membership: 1,
    },
  });

  const omitted = await generate(fixture(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  publicPosts: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
  drafts: defineTable({ body: v.string() }),
});
`));
  assert.equal(omitted.ok, true, JSON.stringify(omitted.diagnostics));
  const warning = omitted.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT',
  );
  assert.ok(warning, 'undeclared table emits the warn-phase diagnostic');
  assert.equal(warning.table, 'drafts');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.subsystem, 'auth');
  assert.equal(warning.sourceSpan.file, 'schema.mjs');
  assert(warning.sourceSpan.line > 0);
  assert.match(warning.message, /drafts.*\.visibility\(\{ kind: 'public-read' \}\)/u);
  assert.match(warning.message, /guide\/auth\/protecting-data\.md#declare-who-can-read-each-table/u);
  assert.deepEqual(
    warning.details.remediations.map(({ kind, visibilityKind }) => [kind, visibilityKind]),
    [
      ['setTableVisibility', 'public-read'],
      ['setTableVisibility', 'owner'],
      ['setTableVisibility', 'membership'],
      ['guidePointer', undefined],
    ],
  );
  assert(warning.details.remediations.every((remediation) => (
    remediation.riskClass === 'policy'
    && remediation.machineApplicable === false
    && remediation.requiresApproval === true
    && remediation.precondition.table === 'drafts'
    && remediation.precondition.authoredVisibility === 'omitted'
  )));
  assert.deepEqual(omitted.summary.tableVisibility, {
    declared: [{ table: 'publicPosts', kind: 'public-read' }],
    implicit: ['drafts'],
    counts: {
      total: 2,
      declared: 1,
      implicit: 1,
      publicRead: 1,
      owner: 0,
      membership: 0,
    },
  });
  const artifacts = JSON.parse(readFileSync(join(omitted.outDir, 'artifacts.json'), 'utf8'));
  assert.deepEqual(artifacts.summary.tableVisibility, omitted.summary.tableVisibility);
  assert.match(formatCodegenSummary(omitted.summary), /table visibility 1 declared; 1 implicit/u);
  assert.match(formatCodegenSummary(omitted.summary), /drafts: add \.visibility/u);

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  drafts: defineTable({ ownerId: v.string() }).visibility({ kind: 'private' }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  drafts: defineTable({ ownerId: v.string() }).visibility({ kind: 'owner', field: 'missing' }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  messages: defineTable({ roomId: v.string() }).visibility({
    kind: 'membership', declaration: 'missing-members', resourceField: 'roomId', roles: ['member'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
const members = defineTable({ userId: v.principal(), roomId: v.id('rooms'), role: v.string() })
  .membership({ id: 'roomMembers', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'] });
export default defineSchema({
  rooms: defineTable({ title: v.string() }),
  members,
  messages: defineTable({ roomId: v.id('rooms') }).visibility({
    kind: 'membership', declaration: members, resourceField: 'missingRoom', roles: ['member'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
const members = defineTable({ userId: v.principal(), roomId: v.id('rooms'), role: v.string() })
  .membership({ id: 'roomMembers', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'] });
export default defineSchema({
  rooms: defineTable({ title: v.string() }),
  members,
  messages: defineTable({ roomId: v.id('rooms') }).visibility({
    kind: 'membership', declaration: members, resourceField: 'roomId', roles: ['admin'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('table visibility authoring: valid union, strict refusals, warn phase, and summary verified');
