import {
  membershipResource,
  type AppMembershipSpec,
  type InferValidator,
  defineTable,
  anyOf,
  owner,
  v,
} from '@expo/snapback-codegen/define';

const nestedValidator = v.object({
  requiredName: v.string(),
  optionalCount: v.optional(v.integer()),
  nested: v.object({
    requiredFlag: v.boolean(),
    optionalLabel: v.optional(v.string()),
  }),
});

type NestedValue = InferValidator<typeof nestedValidator>;

const completeNestedValue: NestedValue = {
  requiredName: 'sample',
  nested: { requiredFlag: true },
};
void completeNestedValue;

// @ts-expect-error Required object fields remain required after inference.
const missingRequiredField: NestedValue = { nested: { requiredFlag: true } };
void missingRequiredField;

// @ts-expect-error Required fields of nested objects remain required.
const missingNestedRequiredField: NestedValue = { requiredName: 'sample', nested: {} };
void missingNestedRequiredField;

// @ts-expect-error Optional fields retain their inner value type.
const invalidOptionalField: NestedValue = { requiredName: 'sample', optionalCount: 'one', nested: { requiredFlag: true } };
void invalidOptionalField;

const resourceMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  transitions: [],
});

resourceMembers.memberOf(membershipResource.arg('eventId'));
resourceMembers.hasRole(membershipResource.arg('eventId'), 'host');
// @ts-expect-error Resource-scoped predicates require an explicit resource.
resourceMembers.memberOf();
// @ts-expect-error The first resource-scoped hasRole argument is not a role.
resourceMembers.hasRole('host');
// @ts-expect-error The declaration's closed role union excludes viewer.
resourceMembers.hasRole(membershipResource.arg('eventId'), 'viewer');

const profiledMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  displayName: v.string(),
}).membership({
  id: 'profiledMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  transitions: [],
}).authorityProfile({
  name: 'profiledMembers',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role', 'displayName'] },
});
void profiledMembers;

defineTable({ eventId: v.id('events'), userId: v.principal(), role: v.string() })
  .membership({
    id: 'invalidProfile',
    principal: 'userId',
    resource: 'eventId',
    role: 'role',
    roles: ['owner', 'member'],
    pendingRoles: ['invited'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    transitions: [],
  })
  .authorityProfile({
    name: 'invalidProfile',
    hierarchy: {
      owner: ['member'],
      // @ts-expect-error Pending statuses cannot participate in the active-role lattice.
      invited: [],
    },
    roster: { visible: ['userId'] },
  });

defineTable({ eventId: v.id('events'), userId: v.principal(), role: v.string() })
  .membership({
    id: 'invalidRoster',
    principal: 'userId',
    resource: 'eventId',
    role: 'role',
    roles: ['owner', 'member'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    transitions: [],
  })
  .authorityProfile({
    name: 'invalidRoster',
    hierarchy: { owner: ['member'], member: [] },
    // @ts-expect-error Roster projections may name only fields on the membership table.
    roster: { visible: ['missingField'] },
  });

defineTable({ title: v.string() }).visibility({ kind: 'public-read' });
defineTable({ ownerId: v.principal(), title: v.string() })
  .visibility(owner('ownerId'));
defineTable({ eventId: v.id('events'), title: v.string() }).visibility({
  kind: 'membership',
  declaration: resourceMembers,
  resourceField: 'eventId',
  roles: ['host'],
});
defineTable({ ownerId: v.principal(), eventId: v.id('events'), title: v.string() })
  .visibility(anyOf([
    owner('ownerId'),
    {
      kind: 'membership',
      declaration: resourceMembers,
      resourceField: 'eventId',
      roles: ['guest'],
    },
  ]));
// @ts-expect-error anyOf membership resourceField must name a declared field.
defineTable({ ownerId: v.principal(), eventId: v.id('events') }).visibility(anyOf([
  owner('ownerId'),
  {
    kind: 'membership',
    declaration: resourceMembers,
    resourceField: 'missingEvent',
    roles: ['guest'],
  },
]));
defineTable({ ownerId: v.principal() }).visibility({
  kind: 'owner',
  // @ts-expect-error owner visibility must name a declared table field.
  field: 'missingOwner',
});

const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).membership({
  scope: 'app',
  principal: 'userId',
  role: 'role',
  roles: ['member', 'admin'],
  transitions: [],
});

appMembers.memberOf();
appMembers.memberOf(membershipResource.app());
appMembers.hasRole('member');
appMembers.hasRole(membershipResource.app(), 'admin');
// @ts-expect-error App-scoped predicates reject argument resources.
appMembers.memberOf(membershipResource.arg('eventId'));

const invalidAppSpec: AppMembershipSpec = {
  scope: 'app',
  principal: 'userId',
  role: 'role',
  roles: ['member'],
  transitions: [],
  // @ts-expect-error App scope has no resource-creation bootstrap witness.
  bootstrapRole: 'member',
};
void invalidAppSpec;
