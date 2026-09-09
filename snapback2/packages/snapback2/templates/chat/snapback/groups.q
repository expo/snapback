fn isAdmin from access

query mine(c: cursor ?):
  page = memberships[viewer] after c first 50 by byPrincipalConversation
  return page { conversationId, conversation: conversations[.conversationId] }

mutation groupCreate(title: text <=120, members: [principal] <=49):
  require count(members) >= 1 else GROUP_REQUIRES_MEMBER
  conversationId = new
  creatorMembershipId = new
  joinedAt = now
  insert conversations { id: conversationId, title, creatorId: viewer }
  insert memberships { id: creatorMembershipId, conversationId, principal: viewer, role: 'admin', joinedAt }
  for principal in members:
    require principal != viewer else CREATOR_ALREADY_ADMIN
    insert memberships { conversationId, principal, role: 'member', joinedAt }
  return { id: conversationId, creatorMembershipId }

mutation memberAdd(conversationId: conversations, principal: principal):
  require isAdmin(conversationId, viewer) else ADMIN_REQUIRED
  require principal != viewer else ADMIN_SELF_RESEAT
  require memberCounts[conversationId] < 50 else GROUP_FULL
  row = insert memberships { conversationId, principal, role: 'member', joinedAt: now }
  return { id: row.id }

mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require isAdmin(conversationId, viewer) else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  update memberships[membership] { role: 'admin' }
  return null

mutation memberRemove(conversationId: conversations, membershipId: memberships):
  require isAdmin(conversationId, viewer) else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.principal != viewer else ADMIN_SELF_REMOVE
  delete memberships[membership]
  return null

mutation memberLeave(conversationId: conversations, membershipId: memberships):
  membership = memberships[conversationId, viewer] ! else MEMBERSHIP_REQUIRED
  require membership.id = membershipId else MEMBERSHIP_SELF_REQUIRED
  delete memberships[membership]
  return null
