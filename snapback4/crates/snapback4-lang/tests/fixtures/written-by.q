table conversations:
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  sync to members[.id]
table members:
  conversationId: conversations
  principal: principal
  role: enum('admin', 'member') default 'member'
  readUpTo: int default 0 written by .principal
  unique conversationId, principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- created conversations[.conversationId] or exists members[conversationId = .conversationId, principal = viewer, role = 'admin']
  update <- exists members[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer
  sync to members[.conversationId]
mutation add(conversationId: conversations, principal: principal):
  return insert members { conversationId, principal }
mutation addMark(conversationId: conversations, principal: principal, readUpTo: int):
  return insert members { conversationId, principal, readUpTo }
mutation addIfAbsent(conversationId: conversations, principal: principal):
  return insert members { conversationId, principal } if absent
mutation put(conversationId: conversations, principal: principal):
  return upsert members[conversationId, principal] { role: 'member' }
mutation markRead(memberId: members, readUpTo: int) predicts:
  return update members[memberId] { readUpTo }
mutation admin(memberId: members):
  return update members[memberId] { role: 'member' }
mutation mixed(memberId: members, readUpTo: int):
  return update members[memberId] { role: 'member', readUpTo }
mutation checked(memberId: members, expected: int):
  return update members[memberId] { role: 'member' } if .readUpTo = expected
query one(memberId: members):
  return members[memberId]
query mark(memberId: members):
  return members[memberId].readUpTo
query page(conversationId: conversations, c: cursor ?):
  return members where .conversationId = conversationId after c first 1 by .id
query shaped(conversationId: conversations):
  return members where .conversationId = conversationId first 50 by .id { id, principal, readUpTo }
mutation createOwn(conversationId: conversations, readUpTo: int):
  insert conversations { id: conversationId, creator: viewer }
  return insert members { conversationId, principal: viewer, readUpTo }
