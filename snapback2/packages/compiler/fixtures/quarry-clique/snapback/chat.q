-- Clique messaging regression surface: DMs, groups, messages, and receipts.

shape authorCard = { displayName, handle }

mutation startDm(other: users):
  peer = users[other]! else USER_NOT_FOUND
  require peer.principal != viewer else SELF_DM
  (lo, hi) = sorted(viewer, peer.principal)
  if exists dms[lo, hi]:
    existing = dms[lo, hi]! else DM_RACE
    return existing.conv
  else:
    cid = new
    insert conversations { id: cid, kind: 'dm', creator: viewer, createdAt: now, lastAt: now }
    insert dms { lo, hi, conv: cid }
    for principal in [viewer, peer.principal]:
      insert members { conv: cid, user: principal, role: 'member', joinedAt: now }
    for principal in [viewer, peer.principal]:
      insert inbox { user: principal, conv: cid, joinedAt: now }
    return cid

mutation createGroup(name: text <=50, description: text <=200 ?, invitees: [users] <=49):
  cid = new
  insert conversations { id: cid, kind: 'group', name, description, creator: viewer, createdAt: now, lastAt: now }
  insert members { conv: cid, user: viewer, role: 'admin', joinedAt: now }
  insert inbox { user: viewer, conv: cid, joinedAt: now }
  for u in invitees:
    person = users[u]! else USER_NOT_FOUND
    if person.principal != viewer:
      insert members { conv: cid, user: person.principal, role: 'member', joinedAt: now }
      insert inbox { user: person.principal, conv: cid, joinedAt: now }
  return cid

mutation addMember(c: conversations, u: users):
  conv = conversations[c]! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  person = users[u]! else USER_NOT_FOUND
  require not exists members[c, person.principal] else ALREADY_MEMBER
  insert members { conv: conv.id, user: person.principal, role: 'member', joinedAt: now }
  insert inbox { user: person.principal, conv: conv.id, joinedAt: now }
  return true

mutation removeMember(c: conversations, u: users):
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  person = users[u]! else USER_NOT_FOUND
  require person.principal != viewer else USE_LEAVE
  row = members[c, person.principal]! else NOT_A_MEMBER
  delete members[row.id]
  gone = inbox[person.principal, c]! else NO_INBOX
  delete inbox[gone.id]
  return true

mutation promoteAdmin(c: conversations, u: users):
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  person = users[u]! else USER_NOT_FOUND
  row = members[c, person.principal]! else NOT_A_MEMBER
  update members[row.id] { role: 'admin' }
  return true

mutation leaveGroup(c: conversations):
  conv = conversations[c]! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  row = members[c, viewer]! else NOT_MEMBER
  delete members[row.id]
  gone = inbox[viewer, c]! else NO_INBOX
  delete inbox[gone.id]
  return true

mutation send(c: conversations, body: text <=2000, quoted: messages ?, ord: int):
  require exists members[c, viewer] else NOT_MEMBER
  mid = new
  t = now
  insert messages { id: mid, conv: c, author: viewer, body, quoted, at: t, ord }
  update conversations[c] { lastAt: t }
  m = messages[mid]! else IMPOSSIBLE
  return m { id, at }

-- Receipt watermarks remain hand-kept and monotonic.
mutation markDelivered(c: conversations, upTo: time):
  m = members[c, viewer]! else NOT_MEMBER
  if m.lastDeliveredAt != null:
    if m.lastDeliveredAt >= upTo:
      return false
  update members[m.id] { lastDeliveredAt: upTo }
  return true

mutation markRead(c: conversations, upTo: time):
  m = members[c, viewer]! else NOT_MEMBER
  if m.lastReadAt != null:
    if m.lastReadAt >= upTo:
      return false
  if m.lastDeliveredAt != null:
    if m.lastDeliveredAt >= upTo:
      update members[m.id] { lastReadAt: upTo }
      return true
  update members[m.id] { lastReadAt: upTo, lastDeliveredAt: upTo }
  return true

query myConversations():
  return inbox[user = viewer] first 50 by byUserConv {
    conv,
    joinedAt,
    conversation: conversations[.conv] {
      *,
      creatorProfile: users[principal = .creator] authorCard,
    },
    peers: members[conv = .conv] first 2 by byConvUser {
      user,
      profile: users[principal = .user] authorCard,
    },
  }

query conversation(c: conversations):
  conv = conversations[c]! else NOT_FOUND
  return conv { *, creatorProfile: users[principal = .creator] authorCard }

query convMembers(c: conversations):
  return members[conv = c] first 50 by byConvUser {
    *,
    profile: users[principal = .user] authorCard,
  }

query chatThread(c: conversations, pageCursor: cursor ?):
  return messages[c] after pageCursor first 30 by byConvOrd {
    *,
    authorProfile: users[principal = .author] authorCard,
    quotedMsg: .quoted { id, body, author },
  }
