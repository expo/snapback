import {
  membershipResource,
  type AppMembershipSpec,
  type InferValidator,
  defineTable,
  v,
} from '@snapback/codegen/define';

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
