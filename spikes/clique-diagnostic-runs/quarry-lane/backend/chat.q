-- Clique — messaging: DMs, groups, messages, receipts
-- NOTE the literal-list for-loops around paired inserts: two sequential
-- writes to the same table inside a branch arm are undercounted by the
-- certified write trace (E_TRACE_SUBSET at runtime), while loop writes are
-- counted correctly.

mutation startDm(other: users) -> id:
  require other != viewer else SELF_DM
  peer = users[other]! else USER_NOT_FOUND
  (lo, hi) = sorted(viewer, other)
  if exists dms[lo, hi]:
    existing = dms[lo, hi]! else DM_RACE
    existing.conv
  else:
    cid = new
    +conversations { id: cid, kind: 'dm', creator: viewer, createdAt: now, lastAt: now }
    +dms { lo, hi, conv: cid }
    for u in [viewer, other]:
      +members { conv: cid, user: u, role: 'member', joinedAt: now }
    for u in [viewer, other]:
      +inbox { user: u, conv: cid, joinedAt: now }
    cid

mutation createGroup(name: text <=50, description: text <=200 ?, invitees: [users] <=49) -> id:
  cid = new
  +conversations { id: cid, kind: 'group', name, description, creator: viewer, createdAt: now, lastAt: now }
  +members { conv: cid, user: viewer, role: 'admin', joinedAt: now }
  +inbox { user: viewer, conv: cid, joinedAt: now }
  for u in invitees:
    if u != viewer:
      +members { conv: cid, user: u, role: 'member', joinedAt: now }
      +inbox { user: u, conv: cid, joinedAt: now }
  cid

mutation addMember(c: conversations, u: users) -> bool:
  conv = conversations[c]! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  require not exists members[c, u] else ALREADY_MEMBER
  +members { conv: conv.id, user: u, role: 'member', joinedAt: now }
  +inbox { user: u, conv: conv.id, joinedAt: now }
  true

mutation removeMember(c: conversations, u: users) -> bool:
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  require u != viewer else USE_LEAVE
  row = members[c, u]! else NOT_A_MEMBER
  -members[row.id]
  gone = inbox[u, c]! else NO_INBOX
  -inbox[gone.id]
  true

mutation promoteAdmin(c: conversations, u: users) -> bool:
  me = members[c, viewer]! else NOT_MEMBER
  require me.role = 'admin' else NOT_ADMIN
  row = members[c, u]! else NOT_A_MEMBER
  ~members[row.id] { role: 'admin' }
  true

mutation leaveGroup(c: conversations) -> bool:
  conv = conversations[c]! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  row = members[c, viewer]! else NOT_MEMBER
  -members[row.id]
  gone = inbox[viewer, c]! else NO_INBOX
  -inbox[gone.id]
  true

mutation send(c: conversations, body: text <=2000, quoted: messages ?, ord: int) -> messages:
  require exists members[c, viewer] else NOT_MEMBER
  mid = new
  t = now
  +messages { id: mid, conv: c, author: viewer, body, quoted, at: t, ord }
  ~conversations[c] { lastAt: t }
  m = messages[mid]! else IMPOSSIBLE
  m { id, at }

-- Receipt watermarks, monotonic by construction: an absent watermark
-- compares false, so the else branch advances it; a newer watermark
-- refuses to move backwards. Read implies delivered.
mutation markDelivered(c: conversations, upTo: time) -> bool:
  m = members[c, viewer]! else NOT_MEMBER
  if m.lastDeliveredAt >= upTo:
    false
  else:
    ~members[m.id] { lastDeliveredAt: upTo }
    true

mutation markRead(c: conversations, upTo: time) -> bool:
  m = members[c, viewer]! else NOT_MEMBER
  if m.lastReadAt >= upTo:
    false
  else:
    if m.lastDeliveredAt >= upTo:
      ~members[m.id] { lastReadAt: upTo }
    else:
      ~members[m.id] { lastReadAt: upTo, lastDeliveredAt: upTo }
    true

query myConversations():
  inbox[user = viewer] first 50 by byUserConv {
    conv,
    joinedAt,
    conversation: conversations[.conv] {
      *,
      creatorProfile: .creator { displayName, handle },
    },
    peers: members[conv = .conv] first 2 by byConvUser {
      user,
      profile: users[.user] { displayName, handle },
    },
  }

query conversation(c: conversations):
  conv = conversations[c]! else NOT_FOUND
  conv { *, creatorProfile: .creator { displayName, handle } }

query convMembers(c: conversations):
  members[conv = c] first 50 by byConvUser {
    *,
    profile: users[.user] { displayName, handle },
  }

query chatThread(c: conversations):
  messages[c] first 30 by byConvOrd {
    *,
    authorProfile: .author { displayName, handle },
    quotedMsg: .quoted { id, body, author },
  }

query chatThreadBefore(c: conversations, cursor: int):
  messages[c] after cursor first 30 by byConvOrd {
    *,
    authorProfile: .author { displayName, handle },
    quotedMsg: .quoted { id, body, author },
  }
