query inbox(c: cursor ?):
  return members[userId=viewer] after c first 50 by byUser { id: .conversationId, name: conversations[id=.conversationId].name, kind: conversations[id=.conversationId].kind }

query unread(conversationId: conversations):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  state = reads[conversationId=conversationId, userId=viewer]
  return { viewedThrough: state.viewedThrough, recent: messages[conversationId=conversationId] last 200 by byConversation }

mutation create(id: conversations, other: principal, name: text <=100, kind: text <=10):
  insert conversations { id: id, name: name, kind: kind, owner: viewer, messageCount: 0 }
  insert members { addedBy: viewer, conversationId: id, userId: viewer }
  insert members { addedBy: viewer, conversationId: id, userId: other }
  return conversations[id=id]

mutation add(conversationId: conversations, userId: principal):
  require conversations[id=conversationId].owner = viewer else NOT_OWNER
  insert members { addedBy: viewer, conversationId: conversationId, userId: userId }
  return true

query unavailable(conversationId: conversations):
  require false else ANCILLARY_DENIED
  return { unread: 0 }

query settings(conversationId: conversations):
  return conversations[id=conversationId]

mutation backfillCount(conversationId: conversations):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  require conversations[id=conversationId].messageCount = null else ALREADY_MIGRATED
  n = count(messages[conversationId=conversationId, tombstone=false] first 201 by byVisible)
  require n < 201 else BACKFILL_CHUNK_TOO_LARGE
  update conversations[id=conversationId] { messageCount: n }
  return conversations[id=conversationId]
