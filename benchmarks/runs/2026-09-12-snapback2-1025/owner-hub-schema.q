-- Test-only population plan. The production app has no such table or job.
-- @ref LLP 1025.000#7-qualification — reach the hub envelope with bounded engine writes.
table hubPlan:
  conversationId: id
  hub: principal
  author: principal
  group: bool
  lo: principal
  hi: principal
  membershipId: id
  peerMembershipId: id
  messageId: id
  immutable conversationId, hub, author, group, lo, hi, membershipId, peerMembershipId, messageId
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
