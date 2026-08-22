import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import { canonicalJson } from './result-contracts.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];

const reviewedGenerationConsumerFileAllowlist = [
  'crates/snapback-kernel/src/membership_rules.rs',
  'crates/snapback-engine/src/runtime/host_glue.rs',
  'crates/snapback-kernel/src/storage/membership_plans.rs',
  'crates/snapback-kernel/src/storage/auth_agents.rs',
  'crates/snapback-kernel/src/storage.rs',
];

// Swept receiver binding list across the five reviewed files: membership data
// is bound as `membership` or `declaration`, and profile data as `profile`.
// `manifest` is the reviewer-demonstrated typed alias; scoped binding proof
// keeps unrelated schema and ledger manifests outside this authority scan.
const reviewedGenerationConsumerReceiverRoots = new Map([
  ['membership', 'membership'],
  ['declaration', 'membership'],
  ['manifest', 'membership'],
  ['profile', 'profile'],
]);
const scopedGenerationConsumerReceiverRoots = new Set(['declaration', 'manifest']);

const rustCodeOnly = (source) => source
  .replace(/r(#+)"[\s\S]*?"\1/gu, ' ')
  .replace(/r"[^"\n]*"/gu, ' ')
  .replace(/b?"(?:\\.|[^"\\])*"/gsu, ' ')
  .replace(/'(?:\\.|[^'\\])'/gu, ' ')
  .replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .replace(/\/\/.*$/gmu, ' ');

const rustFieldToJson = (field) => field.replace(/_([a-z])/gu, (_match, letter) => letter.toUpperCase());

const rustBraceRanges = (code) => {
  const stack = [];
  const ranges = [];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === '{') stack.push(index);
    if (code[index] === '}') {
      const start = stack.pop();
      if (start !== undefined) ranges.push({ start, end: index });
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
};

const generationConsumerBindingRanges = (code) => {
  const braceRanges = rustBraceRanges(code);
  const bindings = [];
  const receiverPattern = [...reviewedGenerationConsumerReceiverRoots.keys()].join('|');
  const typedBindingPattern = new RegExp(
    `\\b(${receiverPattern})\\s*:\\s*&\\s*(?:'[a-z_][a-z0-9_]*\\s+)?(?:mut\\s+)?(?:crate\\s*::\\s*manifest\\s*::\\s*)?(MembershipManifest|AuthorityProfileV1)\\b`,
    'gu',
  );
  for (const match of code.matchAll(typedBindingPattern)) {
    const body = braceRanges.find(({ start }) => start > match.index);
    if (body === undefined) continue;
    bindings.push({
      root: match[1],
      kind: match[2] === 'MembershipManifest' ? 'membership' : 'profile',
      start: body.start,
      end: body.end,
    });
  }

  const declarationAliasPattern = /\blet\s+Some\s*\(\s*\(\s*[a-z_][a-z0-9_]*\s*,\s*(declaration)\s*\)\s*\)\s*=\s*(?:(?:[a-z_][a-z0-9_]*\s*::\s*)*)find_declaration\s*\(/gu;
  for (const match of code.matchAll(declarationAliasPattern)) {
    const scope = braceRanges
      .filter(({ start, end }) => start < match.index && match.index < end)
      .at(-1);
    if (scope === undefined) continue;
    bindings.push({ root: match[1], kind: 'membership', start: match.index, end: scope.end });
  }
  return bindings;
};

const generationConsumerKindForAccess = (bindings, root, index) => {
  if (!scopedGenerationConsumerReceiverRoots.has(root)) {
    return reviewedGenerationConsumerReceiverRoots.get(root) ?? null;
  }
  const binding = bindings
    .filter((candidate) => candidate.root === root && candidate.start <= index && index <= candidate.end)
    .sort((left, right) => right.start - left.start)[0];
  return binding?.kind ?? null;
};

const scanGenerationConsumerAccesses = (source) => {
  const code = rustCodeOnly(source);
  const accesses = new Set();
  const bindings = generationConsumerBindingRanges(code);
  const receiverPattern = [...reviewedGenerationConsumerReceiverRoots.keys()].join('|');
  const accessPattern = new RegExp(
    `\\b(${receiverPattern})((?:\\s*\\.\\s*[a-z_][a-z0-9_]*)+)`,
    'gu',
  );
  for (const match of code.matchAll(accessPattern)) {
    const root = match[1];
    const fields = [...match[2].matchAll(/\.\s*([a-z_][a-z0-9_]*)/gu)]
      .map((fieldMatch) => fieldMatch[1]);
    const lastSegmentIsMethod = /^\s*\(/u.test(code.slice(match.index + match[0].length));
    const [field] = fields;
    const consumerKind = generationConsumerKindForAccess(bindings, root, match.index);
    if (consumerKind === null) continue;
    if (consumerKind === 'membership') {
      if (lastSegmentIsMethod && fields.length === 1 && field === 'effective_id') {
        accesses.add('membership.id');
      } else if (lastSegmentIsMethod && fields.length === 1 && field === 'vocabulary') {
        accesses.add('membership.roles');
        accesses.add('membership.pending_roles');
      } else if (fields.length > 1 || !lastSegmentIsMethod) {
        accesses.add(`membership.${field}`);
      }
      continue;
    }
    const profileFields = lastSegmentIsMethod ? fields.slice(0, -1) : fields;
    if (profileFields.length > 0) {
      accesses.add(`profile.${profileFields.map(rustFieldToJson).join('.')}`);
    }
  }
  // `TableManifest::field_affects_authorization` implements membership-table
  // narrowing through MembershipManifest::incidental. Keep this accessor
  // idiom visible even though the call site does not spell `membership`.
  if (/\btable\s*\.\s*field_affects_authorization\s*\(/u.test(code)) {
    accesses.add('membership.incidental');
  }
  return accesses;
};

const scanReviewedGenerationConsumerFiles = (sourceOverrides = new Map()) => {
  const accesses = new Set();
  for (const file of reviewedGenerationConsumerFileAllowlist) {
    const source = sourceOverrides.get(file) ?? readFileSync(join(repoRoot, file), 'utf8');
    for (const access of scanGenerationConsumerAccesses(source)) accesses.add(access);
  }
  return accesses;
};

const canonicalObjectPaths = (value, prefix = '', paths = new Set()) => {
  if (value === null || typeof value !== 'object') return paths;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    paths.add(path);
    if (Array.isArray(child)) {
      for (const entry of child) canonicalObjectPaths(entry, path, paths);
    } else {
      canonicalObjectPaths(child, path, paths);
    }
  }
  return paths;
};

const generationHashBindingsForMembershipAccess = new Map([
  ['membership.id', ['transitionPreconditions.membershipDeclarationId']],
  ['membership.scope', ['scopeRelation']],
  ['membership.principal', ['scopeRelation.principalKey']],
  ['membership.resource', ['scopeRelation.resourceField']],
  ['membership.resource_table', ['scopeRelation.resourceTable']],
  ['membership.role', ['requiredIndexes']],
  ['membership.roles', ['roleLattice']],
  ['membership.pending_roles', ['statusPredicates.invited']],
  ['membership.bootstrap_role', ['ownerBootstrapInvariant.bootstrapRole']],
  ['membership.last_holder', ['ownerBootstrapInvariant.protectedLastHolderRole']],
  ['membership.transitions', ['transitionPreconditions.matrix']],
  ['membership.expiry', ['transitionPreconditions.expiryPresent']],
  ['membership.principal_addressed_writes', ['transitionPreconditions.principalAddressedWritesRemove']],
  ['membership.provenance', ['transitionPreconditions.provenance']],
  ['membership.incidental', ['authorizationEventFields']],
]);

const uncoveredGenerationConsumerAccesses = (accesses, generationPreimage) => {
  const hashedPaths = canonicalObjectPaths(generationPreimage);
  return [...accesses].sort().filter((access) => {
    // `generation` is the digest produced from the preimage, not an input that
    // can be included in its own preimage.
    if (access === 'profile.generation') return false;
    // Optional profile members are still generation-bound: canonical-object
    // hashing distinguishes the member's presence from its absence. The
    // baseline profile deliberately omits `projection`, while projected
    // profiles carry its complete closed value in the same preimage.
    if (access === 'profile.projection') return false;
    const boundPaths = access.startsWith('profile.')
      ? [access.slice('profile.'.length)]
      : generationHashBindingsForMembershipAccess.get(access);
    return boundPaths === undefined || boundPaths.some((path) => !hashedPaths.has(path));
  });
};

const assertGenerationConsumerAccessesCovered = (accesses, generationPreimage) => assert.deepEqual(
  uncoveredGenerationConsumerAccesses(accesses, generationPreimage),
  [],
  'a runtime authority consumer reads a field outside the generation hash — embed it before landing.',
);

const membershipValidationParity = JSON.parse(readFileSync(
  join(repoRoot, 'tests/fixtures/membership-validation-parity-v0.json'),
  'utf8',
));

// The success case remains a literal source fixture so the guide can verify
// its author-facing excerpt byte-for-byte. The schemaSource factory below is
// reserved for adversarial variants.
const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: [],
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  organizations: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const schemaSource = ({
  appScope = false,
  bootstrapRole = null,
  extraField = '',
  expiryType = null,
  idTarget = 'events',
  indexName = null,
  lastHolderProtect = null,
  roles = ['host', 'guest'],
  transitions = [],
} = {}) => `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('${idTarget}'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
  ${extraField}
  ${expiryType === null ? '' : `expiresAt: v.optional(v.${expiryType}()),`}
})${indexName === null ? '' : `.index(${JSON.stringify(indexName)}, ['userId'])`}.membership({
  id: 'eventMembers',
  principal: 'userId',
  ${appScope ? '' : "resource: 'eventId',"}
  role: 'role',
  roles: ${JSON.stringify(roles)},
  pendingRoles: ['invited'],
  ${bootstrapRole === null ? '' : `bootstrapRole: ${JSON.stringify(bootstrapRole)},`}
  ${lastHolderProtect === null ? '' : `lastHolder: { protect: ${JSON.stringify(lastHolderProtect)} },`}
  ${expiryType === null ? '' : "expiry: { field: 'expiresAt', onExpiry: 'remove' },"}
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: ${JSON.stringify(transitions)},
  scope: '${appScope ? 'app' : 'resource'}',
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  organizations: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const parityTransition = ({ kind, value }) => {
  if (kind === 'roleCallerTargetsSelf') {
    if (value === 'insert') return { op: value, by: ['host'], target: 'self', to: ['guest'] };
    if (value === 'setRole') {
      return { op: value, by: ['host'], target: 'self', from: ['guest'], to: ['host'] };
    }
    if (value === 'remove') return { op: value, by: ['host'], target: 'self', from: ['guest'] };
    return { op: value, by: ['host'], target: 'self', fields: ['joinedAt'] };
  }
  if (kind === 'selfCallerTargetsOther') {
    if (value === 'setRole') {
      return { op: value, by: ['self'], target: 'other', from: ['guest'], to: ['host'] };
    }
    if (value === 'remove') return { op: value, by: ['self'], target: 'other', from: ['guest'] };
    return { op: value, by: ['self'], target: 'other', fields: ['joinedAt'] };
  }
  if (kind === 'patchAxis') {
    return { op: 'patch', by: ['self'], target: 'self', fields: [value] };
  }
  return null;
};

const paritySchemaSource = (testCase) => schemaSource({
  ...(testCase.kind === 'reservedProvenance'
    ? { extraField: `${testCase.value}: v.string(),` }
    : {}),
  ...(testCase.kind === 'generatedIndexCollision'
    ? { indexName: testCase.value }
    : {}),
  ...(['roleCallerTargetsSelf', 'selfCallerTargetsOther', 'patchAxis'].includes(testCase.kind)
    ? { transitions: [parityTransition(testCase)] }
    : {}),
});

const generatedSymbolCollisionSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembersSnake = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'event_members',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['member'],
}).visibility({ kind: 'owner', field: 'userId' });

const eventMembersCamel = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['member'],
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  eventMembersSnake,
  eventMembersCamel,
}, { auth: { mode: 'sessions' } });
`;

const axisOnlyMembershipSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const functions = ({ mismatchedArg = false, mismatchedRow = false } = {}) => `
import { eventMembers } from './schema.mjs';
import {
  defineLiveQuery,
  defineMutation,
  insert,
  lit,
  membershipResource,
  v,
} from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'authenticated',
  table: 'events',
  args: { eventId: v.id('${mismatchedArg ? 'organizations' : 'events'}') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'host')],
});

export const visibleNotes = defineLiveQuery({
  auth: 'authenticated',
  table: 'eventNotes',
  args: {},
  membership: [eventMembers.memberOf(membershipResource.rowField('${mismatchedRow ? 'body' : 'eventId'}'))],
});

export const createEvent = defineMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { title: v.string() },
  plan: insert('events', { title: lit('created') }),
});
`;

async function run(inputFunctions = functions(), inputSchema = schema, generateOptions = undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-rbac-authoring-'));
  dirs.push(dir);
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(dirname(fileURLToPath(import.meta.url)), join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(dir, 'schema.mjs'), inputSchema);
  writeFileSync(join(dir, 'functions.mjs'), inputFunctions);
  writeFileSync(join(dir, 'bootstrap-handler.mjs'), `
globalThis.__snapbackHandlers = {
  async bootstrapEvent(ctx, args) {
    return await ctx.membership.eventMembers.bootstrap({ title: args.title });
  },
};
`);
  mkdirSync(join(dir, 'generated'));
  const result = await generate(dir, generateOptions);
  return { dir, result };
}

async function runFamiliarAuthorityProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-rbac-familiar-authority-'));
  dirs.push(dir);
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(dirname(fileURLToPath(import.meta.url)), join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(dir, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }));
  writeFileSync(join(dir, 'schema.ts'), `
import { defineSchema, defineTable, v } from './generated/server';

export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  principalId: v.principal(),
  role: v.string(),
  displayName: v.optional(v.string()),
}).membership({
  id: 'roomAccess',
  principal: 'principalId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member', 'invited'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['admin', 'member', 'invited'] },
  ],
}).authorityProfile({
  name: 'roomAccess',
  hierarchy: { owner: ['admin', 'member'], admin: ['member'], member: [] },
  roster: { visible: ['principalId', 'role', 'displayName'] },
}).visibility({ kind: 'owner', field: 'principalId' });

export default defineSchema({
  rooms: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  roomMembers,
  messages: defineTable({ roomId: v.id('rooms'), body: v.string() })
    .visibility({ kind: 'membership', declaration: 'roomAccess', resourceField: 'roomId', roles: ['member'] }),
}, { auth: { mode: 'sessions' } });
`);
  const authoredFunctions = `
import { membershipResource, mutation, query, v } from './generated/server';
import { roomMembers } from './schema';

export const summary = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['messages'],
  membership: [roomMembers.hasRole(membershipResource.arg('roomId'), 'member')],
  handler: async (ctx, args) => ctx.db.query('messages').withIndex('_id').take(20).collect(),
});

export const send = mutation({
  args: { roomId: v.id('rooms'), body: v.string() },
  returns: v.id('messages'),
  auth: 'authenticated',
  reads: [],
  writes: ['messages'],
  membership: [roomMembers.hasRole(membershipResource.arg('roomId'), 'member')],
  handler: async (ctx, args) => ctx.db.insert('messages', args),
});
`;
  writeFileSync(join(dir, 'rooms.ts'), authoredFunctions);
  mkdirSync(join(dir, 'generated'));
  const result = await generate(dir);
  return { authoredFunctions, dir, result };
}

const authorityTransitions = [
  { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
  { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
  { op: 'remove', by: ['self'], target: 'self', from: ['admin', 'member', 'invited'] },
  { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
  { op: 'remove', by: ['owner'], target: 'other', from: ['admin', 'member', 'invited'] },
];

const authorityProfileSchema = ({
  bootstrapRole = 'owner',
  consumerVisibility = true,
  deliveryVisibility = "{ kind: 'owner', field: 'senderId' }",
  duplicateProfile = false,
  expiryField = false,
  expiryPresent = false,
  hierarchy = "{ owner: ['admin', 'member'], admin: ['member'], member: [] }",
  indexName = null,
  lastHolderProtect = 'owner',
  legacyAuthority = false,
  membershipId = 'eventMembers',
  membershipSearch = null,
  membershipMutation = '',
  omitMembershipId = false,
  pendingRoles = ['invited'],
  principalAddressedWritesRemove = null,
  principalValidator = 'v.principal()',
  profileBeforeMembership = false,
  profileExtra = '',
  profileName = 'eventMembers',
  projection = null,
  provenance = 'full',
  resourceValidator = "v.id('events')",
  roleField = 'role',
  roles = ['owner', 'admin', 'member'],
  roster = "{ visible: ['userId', 'role', 'displayName'] }",
  transitions = authorityTransitions,
  unsupportedComposition = null,
} = {}) => {
  const profile = `.authorityProfile({
    name: ${JSON.stringify(profileName)},
    hierarchy: ${hierarchy},
    roster: ${roster},
    ${projection === null ? '' : `projection: ${projection},`}
    ${profileExtra}
  })`;
  const membership = `.membership({
    ${omitMembershipId ? '' : `id: ${JSON.stringify(membershipId)},`}
    principal: 'userId',
    resource: 'eventId',
    role: ${JSON.stringify(roleField)},
    roles: ${JSON.stringify(roles)},
    pendingRoles: ${JSON.stringify(pendingRoles)},
    bootstrapRole: ${JSON.stringify(bootstrapRole)},
    lastHolder: { protect: ${JSON.stringify(lastHolderProtect)} },
    ${expiryPresent ? "expiry: { field: 'expiresAt', onExpiry: 'remove' }," : ''}
    provenance: ${JSON.stringify(provenance)},
    ${principalAddressedWritesRemove === null
      ? ''
      : `principalAddressedWrites: { remove: ${JSON.stringify(principalAddressedWritesRemove)} },`}
    transitions: ${JSON.stringify(transitions)},
  })`;
  const searchIndex = unsupportedComposition === 'search'
    ? `.searchIndex('search_notes', {
        semanticVersion: 'authority-profile-refusal.v1',
        textFields: { body: { weight: 1, classification: 'private' } },
        fieldClassifications: { eventId: 'private' },
        storedFields: ['body'],
        visibility: {
          kind: 'membership',
          declaration: 'eventMembers',
          resourceField: 'eventId',
          roles: ['member'],
        },
      })`
    : '';
  const membershipSearchIndex = membershipSearch === null
    ? ''
    : `.searchIndex('search_members', {
        semanticVersion: 'authority-profile-membership-table-search.v1',
        textFields: {
          ${membershipSearch === 'visible' ? 'role' : 'displayName'}: {
            weight: 1,
            classification: 'private',
          },
        },
        fieldClassifications: { eventId: 'private' },
        storedFields: [${JSON.stringify(membershipSearch === 'visible' ? 'role' : 'displayName')}],
        highlightFields: [${JSON.stringify(membershipSearch === 'visible' ? 'role' : 'displayName')}],
        visibility: {
          kind: 'membership',
          declaration: 'eventMembers',
          resourceField: 'eventId',
          roles: ['member'],
        },
      })`;
  const visibility = unsupportedComposition === 'search'
    ? `.visibility({ kind: 'public-read' })`
    : !consumerVisibility
      ? `.visibility({ kind: 'public-read' })`
    : `.visibility({
        kind: 'membership',
        declaration: 'eventMembers',
        resourceField: 'eventId',
        roles: ['member'],
      })`;
  const assetSharing = unsupportedComposition === 'asset'
    ? `.assetSharing({ kind: 'membership', membership: 'eventMembers', roles: ['member'] })`
    : '';
  return `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembersBase = defineTable({
  eventId: ${resourceValidator},
  userId: ${principalValidator},
  ${roleField}: v.string(),
  displayName: v.optional(v.string()),
  ${expiryField || expiryPresent ? 'expiresAt: v.optional(v.integer()),' : ''}
})${indexName === null ? '' : `.index(${JSON.stringify(indexName)}, ['userId'])`};

export const eventMembers = eventMembersBase${profileBeforeMembership ? `${profile}${membership}` : `${membership}${profile}`}${membershipSearchIndex}
  .visibility({ kind: 'owner', field: 'userId' });
${duplicateProfile ? `eventMembers${profile};` : ''}
${legacyAuthority ? 'eventMembers.permissionBackingDeclared = true;' : ''}
${membershipMutation}

export const eventNotes = defineTable({ eventId: v.id('events'), body: v.string() })
  ${searchIndex}${visibility}${assetSharing};

export const eventDeliveries = defineTable({
  eventId: v.id('events'),
  senderId: v.principal(),
  body: v.string(),
  recipientIds: v.array(v.principal(), { maxItems: 1024 }),
}).visibility(${deliveryVisibility});

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
  eventNotes,
  eventDeliveries,
}, { auth: { mode: 'sessions' } });
`;
};

const authorityProfileFunctions = `
import { eventMembers } from './schema.mjs';
import {
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  membershipResource,
  v,
} from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'authenticated',
  table: 'events',
  args: { eventId: v.id('events') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'member')],
});

export const visibleNotes = defineLiveQuery({
  auth: 'authenticated',
  table: 'eventNotes',
  args: {},
});

export const writeMembers = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string() },
  writes: ['eventMembers'],
  handler: async (ctx, args) => ctx.membership.eventMembers.bootstrap({ title: args.title }),
});

export const memberSummary = defineJsLiveQuery({
  auth: 'authenticated',
  args: { eventId: v.id('events') },
  reads: ['eventNotes'],
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'member')],
  handler: async () => [],
});

export const addNote = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), body: v.string() },
  reads: [],
  writes: ['eventNotes'],
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'member')],
  handler: async (ctx, args) => ctx.db.insert('eventNotes', args),
});

export const sendDelivery = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), body: v.string() },
  reads: ['eventMembers', 'eventDeliveries'],
  writes: ['eventDeliveries'],
  handler: async (ctx, args) => {
    const rowId = await ctx.db.insert('eventDeliveries', {
      eventId: args.eventId,
      body: args.body,
      recipientIds: [],
    });
    await ctx.authority.eventMembers.snapshotRecipients(args.eventId, rowId);
    return null;
  },
});
`;

const authorityOutcomeFixtures = (name) => [
  ...(name === 'changeRole' ? [{
    branch: 'already-at-requested-role',
    outcome: 'idempotent-success-unchanged',
  }, {
    branch: 'absent-target',
    outcome: 'typed-precondition-refusal',
  }] : []),
  ...(name === 'remove' ? [{
    branch: 'absent-target',
    outcome: 'idempotent-success-unchanged',
  }] : []),
  ...(['invite', 'transferOwner'].includes(name) ? [{
    branch: name === 'invite' ? 'already-active-member' : 'already-current-owner',
    outcome: 'typed-precondition-refusal',
  }] : []),
  {
    branch: 'hidden-target-or-scope',
    outcome: 'non-enumerating-denial',
  },
];

const authorityProfileSearchFunctions = `
import { defineSearchQuery } from '${defineUrl}';
import { eventNotes } from './schema.mjs';

export const searchEventNotes = defineSearchQuery({
  table: eventNotes,
  index: 'search_notes',
  auth: 'authenticated',
  resourceArg: 'eventId',
});
`;

function authorityProfileDiagnostic(result, code, detail = undefined) {
  assert.equal(result.ok, false, `${code} unexpectedly generated`);
  const diagnostic = result.diagnostics.find(({ code: candidate, details }) => (
    candidate === code && (detail === undefined || detail(details))
  ));
  assert(diagnostic, `${code} missing: ${JSON.stringify(result.diagnostics)}`);
  assert.match(diagnostic.message, /\S/u);
  assert.match(diagnostic.details?.repair ?? '', /\S/u, `${code} omitted a repair`);
  assert.match(diagnostic.sourceSpan?.file ?? '', /schema\.mjs$/u, `${code} omitted its authored span`);
  assert(Number.isInteger(diagnostic.sourceSpan?.line) && diagnostic.sourceSpan.line > 0);
  return diagnostic;
}

try {
  {
    const { dir, result } = await run();
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
    const functionsManifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
    const contractManifest = JSON.parse(readFileSync(join(dir, 'generated', 'contract-data.manifest.json'), 'utf8'));
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');

    const members = schemaManifest.tables.find(({ name }) => name === 'eventMembers');
    assert.deepEqual(
      members.fields.map(({ name, field_type: fieldType }) => [name, fieldType]),
      [
        ['eventId', { Id: { table: 'events' } }],
        ['userId', 'Principal'],
        ['role', 'String'],
        ['joinedAt', 'Integer'],
      ],
    );
    assert.equal(members.permissionBacking, undefined, 'membership owns permission backing derivation');
    assert.deepEqual(members.membership, {
      id: 'eventMembers',
      principal: 'userId',
      resource: 'eventId',
      role: 'role',
      roles: ['host', 'guest'],
      pendingRoles: ['invited'],
      bootstrapRole: 'host',
      lastHolder: { protect: 'host' },
      incidental: ['joinedAt'],
      provenance: 'full',
      transitions: [],
      scope: 'resource',
      resourceTable: 'events',
    });

    const eventById = functionsManifest.functions.find(({ name }) => name === 'eventById');
    assert.deepEqual(eventById.readSetSummary.tables, ['events', 'eventMembers']);
    assert.deepEqual(eventById.authorizationDependence, ['userId']);
    assert.deepEqual(eventById.runtime.HostPlan.Query.membershipFilters, [{
      declaration: 'eventMembers',
      resource: { arg: { path: 'eventId', resourceTable: 'events' } },
      roles: ['host'],
    }]);
    const visibleNotes = functionsManifest.functions.find(({ name }) => name === 'visibleNotes');
    assert.deepEqual(visibleNotes.runtime.HostPlan.Query.membershipFilters, [{
      declaration: 'eventMembers',
      resource: { rowField: 'eventId' },
    }]);
    assert.deepEqual(contractManifest.queries.eventById.reads, ['events', 'eventMembers']);
    assert.equal(
      functionsManifest.functions.find(({ name }) => name === 'createEvent').authorityCreating,
      true,
    );
    for (const expected of [
      "export type Principal = string",
      "Id<'events'>",
      "export type EventMembersRole = \"host\" | \"guest\" | \"invited\"",
      'export type EventMembersBootstrap = { title: string }',
      'export interface GeneratedPermissions',
      "eventMembers: { allowsRole(resource: Id<'events'>, role: EventMembersRole, ...roles: EventMembersRole[]): Promise<boolean>; requireRole(resource: Id<'events'>, role: EventMembersRole, ...roles: EventMembersRole[])",
      'export interface GeneratedMembership',
      'export type EventMembersBootstrapMember = { userId: Principal; role: EventMembersRole',
      "eventMembers: { bootstrap(values: EventMembersBootstrap, initialMembers?: readonly EventMembersBootstrapMember[]): Promise<Id<'events'>>",
      'export type GeneratedMutationSettlement = MutationSettlement',
      'export type GeneratedMutationContext<Auth extends GeneratedAuthContext',
    ]) {
      assert(apiTypes.includes(expected), `generated API types omit ${expected}`);
    }
    assert(
      apiTypes.includes('export type GeneratedQueryContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = QueryContext<GeneratedHandlerSchema, Auth, GeneratedPermissions'),
      'query context must expose the read-only database and permissions capabilities',
    );
    assert(
      apiTypes.includes('export type GeneratedMutationContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = MutationContext<GeneratedHandlerSchema, Auth, GeneratedPermissions, GeneratedAssetsContext, GeneratedRuntimeContext, GeneratedMembership'),
      'mutation context must add the write database and sanctioned membership capabilities',
    );
    assert(
      apiTypes.includes('JobsContext, SequenceContext, MutationIdentityContext>'),
      'mutation context must expose the durable settlement identity projection',
    );
    const actionContext = apiTypes.slice(
      apiTypes.indexOf('export type GeneratedActionContext'),
      apiTypes.indexOf('export interface GeneratedFunctionContexts'),
    );
    assert(!actionContext.includes('GeneratedMembership'), 'actions must not receive membership authority');
    assert(!actionContext.includes('GeneratedQueryDatabase'), 'actions must not receive transactional database authority');
    assert(apiTypes.includes('"eventById": GeneratedQueryContext<GeneratedAuthenticatedAuthContext>;'), 'authenticated live queries must use the read-only context with narrowed authority');
    assert(apiTypes.includes('"createEvent": GeneratedMutationContext<GeneratedAuthenticatedAuthContext>;'), 'authenticated mutations must use the membership-capable context with narrowed authority');
    const permissionsSurface = apiTypes.slice(
      apiTypes.indexOf('export interface GeneratedPermissions'),
      apiTypes.indexOf('export type EventMembersRole'),
    );
    assert(permissionsSurface.includes('requireRole('), 'permissions must expose role checks');
    for (const forbidden of ['insert(', 'setRole(', 'remove(', 'patch(']) {
      assert(!permissionsSurface.includes(forbidden), `read-only permissions unexpectedly expose ${forbidden}`);
    }
  }

  {
    const bootstrapFunctions = `
import { defineJsMutation, v } from '${defineUrl}';

export const bootstrapEvent = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: false,
  args: { title: v.string() },
  source: 'bootstrap-handler.mjs',
  exportName: 'bootstrapEvent',
  writes: ['events', 'eventMembers'],
});
`;
    const { dir, result } = await run(bootstrapFunctions);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
    const bootstrapEvent = manifest.functions.find(({ name }) => name === 'bootstrapEvent');
    assert.equal(
      bootstrapEvent.authorityCreating,
      undefined,
      'an explicit bootstrap-only wrapper must not require authority-creating consent',
    );
  }

  {
    const authorityIndependentMembership = `
import { eventMembers } from './schema.mjs';
import { defineLiveQuery, membershipResource, v } from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'public',
  authorityIndependent: true,
  table: 'events',
  args: { eventId: v.id('events') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'host')],
});
`;
    const { result } = await run(authorityIndependentMembership);
    assert.equal(result.ok, false, 'membership-dependent query claimed authority independence');
    assert(
      result.diagnostics.some(({ code }) => code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'),
      `authority-independent membership query omitted its diagnostic: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  for (const [label, inputFunctions] of [
    ['argument', functions({ mismatchedArg: true })],
    ['row field', functions({ mismatchedRow: true })],
  ]) {
    const { result } = await run(inputFunctions);
    assert.equal(result.ok, false, `${label} mismatch unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === 'QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH'),
      `${label} mismatch omitted the nominal resource diagnostic: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  for (const [label, inputSchema, expectedCode] of [
    [
      'app-scoped lastHolder',
      schemaSource({ appScope: true, bootstrapRole: 'host', lastHolderProtect: 'host' }),
      'SCHEMA_MEMBERSHIP_LAST_HOLDER_APP_SCOPE',
    ],
    [
      'app-scoped bootstrapRole',
      schemaSource({ appScope: true, bootstrapRole: 'host' }),
      'SCHEMA_MEMBERSHIP_BOOTSTRAP_APP_SCOPE',
    ],
    [
      'lastHolder/bootstrap mismatch',
      schemaSource({ bootstrapRole: 'guest', lastHolderProtect: 'host' }),
      'SCHEMA_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH',
    ],
    ['reserved self role', schemaSource({ roles: ['self', 'guest'] }), 'SCHEMA_MEMBERSHIP_RESERVED_ROLE'],
    ['reserved none role', schemaSource({ roles: ['none', 'guest'] }), 'SCHEMA_MEMBERSHIP_RESERVED_ROLE'],
    [
      'reserved role separator',
      schemaSource({ roles: ['appRoles:admin', 'guest'] }),
      'SCHEMA_MEMBERSHIP_ROLE_RESERVED_SEPARATOR',
    ],
    ['invalid expiry type', schemaSource({ expiryType: 'string' }), 'SCHEMA_MEMBERSHIP_EXPIRY_FIELD_TYPE'],
    ['unknown id table', schemaSource({ idTarget: 'missingEvents' }), 'SCHEMA_ID_TARGET_UNKNOWN'],
  ]) {
    const { result } = await run('export {};\n', inputSchema);
    assert.equal(result.ok, false, `${label} unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === expectedCode),
      `${label} omitted ${expectedCode}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  // This corpus is consumed by both this authoring test and Rust activation
  // tests. Adding or changing one of the duplicated closed invariants must
  // therefore update one shared fixture instead of two drifting case lists.
  for (const testCase of membershipValidationParity) {
    const { result } = await run('export {};\n', paritySchemaSource(testCase));
    assert.equal(result.ok, false, `${testCase.name} unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === testCase.codegenCode),
      `${testCase.name} omitted ${testCase.codegenCode}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  {
    const { dir, result } = await run('export {};\n', generatedSymbolCollisionSchema);
    assert.equal(result.ok, false, 'colliding generated membership symbols unexpectedly generated');
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === 'SCHEMA_MEMBERSHIP_GENERATED_SYMBOL_COLLISION',
    );
    assert(diagnostic, `generated symbol collision omitted its diagnostic: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(diagnostic.generatedSymbol, 'EventMembersRole');
    assert.deepEqual(diagnostic.declarations, ['event_members', 'eventMembers']);
    assert.deepEqual(diagnostic.tables, ['eventMembersSnake', 'eventMembersCamel']);
    assert.equal(
      existsSync(join(dir, 'generated', 'api.d.ts')),
      false,
      'generated symbol collision must fail closed before writing TypeScript',
    );
  }

  {
    const { dir, result } = await run('export {};\n', axisOnlyMembershipSchema);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      apiTypes.includes('export type EventMembersPatch = Record<string, never>;'),
      'an axis-only membership must emit an actually empty patch input',
    );
    writeFileSync(join(dir, 'consumer.ts'), `
import type { GeneratedMutationContext, Id } from './generated/api';

declare const ctx: GeneratedMutationContext;
declare const memberId: Id<'eventMembers'>;

ctx.membership.eventMembers.patch(memberId, {});
const settlement = ctx.mutation.settlement();
const clientMutationId: string | null = settlement.clientMutationId;
const settlementId: string | null = settlement.settlementId;
void clientMutationId;
void settlementId;
// @ts-expect-error Settlement projections are read-only.
settlement.settlementId = 'replacement';
// @ts-expect-error Membership authorization axes cannot be patched.
ctx.membership.eventMembers.patch(memberId, { role: 'host' });
`);
    execFileSync(join(repoRoot, 'node_modules/.bin/tsc'), [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      'consumer.ts',
    ], { cwd: dir, stdio: 'pipe' });
  }

  // LLP 0240 rollout 2: the authority-profile facade closes hierarchy sugar
  // into the existing membership/table-policy IR and derives both roster
  // reads and transition operations from one generation identity.
  {
    const sourceWithPublicWitness = `${authorityProfileFunctions}
export const publicEvents = defineLiveQuery({
  auth: 'public',
  table: 'events',
  args: {},
});
`;
    const baseline = await run(sourceWithPublicWitness, authorityProfileSchema());
    assert.equal(baseline.result.ok, true, JSON.stringify(baseline.result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(
      join(baseline.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const functionManifest = JSON.parse(readFileSync(
      join(baseline.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const tables = Object.fromEntries(schemaManifest.tables.map((table) => [table.name, table]));
    const profile = tables.eventMembers.authorityProfile;
    assert.equal(profile.version, 1);
    assert.equal(profile.id, 'eventMembers');
    assert.match(profile.generation, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(profile.membership, {
      declaration: 'eventMembers',
      manifestPath: 'tables.eventMembers.membership',
      predicateIdentity: 'snapback.membership-predicate.v1',
    });
    assert.deepEqual(profile.tablePolicy, {
      identity: 'snapback.table-visibility.v1',
      membershipDeclaration: 'eventMembers',
    });
    assert.deepEqual(profile.scopeRelation, {
      table: 'eventMembers',
      resourceField: 'eventId',
      resourceTable: 'events',
      principalKey: 'userId',
    });
    assert.deepEqual(profile.statusPredicates, {
      active: 'membership.roles',
      invited: 'membership.pendingRoles',
    });
    assert.deepEqual(profile.roleLattice, [
      { role: 'owner', implies: ['admin', 'member', 'owner'] },
      { role: 'admin', implies: ['admin', 'member'] },
      { role: 'member', implies: ['member'] },
    ]);
    assert.deepEqual(profile.transitionPreconditions, {
      source: 'membership.transitions',
      membershipDeclarationId: 'eventMembers',
      matrix: [
        { op: 'insert', target: 'other', by: ['owner'], to: ['invited'] },
        {
          op: 'remove',
          target: 'other',
          by: ['owner'],
          from: ['admin', 'invited', 'member'],
        },
        {
          op: 'remove',
          target: 'self',
          by: ['self'],
          from: ['admin', 'invited', 'member'],
        },
        {
          op: 'setRole',
          target: 'other',
          by: ['owner'],
          from: ['admin', 'member'],
          to: ['admin', 'member'],
        },
        {
          op: 'setRole',
          target: 'self',
          by: ['self'],
          from: ['invited'],
          to: ['member'],
        },
      ],
      provenance: 'full',
      expiryPresent: false,
      principalAddressedWritesRemove: null,
      ownerMutation: 'transfer-owner-only',
    });

    const generationPreimage = structuredClone(profile);
    delete generationPreimage.generation;
    assert.equal(
      profile.generation,
      `sha256:${createHash('sha256')
        .update(`snapback:authority-profile:v1\n${canonicalJson(generationPreimage)}`)
        .digest('hex')}`,
      'the canonical generation preimage is the entire emitted profile minus generation',
    );

    // Reviewed generation-consumer file allowlist with access-lint. This scans
    // each reviewer-pinned Rust file whole for direct field idioms rooted at
    // the swept receiver set (plus effective_id, vocabulary, and
    // field_affects_authorization) and checks them against the actual canonical
    // preimage below. It catches direct idioms throughout these enumerated
    // files. Residual: new files, helper indirection, and receiver identifiers
    // outside the scanned root set.
    const reviewedGenerationConsumerAccesses = scanReviewedGenerationConsumerFiles();
    for (const access of [
      'membership.id',
      'membership.pending_roles',
      'membership.expiry',
      'membership.principal_addressed_writes',
      'membership.provenance',
      'membership.incidental',
      'profile.membership.declaration',
      'profile.projection',
      'profile.roster.visibleFields',
      'profile.ownerBootstrapInvariant.role',
      'profile.generation',
    ]) {
      assert.ok(
        reviewedGenerationConsumerAccesses.has(access),
        `reviewed generation-consumer access scan finds ${access}`,
      );
    }
    assertGenerationConsumerAccessesCovered(reviewedGenerationConsumerAccesses, generationPreimage);

    const syntheticOutOfHashAccesses = scanGenerationConsumerAccesses(`
fn synthetic_generation_consumer(membership: &MembershipManifest) {
    let _ = membership.synthetic_out_of_hash;
}
`);
    assert.throws(
      () => assertGenerationConsumerAccessesCovered(syntheticOutOfHashAccesses, generationPreimage),
      {
        name: 'AssertionError',
        message: /a runtime authority consumer reads a field outside the generation hash — embed it before landing\./u,
      },
      'the generation-consumer access-lint rejects a synthetic out-of-hash field access',
    );

    const enumeratedFileWithNewConsumer = reviewedGenerationConsumerFileAllowlist[0];
    const syntheticNewFunctionAccesses = scanReviewedGenerationConsumerFiles(new Map([[
      enumeratedFileWithNewConsumer,
      `${readFileSync(join(repoRoot, enumeratedFileWithNewConsumer), 'utf8')}
fn synthetic_new_generation_consumer(membership: &MembershipManifest) {
    let _ = membership.synthetic_out_of_hash_from_new_function;
}
`,
    ]]));
    assert.throws(
      () => assertGenerationConsumerAccessesCovered(syntheticNewFunctionAccesses, generationPreimage),
      {
        name: 'AssertionError',
        message: /a runtime authority consumer reads a field outside the generation hash — embed it before landing\./u,
      },
      'the generation-consumer access-lint rejects a new function inside an enumerated file',
    );

    const syntheticManifestRootedAccesses = scanReviewedGenerationConsumerFiles(new Map([[
      enumeratedFileWithNewConsumer,
      `${readFileSync(join(repoRoot, enumeratedFileWithNewConsumer), 'utf8')}
fn synthetic_manifest_rooted_generation_consumer(manifest: &MembershipManifest) {
    let _ = manifest.synthetic_out_of_hash_from_manifest_receiver;
}
`,
    ]]));
    assert.ok(
      syntheticManifestRootedAccesses.has('membership.synthetic_out_of_hash_from_manifest_receiver'),
      'the generation-consumer access-lint scans a typed manifest receiver root',
    );
    assert.throws(
      () => assertGenerationConsumerAccessesCovered(syntheticManifestRootedAccesses, generationPreimage),
      {
        name: 'AssertionError',
        message: /a runtime authority consumer reads a field outside the generation hash — embed it before landing\./u,
      },
      'the generation-consumer access-lint rejects a manifest-rooted access inside an enumerated file',
    );
    for (const [member, mutate] of [
      ['roleLattice[].implies', (candidate) => candidate.roleLattice[1].implies.pop()],
      ['authorizationEventFields', (candidate) => candidate.authorizationEventFields.pop()],
    ]) {
      const changed = structuredClone(generationPreimage);
      mutate(changed);
      const changedGeneration = `sha256:${createHash('sha256')
        .update(`snapback:authority-profile:v1\n${canonicalJson(changed)}`)
        .digest('hex')}`;
      assert.notEqual(
        changedGeneration,
        profile.generation,
        `changing emitted ${member} content rotates the closed profile generation`,
      );
    }

    const canonicalVocabulary = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: "{ owner: ['editor', 'viewer'], viewer: [], editor: ['viewer'] }",
      roles: ['owner', 'editor', 'viewer'],
      transitions: [],
    }));
    assert.equal(
      canonicalVocabulary.result.ok,
      true,
      JSON.stringify(canonicalVocabulary.result.diagnostics),
    );
    const canonicalVocabularySchema = JSON.parse(readFileSync(
      join(canonicalVocabulary.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));

    const reorderedVocabulary = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: "{ owner: ['editor', 'viewer'], viewer: [], editor: ['viewer'] }",
      roles: ['owner', 'viewer', 'editor'],
      transitions: [],
    }));
    assert.equal(
      reorderedVocabulary.result.ok,
      true,
      JSON.stringify(reorderedVocabulary.result.diagnostics),
    );
    const reorderedVocabularySchema = JSON.parse(readFileSync(
      join(reorderedVocabulary.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    assert.deepEqual(
      reorderedVocabularySchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.roleLattice,
      [
        { role: 'owner', implies: ['editor', 'owner', 'viewer'] },
        { role: 'editor', implies: ['editor', 'viewer'] },
        { role: 'viewer', implies: ['viewer'] },
      ],
      'roleLattice is hierarchy-topological even when membership.roles is not',
    );
    const reorderedVocabularyProfile = reorderedVocabularySchema.tables
      .find(({ name }) => name === 'eventMembers')
      .authorityProfile;
    assert.equal(
      reorderedVocabularyProfile.generation,
      canonicalVocabularySchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.generation,
      'an authorial vocabulary reorder that leaves the complete emitted profile unchanged preserves generation',
    );

    const editedHierarchy = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: "{ owner: ['admin'], admin: ['member'], member: [] }",
    }));
    assert.equal(
      editedHierarchy.result.ok,
      true,
      JSON.stringify(editedHierarchy.result.diagnostics),
    );
    const editedHierarchySchema = JSON.parse(readFileSync(
      join(editedHierarchy.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    assert.equal(
      editedHierarchySchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.generation,
      profile.generation,
      'an authorial hierarchy edit with the same emitted implies closure preserves generation',
    );

    const prototypeNamedRole = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: "{ owner: ['toString'] }",
      roles: ['owner', 'toString'],
      transitions: [],
    }));
    assert.equal(
      prototypeNamedRole.result.ok,
      true,
      JSON.stringify(prototypeNamedRole.result.diagnostics),
    );
    const prototypeNamedRoleSchema = JSON.parse(readFileSync(
      join(prototypeNamedRole.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    assert.deepEqual(
      prototypeNamedRoleSchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.roleLattice,
      [
        { role: 'owner', implies: ['owner', 'toString'] },
        { role: 'toString', implies: ['toString'] },
      ],
      'an inherited Object.prototype name with no own hierarchy entry is a leaf role',
    );
    assert.deepEqual(profile.authorizationEventFields, [
      'eventId',
      'userId',
      'role',
      'displayName',
      'grantedByActor',
      'grantedByEffective',
      'grantedByGrant',
    ]);
    assert.deepEqual(profile.requiredIndexes, [
      {
        name: '_membership_pk',
        fields: ['userId', 'eventId'],
        unique: true,
        lookup: 'principal-in-scope-point',
      },
      {
        name: '_membership_reverse',
        fields: ['eventId', 'role', 'userId'],
        unique: false,
        lookup: 'protected-holders-and-scope-invalidation-range',
      },
    ]);
    assert.deepEqual(profile.permittedCompositionClasses, [
      'table-visibility.membership.v1',
      'function-admission.membership.v1',
      'membership-visible-search.v1',
      'authority-roster-projection.v1',
      'authority-roster-transitions.v1',
    ]);
    assert.deepEqual(profile.notYetQualifiedCompositionClasses, [
      'authority-profile-asset-sharing.v1',
    ]);
    assert.deepEqual(profile.subjectDerivation.coarseGlobalWakeUniverse, [
      'membership-relation-insert-update-delete',
      'protected-resource-row-insert-update-delete',
      'effective-principal-or-auth-context-change',
      'authority-profile-generation-activation',
    ]);
    assert.deepEqual(profile.operations, [
      {
        name: 'list',
        kind: 'LiveQuery',
        authRequirement: 'authenticated',
        hooks: ['useSnapbackQuery', 'useSnapbackAuthorityRoster'],
        transitionOps: [],
      },
      {
        name: 'myRole',
        kind: 'LiveQuery',
        authRequirement: 'authenticated',
        hooks: ['useSnapbackQuery', 'useSnapbackAuthorityMyRole'],
        transitionOps: [],
      },
      ...['invite', 'join', 'leave', 'changeRole', 'transferOwner', 'remove'].map((name) => ({
        name,
        kind: 'Mutation',
        authRequirement: 'authenticated',
        hooks: [
          'useSnapbackMutation',
          'useSnapbackAuthorityMutation',
          'useSnapbackOutbox.mutationStatus',
          'useSnapbackAuthorityMutationStatus',
        ],
        transitionOps: [name === 'transferOwner' ? 'transferOwner' : (
          ['invite'].includes(name) ? 'insert' : (
            ['join', 'changeRole'].includes(name) ? 'setRole' : 'remove'
          )
        )],
        outcomes: authorityOutcomeFixtures(name),
      })),
    ]);
    assert.deepEqual(tables.eventNotes.visibility.roles, ['admin', 'member', 'owner']);

    const functionsByName = Object.fromEntries(
      functionManifest.functions.map((operation) => [operation.name, operation]),
    );
    assert.deepEqual(
      functionsByName.eventById.runtime.HostPlan.Query.membershipFilters[0].roles,
      ['admin', 'member', 'owner'],
    );
    for (const name of [
      'eventById',
      'visibleNotes',
      'writeMembers',
      'memberSummary',
      'addNote',
      'eventMembers.list',
      'eventMembers.myRole',
      'eventMembers.invite',
      'eventMembers.join',
      'eventMembers.leave',
      'eventMembers.changeRole',
      'eventMembers.transferOwner',
      'eventMembers.remove',
    ]) {
      assert(functionsByName[name], `${name} was not generated`);
      assert.deepEqual(functionsByName[name].authorityProfileDependence, [{
        id: 'eventMembers',
        generation: profile.generation,
      }]);
    }
    for (const operation of profile.operations) {
      assert.deepEqual(
        functionsByName[`eventMembers.${operation.name}`].authorizationDependence,
        ['userId'],
      );
    }
    assert.deepEqual(functionsByName.memberSummary.readSetSummary.tables, [
      'eventNotes',
      'eventMembers',
    ]);
    assert.match(
      functionsByName.memberSummary.runtime.IbexModule.source,
      /\.allowsRole\(args\["eventId"\], "admin", "member", "owner"\)/u,
    );
    assert.doesNotMatch(
      authorityProfileFunctions,
      /permissions|requireRole|allowsRole/u,
      'the authored Clique-shaped handlers must not repeat membership guards',
    );
    assert.match(
      functionsByName.addNote.runtime.IbexModule.source,
      /\.requireRole\(args\["eventId"\], "admin", "member", "owner"\)/u,
    );
    assert.equal(functionsByName['eventMembers.list'].kind, 'LiveQuery');
    assert.match(functionsByName['eventMembers.list'].runtime.IbexModule.source, /ctx\.authority\["eventMembers"\]\.list/u);
    assert.equal(functionsByName['eventMembers.list'].argsContract.fields.find(({ name }) => name === 'page').required, false);
    assert.doesNotMatch(functionsByName['eventMembers.list'].runtime.IbexModule.source, /\["_id"\]/u);
    assert.match(functionsByName['eventMembers.myRole'].runtime.IbexModule.source, /ctx\.authority\["eventMembers"\]\.myRole/u);
    assert.equal(functionsByName['eventMembers.transferOwner'].kind, 'Mutation');
    assert.match(functionsByName['eventMembers.transferOwner'].runtime.IbexModule.source, /\.transferOwner\(args\.scopeId, args\.principal\)/u);
    for (const operation of profile.operations.map(({ name }) => name)) {
      const name = `eventMembers.${operation}`;
      assert.deepEqual(functionsByName[name].generatedAuthorityOperation, {
        id: 'eventMembers',
        generation: profile.generation,
        operation,
      });
    }
    for (const name of ['eventById', 'visibleNotes', 'writeMembers', 'memberSummary', 'addNote']) {
      assert.equal(
        Object.hasOwn(functionsByName[name], 'generatedAuthorityOperation'),
        false,
        `${name} must not acquire generated-operation identity from its name or profile dependence`,
      );
    }
    const explicitApi = readFileSync(join(baseline.dir, 'generated', 'api.mjs'), 'utf8');
    const explicitApiTypes = readFileSync(join(baseline.dir, 'generated', 'api.d.ts'), 'utf8');
    assert.match(explicitApi, /references\["eventMembers"\] = \{ "list":/u);
    assert.match(explicitApi, /"changeRole": references\["eventMembers\.changeRole"\]/u);
    assert.match(explicitApiTypes, /readonly "eventMembers": Readonly<\{ "list":/u);
    assert.match(explicitApiTypes, /"transferOwner": GeneratedApi\["eventMembers\.transferOwner"\]/u);
    const listTypeLine = explicitApiTypes.split('\n')
      .find((line) => line.startsWith('  "eventMembers.list": FunctionReference<'));
    const myRoleTypeLine = explicitApiTypes.split('\n')
      .find((line) => line.startsWith('  "eventMembers.myRole": FunctionReference<'));
    assert.match(
      listTypeLine ?? '',
      /"role": "admin" \| "member" \| "owner" \| "invited"/u,
    );
    assert.match(
      myRoleTypeLine ?? '',
      /"role": "admin" \| "member" \| "owner" \| "invited"; "status": "active" \| "invited"/u,
    );
    writeFileSync(join(baseline.dir, 'authority-consumer.ts'), `
import type { FunctionResult, GeneratedApi } from './generated/api';

type RosterRole = FunctionResult<GeneratedApi['eventMembers.list']>[number]['role'];
type MyRoleStatus = FunctionResult<GeneratedApi['eventMembers.myRole']>[number]['status'];

function exhaustRole(role: RosterRole): string {
  switch (role) {
    case 'owner': return role;
    case 'admin': return role;
    case 'member': return role;
    case 'invited': return role;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

function exhaustStatus(status: MyRoleStatus): string {
  switch (status) {
    case 'active': return status;
    case 'invited': return status;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

// @ts-expect-error Profile result roles are a closed literal union.
const invalidRole: RosterRole = 'moderator';
void invalidRole;
void exhaustRole;
void exhaustStatus;
`);
    execFileSync(join(repoRoot, 'node_modules/.bin/tsc'), [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      'authority-consumer.ts',
    ], { cwd: baseline.dir, stdio: 'pipe' });
    assert.equal(
      Object.hasOwn(functionsByName.publicEvents, 'authorityProfileDependence'),
      false,
      'an unrelated function must not acquire profile dependence',
    );

    // @ref LLP 0240#invariants-the-prototype-must-preserve — the optional product
    // projection adds new D1-envelope reads while preserving list/myRole,
    // and the generated operation matrix pins one fixture for each outcome
    // class rather than leaving idempotency to handler folklore.
    const projected = await run(sourceWithPublicWitness, authorityProfileSchema({
      projection: "{ history: { visible: ['displayName'] }, recipients: { ceiling: 1024, sinks: [{ operation: 'sendDelivery', table: 'eventDeliveries', scopeField: 'eventId', recipientsField: 'recipientIds' }] } }",
      roster: "{ visible: ['userId', 'role'] }",
    }));
    assert.equal(projected.result.ok, true, JSON.stringify(projected.result.diagnostics));
    const projectedSchema = JSON.parse(readFileSync(
      join(projected.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const projectedFunctions = JSON.parse(readFileSync(
      join(projected.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const projectedProfile = projectedSchema.tables
      .find(({ name }) => name === 'eventMembers').authorityProfile;
    assert.deepEqual(projectedProfile.projection, {
      version: 1,
      source: 'writer-seam-row-images',
      history: {
        visibleFields: ['displayName'],
        incarnationSemantics: 'presence-v1',
      },
      recipients: {
        ceiling: 1024,
        overflow: 'typed-refusal',
        freeze: 'sending-transaction',
        sinks: [{
          operation: 'sendDelivery',
          table: 'eventDeliveries',
          scopeField: 'eventId',
          recipientsField: 'recipientIds',
        }],
      },
      historyHorizon: {
        carrier: 'operation-envelope',
        coverage: ['full', 'authorization-facts-only'],
      },
      offlineRetention: 'not-implied',
    });
    assert.deepEqual(
      projectedProfile.operations.slice(0, 4).map(({ name }) => name),
      ['list', 'myRole', 'history', 'incarnations'],
    );
    const projectedFunctionsByName = Object.fromEntries(
      projectedFunctions.functions.map((operation) => [operation.name, operation]),
    );
    for (const name of ['history', 'incarnations']) {
      const operation = projectedFunctionsByName[`eventMembers.${name}`];
      assert.equal(operation.kind, 'LiveQuery');
      assert.deepEqual(operation.generatedAuthorityOperation, {
        id: 'eventMembers',
        generation: projectedProfile.generation,
        operation: name,
      });
      assert.match(
        operation.runtime.IbexModule.source,
        new RegExp(`\\[${JSON.stringify(name)}\\]\\(args\\.scopeId, args\\.page\\)`),
      );
      assert.equal(operation.resultContract.kind, 'value');
    }
    const outcomeFixture = (operation, branch) => projectedProfile.operations
      .find(({ name }) => name === operation).outcomes
      .find((candidate) => candidate.branch === branch);
    assert.deepEqual(outcomeFixture('changeRole', 'already-at-requested-role'), {
      branch: 'already-at-requested-role',
      outcome: 'idempotent-success-unchanged',
    });
    assert.deepEqual(outcomeFixture('invite', 'already-active-member'), {
      branch: 'already-active-member',
      outcome: 'typed-precondition-refusal',
    });
    assert.deepEqual(outcomeFixture('remove', 'absent-target'), {
      branch: 'absent-target',
      outcome: 'idempotent-success-unchanged',
    });
    assert.deepEqual(outcomeFixture('remove', 'hidden-target-or-scope'), {
      branch: 'hidden-target-or-scope',
      outcome: 'non-enumerating-denial',
    });
    assert.deepEqual(projectedFunctionsByName.sendDelivery.generatedAuthorityOperation, {
      id: 'eventMembers',
      generation: projectedProfile.generation,
      operation: 'snapshotRecipients',
      recipientSink: projectedProfile.projection.recipients.sinks[0],
    });
    assert.equal(
      projected.result.diagnostics.some(
        ({ code }) => code === 'SNAPBACK_AUTHORITY_RECIPIENT_SINK_PUBLIC_READ',
      ),
      false,
      'an owner-readable recipient sink does not warn',
    );

    const publicRecipientSink = await run(sourceWithPublicWitness, authorityProfileSchema({
      deliveryVisibility: "{ kind: 'public-read' }",
      projection: "{ history: { visible: ['displayName'] }, recipients: { ceiling: 1024, sinks: [{ operation: 'sendDelivery', table: 'eventDeliveries', scopeField: 'eventId', recipientsField: 'recipientIds' }] } }",
      roster: "{ visible: ['userId', 'role'] }",
    }));
    assert.equal(
      publicRecipientSink.result.ok,
      true,
      'public recipient publication remains an admitted author choice',
    );
    const publicRecipientWarning = publicRecipientSink.result.diagnostics.find(
      ({ code }) => code === 'SNAPBACK_AUTHORITY_RECIPIENT_SINK_PUBLIC_READ',
    );
    assert.deepEqual({
      severity: publicRecipientWarning?.severity,
      table: publicRecipientWarning?.details?.table,
      field: publicRecipientWarning?.details?.field,
      visibility: publicRecipientWarning?.details?.visibility,
    }, {
      severity: 'warning',
      table: 'eventDeliveries',
      field: 'recipientIds',
      visibility: 'public-read',
    });

    const insufficientProjectionProvenance = await run(
      'export {};\n',
      authorityProfileSchema({
        projection: "{ history: { visible: ['displayName'] }, recipients: { ceiling: 1024, sinks: [{ operation: 'sendDelivery', table: 'eventDeliveries', scopeField: 'eventId', recipientsField: 'recipientIds' }] } }",
        provenance: 'creation',
        roster: "{ visible: ['userId', 'role'] }",
      }),
    );
    authorityProfileDiagnostic(
      insufficientProjectionProvenance.result,
      'SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED',
    );

    const transitionEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      transitions: [{
        op: 'setRole',
        by: ['owner'],
        target: 'other',
        from: ['member'],
        to: ['admin'],
      }],
    }));
    assert.equal(transitionEdit.result.ok, true, JSON.stringify(transitionEdit.result.diagnostics));
    const transitionSchema = JSON.parse(readFileSync(
      join(transitionEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const transitionFunctions = JSON.parse(readFileSync(
      join(transitionEdit.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const transitionGeneration = transitionSchema.tables
      .find(({ name }) => name === 'eventMembers').authorityProfile.generation;
    assert.notEqual(transitionGeneration, profile.generation, 'a transition edit rotates the generation');
    const transitionFunctionsByName = Object.fromEntries(
      transitionFunctions.functions.map((operation) => [operation.name, operation]),
    );
    assert.deepEqual(
      transitionSchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.operations
        .map(({ name }) => name),
      ['list', 'myRole', 'changeRole', 'transferOwner'],
      'operations unsupported by the transition matrix must be absent',
    );
    for (const unsupported of ['invite', 'join', 'leave', 'remove']) {
      assert.equal(
        transitionFunctionsByName[`eventMembers.${unsupported}`],
        undefined,
        `${unsupported} must not degrade into a runtime no-op`,
      );
    }
    assert.equal(transitionFunctionsByName['eventMembers.changeRole'].kind, 'Mutation');
    assert.notEqual(
      transitionFunctionsByName.eventById.implementationHash,
      functionsByName.eventById.implementationHash,
      'a dependent function rotates with the authority profile',
    );
    assert.equal(
      transitionFunctionsByName.publicEvents.implementationHash,
      functionsByName.publicEvents.implementationHash,
      'profile edits preserve unrelated implementation identities',
    );

    const byRoleTransitions = structuredClone(authorityTransitions);
    byRoleTransitions[0].by.push('admin');
    const byRoleEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      transitions: byRoleTransitions,
    }));
    assert.equal(byRoleEdit.result.ok, true, JSON.stringify(byRoleEdit.result.diagnostics));
    const byRoleEditProfile = JSON.parse(readFileSync(
      join(byRoleEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    )).tables.find(({ name }) => name === 'eventMembers').authorityProfile;
    assert.deepEqual(
      byRoleEditProfile.operations,
      profile.operations,
      'adding an admitting caller role preserves the generated operation set',
    );
    assert.notDeepEqual(
      byRoleEditProfile.transitionPreconditions.matrix,
      profile.transitionPreconditions.matrix,
      'the embedded matrix records the changed caller-role authorization',
    );
    assert.notEqual(
      byRoleEditProfile.generation,
      profile.generation,
      'changing only one transition by-role set rotates the closed profile generation',
    );

    const provenanceEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      provenance: 'creation',
    }));
    assert.equal(provenanceEdit.result.ok, true, JSON.stringify(provenanceEdit.result.diagnostics));
    const provenanceEditProfile = JSON.parse(readFileSync(
      join(provenanceEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    )).tables.find(({ name }) => name === 'eventMembers').authorityProfile;
    assert.equal(provenanceEditProfile.transitionPreconditions.provenance, 'creation');
    assert.notEqual(
      provenanceEditProfile.generation,
      profile.generation,
      'changing membership provenance from full to creation rotates the generation',
    );

    const expiryAbsent = await run(sourceWithPublicWitness, authorityProfileSchema({
      expiryField: true,
    }));
    const expiryPresent = await run(sourceWithPublicWitness, authorityProfileSchema({
      expiryField: true,
      expiryPresent: true,
    }));
    assert.equal(expiryAbsent.result.ok, true, JSON.stringify(expiryAbsent.result.diagnostics));
    assert.equal(expiryPresent.result.ok, true, JSON.stringify(expiryPresent.result.diagnostics));
    const expiryAbsentProfile = JSON.parse(readFileSync(
      join(expiryAbsent.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    )).tables.find(({ name }) => name === 'eventMembers').authorityProfile;
    const expiryPresentProfile = JSON.parse(readFileSync(
      join(expiryPresent.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    )).tables.find(({ name }) => name === 'eventMembers').authorityProfile;
    assert.equal(expiryAbsentProfile.transitionPreconditions.expiryPresent, false);
    assert.equal(expiryPresentProfile.transitionPreconditions.expiryPresent, true);
    assert.notEqual(
      expiryPresentProfile.generation,
      expiryAbsentProfile.generation,
      'adding membership expiry rotates the generation',
    );

    // A valid owner profile cannot author the LLP 0100 total remove carrier:
    // its omitted `from` also ranges over owner, which the profile's separate
    // transfer-only owner invariant correctly refuses. The LLP 0100 block
    // below independently proves declaration emission. Here, flip the emitted
    // scalar itself to pin the hash behavior without weakening owner custody.
    const principalAddressedWritesPreimage = structuredClone(generationPreimage);
    assert.equal(
      principalAddressedWritesPreimage.transitionPreconditions.principalAddressedWritesRemove,
      null,
    );
    principalAddressedWritesPreimage
      .transitionPreconditions
      .principalAddressedWritesRemove = true;
    const principalAddressedWritesGeneration = `sha256:${createHash('sha256')
      .update(`snapback:authority-profile:v1\n${canonicalJson(principalAddressedWritesPreimage)}`)
      .digest('hex')}`;
    assert.notEqual(
      principalAddressedWritesGeneration,
      profile.generation,
      'enabling principalAddressedWrites.remove rotates the generation',
    );

    const reorderedTransitions = [...authorityTransitions].reverse().map((transition) => ({
      ...transition,
      by: [...transition.by].reverse(),
      ...(transition.from === undefined ? {} : { from: [...transition.from].reverse() }),
      ...(transition.to === undefined ? {} : { to: [...transition.to].reverse() }),
      ...(transition.fields === undefined ? {} : { fields: [...transition.fields].reverse() }),
    }));
    const reorderedTransitionsResult = await run(
      sourceWithPublicWitness,
      authorityProfileSchema({ transitions: reorderedTransitions }),
    );
    assert.equal(
      reorderedTransitionsResult.result.ok,
      true,
      JSON.stringify(reorderedTransitionsResult.result.diagnostics),
    );
    const reorderedTransitionsProfile = JSON.parse(readFileSync(
      join(reorderedTransitionsResult.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    )).tables.find(({ name }) => name === 'eventMembers').authorityProfile;
    assert.deepEqual(
      reorderedTransitionsProfile.transitionPreconditions.matrix,
      profile.transitionPreconditions.matrix,
      'authorial row/set reorderings normalize to one embedded matrix',
    );
    assert.equal(
      reorderedTransitionsProfile.generation,
      profile.generation,
      'authorial row/set reorderings preserve closed profile generation',
    );

    const ownerMember = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: "{ owner: ['member'], member: [] }",
      roles: ['owner', 'member'],
      transitions: [],
    }));
    assert.equal(ownerMember.result.ok, true, JSON.stringify(ownerMember.result.diagnostics));
    const ownerMemberSchema = JSON.parse(readFileSync(
      join(ownerMember.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const ownerMemberFunctions = JSON.parse(readFileSync(
      join(ownerMember.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    assert.deepEqual(
      ownerMemberSchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.operations
        .map(({ name }) => name),
      ['list', 'myRole', 'transferOwner'],
      'an owner/member lattice must retain a generated ownership recovery path',
    );
    assert(
      ownerMemberFunctions.functions.some(({ name }) => name === 'eventMembers.transferOwner'),
      'an owner/member lattice must emit the transferOwner function',
    );

    const ownerOnly = await run('export {};\n', authorityProfileSchema({
      consumerVisibility: false,
      hierarchy: '{ owner: [] }',
      roles: ['owner'],
      transitions: [],
    }));
    assert.equal(ownerOnly.result.ok, true, JSON.stringify(ownerOnly.result.diagnostics));
    const ownerOnlySchema = JSON.parse(readFileSync(
      join(ownerOnly.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const ownerOnlyFunctions = JSON.parse(readFileSync(
      join(ownerOnly.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    assert.deepEqual(
      ownerOnlySchema.tables
        .find(({ name }) => name === 'eventMembers')
        .authorityProfile.operations
        .map(({ name }) => name),
      ['list', 'myRole'],
      'an owner-only lattice must omit transferOwner because no caller successor exists',
    );
    assert.equal(
      ownerOnlyFunctions.functions.find(({ name }) => name === 'eventMembers.transferOwner'),
      undefined,
      'an owner-only lattice must not emit the transferOwner function',
    );

    const roleFieldEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      roleField: 'accessRole',
      roster: "{ visible: ['userId', 'accessRole', 'displayName'] }",
    }));
    assert.equal(roleFieldEdit.result.ok, true, JSON.stringify(roleFieldEdit.result.diagnostics));
    const roleFieldSchema = JSON.parse(readFileSync(
      join(roleFieldEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    assert.notEqual(
      roleFieldSchema.tables.find(({ name }) => name === 'eventMembers').authorityProfile.generation,
      profile.generation,
      'a role-field edit rotates the generation',
    );
  }

  for (const [label, variant, code, detail] of [
    [
      'profile before membership',
      { profileBeforeMembership: true },
      'SNAPBACK_AUTHORITY_PROFILE_MEMBERSHIP_REQUIRED',
    ],
    [
      'unpinned membership id',
      { omitMembershipId: true },
      'SNAPBACK_AUTHORITY_PROFILE_STABLE_ID_REQUIRED',
    ],
    [
      'invalid profile id',
      { profileName: 'invalid-profile' },
      'SNAPBACK_AUTHORITY_PROFILE_ID_INVALID',
    ],
    [
      'generated API namespace',
      { consumerVisibility: false, membershipId: 'groups', profileName: 'groups' },
      'SNAPBACK_AUTHORITY_PROFILE_OPERATION_COLLISION',
    ],
    [
      'facade owns only name hierarchy and roster',
      { profileExtra: 'transitions: [],' },
      'SNAPBACK_AUTHORITY_PROFILE_SPEC_INVALID',
    ],
    [
      'profile/membership id mismatch',
      { profileName: 'eventAccess' },
      'SNAPBACK_AUTHORITY_PROFILE_ID_MISMATCH',
    ],
    [
      'principal nominal type',
      { principalValidator: 'v.string()' },
      'SNAPBACK_AUTHORITY_PROFILE_PRINCIPAL_TYPE_MISMATCH',
    ],
    [
      'scope nominal type',
      { resourceValidator: 'v.string()', consumerVisibility: false },
      'SNAPBACK_AUTHORITY_PROFILE_SCOPE_TYPE_MISMATCH',
    ],
    [
      'resource binding',
      { resourceValidator: "v.id('missingEvents')", consumerVisibility: false },
      'SNAPBACK_AUTHORITY_PROFILE_RESOURCE_BINDING_INVALID',
    ],
    [
      'closed roles/statuses',
      { membershipMutation: "eventMembers.membershipDeclaration.pendingRoles = ['member'];" },
      'SNAPBACK_AUTHORITY_PROFILE_ROLE_VOCABULARY_INVALID',
    ],
    [
      'pending status in lattice',
      { hierarchy: "{ owner: ['admin', 'member'], admin: ['member'], member: [], invited: [] }" },
      'SNAPBACK_AUTHORITY_PROFILE_PENDING_STATUS_INVALID',
    ],
    [
      'ambiguous owner',
      { bootstrapRole: 'admin' },
      'SNAPBACK_AUTHORITY_PROFILE_AMBIGUOUS_OWNER',
    ],
    [
      'ungoverned owner write',
      {
        transitions: [{
          op: 'setRole',
          by: ['owner'],
          target: 'other',
          from: ['member'],
          to: ['owner'],
        }],
      },
      'SNAPBACK_AUTHORITY_PROFILE_UNGOVERNED_WRITE_PATH',
    ],
    [
      'duplicate active profile',
      { duplicateProfile: true },
      'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
    ],
    [
      'legacy authority declaration',
      { legacyAuthority: true },
      'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
      (details) => details?.legacyDeclaration === 'permissionBacking',
    ],
    [
      'missing canonical unique index',
      { indexName: '_membership_pk' },
      'SNAPBACK_AUTHORITY_PROFILE_REQUIRED_INDEX_MISSING',
      (details) => details?.index === '_membership_pk',
    ],
    [
      'missing canonical reverse index',
      { indexName: '_membership_reverse' },
      'SNAPBACK_AUTHORITY_PROFILE_REQUIRED_INDEX_MISSING',
      (details) => details?.index === '_membership_reverse',
    ],
    [
      'invalid role lattice',
      { hierarchy: "{ owner: ['admin', 'member'], admin: ['owner'], member: [] }" },
      'SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID',
    ],
    [
      'invalid roster',
      { roster: "{ visible: ['missingField'] }" },
      'SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID',
    ],
    [
      'asset composition',
      { unsupportedComposition: 'asset' },
      'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS',
      (details) => details?.compositionClass === 'authority-profile-asset-sharing.v1',
    ],
  ]) {
    const { result } = await run('export {};\n', authorityProfileSchema(variant));
    authorityProfileDiagnostic(result, code, detail);
    assert.equal(result.ok, false, `${label} unexpectedly generated`);
  }

  {
    const { dir, result } = await run(
      authorityProfileSearchFunctions,
      authorityProfileSchema({ unsupportedComposition: 'search' }),
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const generatedSchema = JSON.parse(readFileSync(
      join(dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const search = generatedSchema.tables
      .find(({ name }) => name === 'eventNotes')
      .searchIndexes.find(({ name }) => name === 'search_notes');
    assert.deepEqual(
      search.visibility,
      {
        kind: 'membership',
        declaration: 'eventMembers',
        resourceField: 'eventId',
        roles: ['admin', 'member', 'owner'],
      },
      'profile search compiles directly to the existing membership visibility plan with closed roles',
    );
    assert.deepEqual(Object.keys(search.textFields), ['body']);
    assert.deepEqual(search.storedFields, ['body']);
    assert.deepEqual(
      search.highlightFields,
      [],
      'the membership-table roster boundary does not alter the announcement index projection',
    );
    const profile = generatedSchema.tables
      .find(({ name }) => name === 'eventMembers')
      .authorityProfile;
    const generatedFunctions = JSON.parse(readFileSync(
      join(dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const searchOperation = generatedFunctions.functions
      .find(({ name }) => name === 'searchEventNotes');
    assert.deepEqual(searchOperation.authorityProfileDependence, [{
      id: 'eventMembers',
      generation: profile.generation,
    }]);
    const review = JSON.parse(readFileSync(
      join(dir, 'generated', 'authorization-review.json'),
      'utf8',
    ));
    assert.deepEqual(
      review.operations.find(({ name }) => name === 'searchEventNotes')
        .authorityProfileIdentities,
      searchOperation.authorityProfileDependence,
      'authorization review carries the profile-backed search dependence',
    );

    const edited = await run(
      authorityProfileSearchFunctions,
      authorityProfileSchema({ unsupportedComposition: 'search', provenance: 'creation' }),
    );
    assert.equal(edited.result.ok, true, JSON.stringify(edited.result.diagnostics));
    const editedSchema = JSON.parse(readFileSync(
      join(edited.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const editedGeneration = editedSchema.tables
      .find(({ name }) => name === 'eventMembers')
      .authorityProfile.generation;
    const editedFunctions = JSON.parse(readFileSync(
      join(edited.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const editedSearch = editedFunctions.functions
      .find(({ name }) => name === 'searchEventNotes');
    assert.notEqual(editedGeneration, profile.generation);
    assert.deepEqual(editedSearch.authorityProfileDependence, [{
      id: 'eventMembers',
      generation: editedGeneration,
    }]);
    assert.notEqual(
      editedSearch.implementationHash,
      searchOperation.implementationHash,
      'the runtime operation fence rotates with its profile-backed search dependence',
    );
    const editedReview = JSON.parse(readFileSync(
      join(edited.dir, 'generated', 'authorization-review.json'),
      'utf8',
    ));
    assert.deepEqual(
      editedReview.operations.find(({ name }) => name === 'searchEventNotes')
        .authorityProfileIdentities,
      editedSearch.authorityProfileDependence,
      'the edited review rotates the same search profile identity',
    );
  }

  {
    const visible = await run(
      'export {};\n',
      authorityProfileSchema({ membershipSearch: 'visible' }),
    );
    assert.equal(visible.result.ok, true, JSON.stringify(visible.result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(
      join(visible.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const search = schemaManifest.tables
      .find(({ name }) => name === 'eventMembers')
      .searchIndexes.find(({ name }) => name === 'search_members');
    assert.deepEqual(Object.keys(search.textFields), ['role']);
    assert.deepEqual(search.storedFields, ['role']);
    assert.deepEqual(search.highlightFields, ['role']);
    assert.deepEqual(search.visibility.roles, ['admin', 'member', 'owner']);
  }

  {
    const { result } = await run(
      'export {};\n',
      authorityProfileSchema({
        membershipSearch: 'invisible',
        roster: "{ visible: ['userId', 'role'] }",
      }),
    );
    const diagnostic = authorityProfileDiagnostic(
      result,
      'SNAPBACK_AUTHORITY_PROFILE_SEARCH_FIELD_NOT_VISIBLE',
      (details) => (
        details?.index === 'search_members'
        && details?.invisibleFields?.includes('displayName')
      ),
    );
    assert.deepEqual(diagnostic.details.visibleFields, ['role', 'userId']);
  }

  {
    const { result } = await run(
      'export {};\n',
      authorityProfileSchema(),
      { targetProfile: 'remote-service-sqlite-ibex' },
    );
    authorityProfileDiagnostic(result, 'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET');
  }

  {
    const { result } = await run(
      authorityProfileFunctions.replaceAll("'member'", "'host'"),
      schema,
    );
    assert.equal(result.ok, false, 'opaque handler admission must not invent a profile');
    assert(
      result.diagnostics.some(({ code }) => (
        code === 'SNAPBACK_AUTHORITY_PROFILE_FUNCTION_ADMISSION_REQUIRED'
      )),
      JSON.stringify(result.diagnostics),
    );
  }

  for (const [label, resultContract, resultKind] of [
    ['document', "results.document('eventNotes')", 'document'],
    ['value', 'results.value(v.object({ body: v.string() }))', 'value'],
    [
      'nonempty records',
      'results.records(v.object({ body: v.string() }), { minItems: 1, maxItems: 1 })',
      'records',
    ],
  ]) {
    const { result } = await run(`
import { eventMembers } from './schema.mjs';
import {
  defineJsLiveQuery,
  membershipResource,
  results,
  v,
} from '${defineUrl}';

export const incompatibleDeniedResult = defineJsLiveQuery({
  auth: 'authenticated',
  args: { eventId: v.id('events') },
  reads: ['eventNotes'],
  result: ${resultContract},
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'member')],
  handler: async () => [],
});
`, authorityProfileSchema());
    assert.equal(result.ok, false, `${label} membership result unexpectedly generated`);
    const diagnostic = result.diagnostics.find(({ code }) => (
      code === 'SNAPBACK_AUTHORITY_PROFILE_QUERY_DENIAL_RESULT_INCOMPATIBLE'
    ));
    assert(diagnostic, JSON.stringify(result.diagnostics));
    assert.equal(diagnostic.details?.resultKind, resultKind);
    assert.match(diagnostic.details?.repair ?? '', /row-set result/u);
  }

  // LLP 0240 rollout 2 / LLP 0236 OQ9: the same Clique-shaped declaration is
  // available in the Familiar profile. The app writes no imperative role
  // guard; generated read/write preludes and the roster namespace carry it.
  {
    const { authoredFunctions, dir, result } = await runFamiliarAuthorityProfile();
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.doesNotMatch(authoredFunctions, /permissions|requireRole|allowsRole/u);
    const functionsManifest = JSON.parse(readFileSync(
      join(dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const functionsByName = Object.fromEntries(
      functionsManifest.functions.map((operation) => [operation.name, operation]),
    );
    assert.match(functionsByName['rooms.summary'].runtime.IbexModule.source, /\.allowsRole\(/u);
    assert.match(functionsByName['rooms.send'].runtime.IbexModule.source, /\.requireRole\(/u);
    assert.deepEqual(functionsByName['rooms.summary'].readSetSummary.tables, [
      'messages',
      'roomMembers',
    ]);
    assert.equal(functionsByName['roomAccess.list'].kind, 'LiveQuery');
    assert.equal(functionsByName['roomAccess.myRole'].kind, 'LiveQuery');
    const apiModule = readFileSync(join(dir, 'generated', 'api.mjs'), 'utf8');
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert.match(apiModule, /root\["roomAccess"\]\["list"\]/u);
    assert.match(apiModule, /root\["roomAccess"\]\["myRole"\]/u);
    assert.match(apiTypes, /readonly "roomAccess": Readonly<\{ "list": GeneratedApi\["roomAccess\.list"\]/u);
  }

  // LLP 0100 §2: principalAddressedWrites — closed option, total-carrier
  // activation, lastHolder consistency, and the generated removePrincipal
  // typing (only when declared; result is always Promise<null>).
  {
    const principalAddressedSchema = ({
      option = '{ remove: true }',
      transitions = "[{ op: 'remove', by: ['host'], target: 'other' }]",
    } = {}) => `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  provenance: 'full',
  principalAddressedWrites: ${option},
  transitions: ${transitions},
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  organizations: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

    const { dir, result } = await run('export {};\n', principalAddressedSchema());
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
    const members = schemaManifest.tables.find(({ name }) => name === 'eventMembers');
    assert.deepEqual(
      members.membership.principalAddressedWrites,
      { remove: true },
      'the manifest carries the closed opt-in',
    );
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      apiTypes.includes("removePrincipal(resource: Id<'events'>, principal: string): Promise<null>"),
      'the declared option emits the typed removePrincipal command',
    );

    // Without the option the method is not emitted at all.
    const closed = await run('export {};\n', principalAddressedSchema({ option: 'undefined' }));
    assert.equal(closed.result.ok, true, JSON.stringify(closed.result.diagnostics));
    const closedTypes = readFileSync(join(closed.dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      !closedTypes.includes('removePrincipal'),
      'no opt-in, no principal-addressed surface',
    );

    // Generation negatives: remove:false, unknown option fields, no total
    // carrier (partial from coverage), pending carrier class, and a carrier
    // class inconsistent with lastHolder.
    for (const [label, variant] of [
      ['remove: false', { option: '{ remove: false }' }],
      ['unknown option field', { option: '{ remove: true, setRole: true }' }],
      ['partial from coverage only', {
        transitions: "[{ op: 'remove', by: ['host'], target: 'other', from: ['guest'] }]",
      }],
      ['pending carrier class', {
        transitions: "[{ op: 'remove', by: ['invited'], target: 'other' }]",
      }],
      ['carrier class inconsistent with lastHolder', {
        transitions: "[{ op: 'remove', by: ['guest'], target: 'other' }]",
      }],
    ]) {
      const { result } = await run('export {};\n', principalAddressedSchema(variant));
      assert.equal(result.ok, false, `${label} unexpectedly generated`);
    }
  }

  // A profile membership table cannot select another profile's membership
  // declaration to evade its own roster projection and dependence identity.
  {
    const crossProfileSearchSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  displayName: v.optional(v.string()),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: ${JSON.stringify(authorityTransitions)},
}).authorityProfile({
  name: 'eventMembers',
  hierarchy: { owner: ['admin', 'member'], admin: ['member'], member: [] },
  roster: { visible: ['userId', 'role'] },
}).searchIndex('search_members', {
  semanticVersion: 'cross-profile-alias-refusal.v1',
  textFields: { displayName: { weight: 1, classification: 'private' } },
  fieldClassifications: { eventId: 'private' },
  storedFields: ['displayName'],
  highlightFields: ['displayName'],
  visibility: {
    kind: 'membership',
    declaration: 'alternateMembers',
    resourceField: 'eventId',
    roles: ['member'],
  },
}).visibility({ kind: 'owner', field: 'userId' });

export const alternateMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  displayName: v.optional(v.string()),
}).membership({
  id: 'alternateMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: ${JSON.stringify(authorityTransitions)},
}).authorityProfile({
  name: 'alternateMembers',
  hierarchy: { owner: ['admin', 'member'], admin: ['member'], member: [] },
  roster: { visible: ['userId', 'role', 'displayName'] },
}).visibility({ kind: 'owner', field: 'userId' });

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
  alternateMembers,
}, { auth: { mode: 'sessions' } });
`;
    const { result } = await run('export {};\n', crossProfileSearchSchema);
    const diagnostic = authorityProfileDiagnostic(
      result,
      'SNAPBACK_AUTHORITY_PROFILE_SEARCH_DECLARATION_MISMATCH',
      (details) => (
        details?.index === 'search_members'
        && details?.tableProfileDeclaration === 'eventMembers'
        && details?.visibilityDeclaration === 'alternateMembers'
      ),
    );
    assert.match(diagnostic.message, /alternateMembers.*eventMembers|eventMembers.*alternateMembers/u);
  }

  console.log('rbac-authoring.test.mjs: all cases passed');
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
