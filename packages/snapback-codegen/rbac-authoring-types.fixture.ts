import {
  membershipResource,
  type AppMembershipSpec,
  defineTable,
  v,
} from '@snapback/codegen/define';

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
