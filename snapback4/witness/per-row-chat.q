-- Tables and three ChatRail reads copied from the read-only 0.4.7 comparative.
use personas alice, bob

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=2048 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by .handle

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  lastOrdinal: int default 0
  disappearing: enum('off', '24h', '7d') default 'off'
  accent: text <=16 ?
  background: image <=10000000 ?
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]

query membersOf(conversation: conversations):
  return members where .conversation = conversation first 50 by .principal { *, profile: profiles[principal = .principal] }

query profileByPrincipal(owner: principal):
  return profiles[principal = owner]

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

mutation edit(id: conversations, label: text 1..50):
  update profiles[principal = viewer] { displayName: label }
table notes:
  owner: principal
  body: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation unrelated():
  insert notes { owner: viewer, body: 'unrelated' }
query point(id: conversations):
  return conversations[id]
