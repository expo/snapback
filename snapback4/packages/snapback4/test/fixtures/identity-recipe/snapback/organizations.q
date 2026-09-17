-- B1d.2a managed organization and invitation policy. The sibling schema.q
-- remains the trusted-profile source; this module adds no provider action.

table organizations:
  owner: principal
  name: text 1..120
  seatLimit: int
  createdAt: time
  immutable owner, createdAt
  read <- exists organizationMemberships[.id, viewer] or viewer = 'service:worker'
  insert <- .owner = viewer
  update <- viewer = 'service:worker'
  delete <- deny

table organizationMemberships:
  organization: organizations
  principal: principal
  role: enum('admin', 'member')
  joinedAt: time
  sourceInvitation: invitations ?
  unique byOrganizationPrincipal: organization, principal
  by byOrganizationPrincipalRole: organization, principal, role
  by byOrganizationJoined: organization, joinedAt, id
  by byPrincipalOrganization: principal, organization, id
  immutable organization, principal, joinedAt, sourceInvitation
  read <- .principal = viewer or exists organizationMemberships[.organization, viewer]
  insert <- created organizations[id = .organization, owner = .principal] or (.principal = viewer and exists invitations[id = .sourceInvitation, organization = .organization, status = 'accepted', acceptedBy = viewer])
  update (old, next) <- exists organizations[id = old.organization, owner = viewer] and old.organization = next.organization and old.principal = next.principal
  delete <- .principal = viewer or exists organizationMemberships[.organization, viewer, 'admin']

table invitations:
  organization: organizations
  recipientEmail: text 1..320
  tokenHash: text 64..64
  issuer: principal
  issuedAt: time
  expiresAt: time
  status: enum('pending', 'accepted', 'revoked')
  acceptedBy: principal ?
  acceptedAt: time ?
  by byOrganizationIssued: organization, issuedAt, id
  immutable organization, recipientEmail, tokenHash, issuer, issuedAt, expiresAt
  read <- exists organizationMemberships[.organization, viewer, 'admin'] or exists oidcTrustedProfiles[principal = viewer, email = .recipientEmail, emailVerified = true]
  insert <- .issuer = viewer and .status = 'pending' and exists organizationMemberships[.organization, viewer, 'admin']
  update (old, next) <- (exists organizationMemberships[old.organization, viewer, 'admin'] and old.status = 'pending' and next.status = 'revoked' and next.acceptedBy = null and next.acceptedAt = null) or (exists oidcTrustedProfiles[principal = viewer, email = old.recipientEmail, emailVerified = true] and old.status = 'pending' and next.status = 'accepted' and next.acceptedBy = viewer and next.acceptedAt != null)
  delete <- deny

table invitationReservations:
  invitation: invitations
  organization: organizations
  recipientEmail: text 1..320
  expiresAt: time
  unique byInvitation: invitation
  unique byOrganizationRecipient: organization, recipientEmail
  by byExpiry: expiresAt
  expire at .expiresAt
  immutable invitation, organization, recipientEmail, expiresAt
  read <- exists organizationMemberships[.organization, viewer, 'admin'] or exists oidcTrustedProfiles[principal = viewer, email = .recipientEmail, emailVerified = true]
  insert <- exists invitations[id = .invitation, organization = .organization, recipientEmail = .recipientEmail, issuer = viewer, status = 'pending', expiresAt = .expiresAt]
  update <- deny
  delete <- exists organizationMemberships[.organization, viewer, 'admin'] or exists oidcTrustedProfiles[principal = viewer, email = .recipientEmail, emailVerified = true]

table organizationAudit:
  organization: organizations
  actor: principal
  event: enum('organization.created', 'invitation.recorded', 'invitation.accepted', 'invitation.revoked', 'member.role', 'member.removed', 'member.left', 'capacity.set')
  invitation: invitations ?
  member: principal ?
  at: time
  by byOrganizationAt: organization, at, id
  immutable organization, actor, event, invitation, member, at
  read <- exists organizationMemberships[.organization, viewer, 'admin']
  insert <- .actor = viewer and (viewer = 'service:worker' or exists organizationMemberships[.organization, viewer])
  update <- deny
  delete <- deny

table organizationPolicies:
  name: enum('managed')
  invitationLifetimeMs: int
  defaultSeatLimit: int
  unique byName: name
  immutable name
  read <- allow
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- deny

maintain organizationMemberCounts: count organizationMemberships by organization
  read <- exists organizationMemberships[.organization, viewer] or viewer = 'service:worker'
  online only

maintain organizationReservationCounts: count invitationReservations by organization
  read <- exists organizationMemberships[.organization, viewer, 'admin'] or viewer = 'service:worker'
  online only

query organizationPolicy():
  policy = organizationPolicies[name = 'managed']
  if policy = null:
    return { invitationLifetimeMs: 604800000, defaultSeatLimit: 5 }
  return { invitationLifetimeMs: policy.invitationLifetimeMs, defaultSeatLimit: policy.defaultSeatLimit }

query ownOrganizations(c: cursor ?):
  return organizationMemberships[viewer] after c first 100 by byPrincipalOrganization
    { membership: .id, role, joinedAt, sourceInvitation, organization: organizations[.organization] }

query memberRoster(organization: organizations, c: cursor ?):
  require exists organizationMemberships[organization, viewer] else ORGANIZATION_MEMBER_REQUIRED
  return organizationMemberships[organization] after c first 100 by byOrganizationJoined
    { id, principal, role, joinedAt, sourceInvitation }

query adminInvitations(organization: organizations, c: cursor ?):
  require exists organizationMemberships[organization, viewer, 'admin'] else ORGANIZATION_ADMIN_REQUIRED
  return invitations[organization] after c last 100 by byOrganizationIssued
    { id, organization, recipientEmail, issuer, issuedAt, expiresAt, status, acceptedBy, acceptedAt, reservation: invitationReservations[invitation = .id] }

query invitationMetadata(invitation: invitations):
  invite = invitations[invitation] ! else ORGANIZATION_INVITATION_NOT_FOUND
  return { id: invite.id, organization: invite.organization, recipientEmail: invite.recipientEmail, issuer: invite.issuer, issuedAt: invite.issuedAt, expiresAt: invite.expiresAt, status: invite.status, acceptedBy: invite.acceptedBy, acceptedAt: invite.acceptedAt, reservation: invitationReservations[invitation = invite.id] }

query invitePreview(invitation: invitations, rawToken: text 1..1024):
  invite = invitations[invitation] ! else ORGANIZATION_INVITATION_NOT_FOUND
  require invite.status = 'pending' else ORGANIZATION_INVITATION_NOT_PENDING
  require invite.expiresAt > now else ORGANIZATION_INVITATION_EXPIRED
  require sha256(rawToken) = invite.tokenHash else ORGANIZATION_INVITATION_TOKEN
  profile = oidcTrustedProfiles[viewer] ! else ORGANIZATION_PROFILE_REQUIRED
  require profile.email != null and profile.emailVerified = true and profile.email = invite.recipientEmail else ORGANIZATION_RECIPIENT_REQUIRED
  require profile.proofExpiresAt > now else ORGANIZATION_PROFILE_STALE
  return { id: invite.id, organization: invite.organization, recipientEmail: invite.recipientEmail, issuer: invite.issuer, issuedAt: invite.issuedAt, expiresAt: invite.expiresAt }

query adminAudit(organization: organizations, c: cursor ?):
  require exists organizationMemberships[organization, viewer, 'admin'] else ORGANIZATION_ADMIN_REQUIRED
  return organizationAudit[organization] after c last 100 by byOrganizationAt

mutation organizationSetPolicy(invitationLifetimeMs: int, defaultSeatLimit: int):
  require viewer = 'service:worker' else ORGANIZATION_SERVICE_REQUIRED
  require invitationLifetimeMs >= 100 and invitationLifetimeMs <= 2592000000 else ORGANIZATION_INVITATION_LIFETIME
  require defaultSeatLimit >= 1 and defaultSeatLimit <= 1000000 else ORGANIZATION_SEAT_LIMIT
  return upsert organizationPolicies[name = 'managed'] { invitationLifetimeMs, defaultSeatLimit }

mutation organizationCreate(name: text 1..120):
  profile = oidcTrustedProfiles[viewer] ! else ORGANIZATION_PROFILE_REQUIRED
  require profile.email != null and profile.emailVerified = true else ORGANIZATION_VERIFIED_EMAIL_REQUIRED
  require profile.proofExpiresAt > now else ORGANIZATION_PROFILE_STALE
  policy = organizationPolicies[name = 'managed']
  seatLimit = policy.defaultSeatLimit if policy != null else 5
  org = insert organizations { owner: viewer, name, seatLimit, createdAt: now }
  insert organizationMemberships { organization: org.id, principal: viewer, role: 'admin', joinedAt: now, sourceInvitation: null }
  insert organizationAudit { organization: org.id, actor: viewer, event: 'organization.created', invitation: null, member: viewer, at: now }
  return org

mutation organizationRecordInvitation(id: id, organization: organizations, recipientEmail: text 1..320, tokenHash: text 64..64):
  org = organizations[organization] ! else ORGANIZATION_NOT_FOUND
  require exists organizationMemberships[organization, viewer, 'admin'] else ORGANIZATION_ADMIN_REQUIRED
  require trim(recipientEmail) = recipientEmail else ORGANIZATION_RECIPIENT_WHITESPACE
  require lower(tokenHash) = tokenHash else ORGANIZATION_TOKEN_HASH
  require not exists invitationReservations[organization = organization, recipientEmail = recipientEmail] else ORGANIZATION_RECIPIENT_RESERVED
  members = organizationMemberCounts[organization]
  reservations = organizationReservationCounts[organization]
  require members + reservations < org.seatLimit else ORGANIZATION_CAPACITY
  policy = organizationPolicies[name = 'managed']
  lifetime = policy.invitationLifetimeMs if policy != null else 604800000
  invite = insert invitations { id, organization, recipientEmail, tokenHash, issuer: viewer, issuedAt: now, expiresAt: now + lifetime, status: 'pending', acceptedBy: null, acceptedAt: null }
  insert invitationReservations { invitation: invite.id, organization, recipientEmail, expiresAt: invite.expiresAt }
  insert organizationAudit { organization, actor: viewer, event: 'invitation.recorded', invitation: invite.id, member: null, at: now }
  return invite

mutation organizationAcceptInvitation(invitation: invitations, rawToken: text 1..1024):
  invite = invitations[invitation] ! else ORGANIZATION_INVITATION_NOT_FOUND
  require invite.status = 'pending' else ORGANIZATION_INVITATION_NOT_PENDING
  require invite.expiresAt > now else ORGANIZATION_INVITATION_EXPIRED
  require sha256(rawToken) = invite.tokenHash else ORGANIZATION_INVITATION_TOKEN
  profile = oidcTrustedProfiles[viewer] ! else ORGANIZATION_PROFILE_REQUIRED
  require profile.email != null and profile.emailVerified = true and profile.email = invite.recipientEmail else ORGANIZATION_RECIPIENT_REQUIRED
  require profile.proofExpiresAt > now else ORGANIZATION_PROFILE_STALE
  existing = organizationMemberships[organization = invite.organization, principal = viewer]
  update invitations[invite.id] { status: 'accepted', acceptedBy: viewer, acceptedAt: now }
  reservation = invitationReservations[invitation = invite.id]
  if reservation != null:
    delete invitationReservations[reservation]
  if existing = null:
    insert organizationMemberships { organization: invite.organization, principal: viewer, role: 'member', joinedAt: now, sourceInvitation: invite.id }
    org = organizations[invite.organization] ! else ORGANIZATION_NOT_FOUND
    require organizationMemberCounts[invite.organization] <= org.seatLimit else ORGANIZATION_CAPACITY
  insert organizationAudit { organization: invite.organization, actor: viewer, event: 'invitation.accepted', invitation: invite.id, member: viewer, at: now }
  return invitations[invite.id]

mutation organizationRevokeInvitation(invitation: invitations):
  invite = invitations[invitation] ! else ORGANIZATION_INVITATION_NOT_FOUND
  require exists organizationMemberships[invite.organization, viewer, 'admin'] else ORGANIZATION_ADMIN_REQUIRED
  if invite.status = 'revoked':
    return invite
  require invite.status = 'pending' else ORGANIZATION_INVITATION_NOT_PENDING
  update invitations[invite.id] { status: 'revoked' }
  reservation = invitationReservations[invitation = invite.id]
  if reservation != null:
    delete invitationReservations[reservation]
  insert organizationAudit { organization: invite.organization, actor: viewer, event: 'invitation.revoked', invitation: invite.id, member: null, at: now }
  return invitations[invite.id]

mutation organizationSetMemberRole(organization: organizations, principal: principal, role: enum('admin', 'member')):
  org = organizations[organization] ! else ORGANIZATION_NOT_FOUND
  require org.owner = viewer else ORGANIZATION_OWNER_REQUIRED
  membership = organizationMemberships[organization, principal] ! else ORGANIZATION_MEMBER_REQUIRED
  require principal != org.owner else ORGANIZATION_OWNER_IMMUTABLE
  if membership.role = role:
    return membership
  update organizationMemberships[membership.id] { role }
  insert organizationAudit { organization, actor: viewer, event: 'member.role', invitation: null, member: principal, at: now }
  return organizationMemberships[membership.id]

mutation organizationRemoveMember(organization: organizations, principal: principal):
  org = organizations[organization] ! else ORGANIZATION_NOT_FOUND
  require exists organizationMemberships[organization, viewer, 'admin'] else ORGANIZATION_ADMIN_REQUIRED
  membership = organizationMemberships[organization, principal] ! else ORGANIZATION_MEMBER_REQUIRED
  require principal != org.owner else ORGANIZATION_OWNER_IMMUTABLE
  require membership.role = 'member' or org.owner = viewer else ORGANIZATION_ADMIN_PEER
  insert organizationAudit { organization, actor: viewer, event: 'member.removed', invitation: null, member: principal, at: now }
  delete organizationMemberships[membership.id]
  return null

mutation organizationLeave(organization: organizations):
  org = organizations[organization] ! else ORGANIZATION_NOT_FOUND
  membership = organizationMemberships[organization, viewer] ! else ORGANIZATION_MEMBER_REQUIRED
  require viewer != org.owner else ORGANIZATION_OWNER_IMMUTABLE
  insert organizationAudit { organization, actor: viewer, event: 'member.left', invitation: null, member: viewer, at: now }
  delete organizationMemberships[membership.id]
  return null

mutation organizationSetCapacity(organization: organizations, seatLimit: int):
  require viewer = 'service:worker' else ORGANIZATION_SERVICE_REQUIRED
  require seatLimit >= 1 and seatLimit <= 1000000 else ORGANIZATION_SEAT_LIMIT
  org = organizations[organization] ! else ORGANIZATION_NOT_FOUND
  update organizations[org.id] { seatLimit }
  insert organizationAudit { organization, actor: viewer, event: 'capacity.set', invitation: null, member: null, at: now }
  return organizations[org.id]
