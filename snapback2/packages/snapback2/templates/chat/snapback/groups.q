mutation groupCreate(title: text <=120, members: [principal] <=49):
  require count(members) >= 1 else GROUP_REQUIRES_MEMBER
  conversationId = new
  creatorMembershipId = new
  joinedAt = now
  +conversations { id: conversationId, title, creatorId: viewer }
  +memberships { id: creatorMembershipId, conversationId, principal: viewer, role: 'admin', joinedAt }
  for principal in members:
    require principal != viewer else CREATOR_ALREADY_ADMIN
    +memberships { conversationId, principal, role: 'member', joinedAt }
  return { id: conversationId, creatorMembershipId }

mutation memberAdd(conversationId: conversations, principal: principal):
  require exists memberships[conversationId, viewer, 'admin'] by byConversationPrincipalRole else ADMIN_REQUIRED
  require principal != viewer else ADMIN_SELF_RESEAT
  row = +memberships { conversationId, principal, role: 'member', joinedAt: now }
  return { id: row.id }

mutation memberPromote(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] by byConversationPrincipalRole else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.role = 'member' else MEMBER_REQUIRED
  ~memberships[membership] { role: 'admin' }
  return null

mutation memberRemove(conversationId: conversations, membershipId: memberships):
  require exists memberships[conversationId, viewer, 'admin'] by byConversationPrincipalRole else ADMIN_REQUIRED
  membership = memberships[membershipId] ! else MEMBERSHIP_REQUIRED
  require membership.conversationId = conversationId else MEMBERSHIP_SCOPE_REQUIRED
  require membership.principal != viewer else ADMIN_SELF_REMOVE
  -memberships[membership]
  return null

mutation memberLeave(conversationId: conversations, membershipId: memberships):
  membership = memberships[conversationId, viewer] by byConversationIdPrincipal ! else MEMBERSHIP_REQUIRED
  require membership.id = membershipId else MEMBERSHIP_SELF_REQUIRED
  -memberships[membership]
  return null
