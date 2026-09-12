from pathlib import Path
p=Path('snapback/schema.q')
s=p.read_text()
s+='''
table conversations:
  name: text <=100
  kind: text <=10
  owner: principal
  read <- exists members[conversationId=.id, userId=viewer]
  insert <- .owner = viewer
  update <- deny
  delete <- deny

table members:
  conversationId: conversations
  userId: principal
  unique byPair: conversationId, userId
  index byUser: userId, conversationId
  read <- .userId = viewer or exists members[conversationId=.conversationId, userId=viewer]
  insert <- exists conversations[id=.conversationId] and conversations[id=.conversationId].owner = viewer
  update <- deny
  delete <- deny

table messages:
  conversationId: conversations
  senderId: principal
  text: text 1..4000
  serverTimestamp: time
  replyTo: messages ?
  edited: bool
  tombstone: bool
  index byConversation: conversationId, serverTimestamp
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .senderId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.senderId = viewer and next.senderId = viewer and old.conversationId = next.conversationId
  delete <- deny

table reads:
  conversationId: conversations
  userId: principal
  viewedThrough: time
  fetchedThrough: time
  unique byPair: conversationId, userId
  index byConversation: conversationId, userId
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .userId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.userId = viewer and next.userId = viewer and old.conversationId = next.conversationId
  delete <- deny

table reactions:
  messageId: messages
  conversationId: conversations
  userId: principal
  emoji: text 1..16
  unique byOwn: messageId, userId, emoji
  index byMessage: messageId, userId
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .userId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update <- deny
  delete <- .userId = viewer
'''
p.write_text(s)
Path('snapback/conversations.q').write_text('''query inbox(c: cursor ?):
  return members[userId=viewer] after c first 50 by byUser { id: .conversationId, name: conversations[id=.conversationId].name, kind: conversations[id=.conversationId].kind }

query unread(conversationId: conversations):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  state = reads[conversationId=conversationId, userId=viewer]
  return { viewedThrough: state.viewedThrough, latest: messages[conversationId=conversationId] last 1 by byConversation }

mutation create(id: conversations, other: principal, name: text <=100, kind: text <=10):
  insert conversations { id: id, name: name, kind: kind, owner: viewer }
  insert members { conversationId: id, userId: viewer }
  insert members { conversationId: id, userId: other }
  return conversations[id=id]

mutation add(conversationId: conversations, userId: principal):
  require conversations[id=conversationId].owner = viewer else NOT_OWNER
  insert members { conversationId: conversationId, userId: userId }
  return true
''')
Path('snapback/messages.q').write_text('''query page(conversationId: conversations, c: cursor ?):
  return messages[conversationId=conversationId] after c first 200 by byConversation

query latest(conversationId: conversations):
  return messages[conversationId=conversationId] last 1 by byConversation

query reactions(messageId: messages):
  return reactions[messageId=messageId] first 100 by byMessage

query receipts(conversationId: conversations):
  return reads[conversationId=conversationId] first 100 by byConversation

mutation send(id: messages, conversationId: conversations, text: text 1..4000, replyTo: messages ?):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  if replyTo != null:
    require messages[id=replyTo].conversationId = conversationId else BAD_QUOTE
  insert messages { id: id, conversationId: conversationId, senderId: viewer, text: text, serverTimestamp: now, replyTo: replyTo, edited: false, tombstone: false }
  return messages[id=id]

mutation fetched(conversationId: conversations, through: time):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  old = reads[conversationId=conversationId, userId=viewer]
  upsert reads[conversationId=conversationId, userId=viewer] { conversationId: conversationId, userId: viewer, fetchedThrough: max(old.fetchedThrough ?? 0, through), viewedThrough: old.viewedThrough ?? 0 }
  return true

mutation viewed(conversationId: conversations, through: time):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  old = reads[conversationId=conversationId, userId=viewer]
  upsert reads[conversationId=conversationId, userId=viewer] { conversationId: conversationId, userId: viewer, fetchedThrough: max(old.fetchedThrough ?? 0, through), viewedThrough: max(old.viewedThrough ?? 0, through) }
  return true

mutation react(messageId: messages, emoji: text 1..16, active: bool):
  message = messages[id=messageId] ! else NOT_FOUND
  require exists members[conversationId=message.conversationId, userId=viewer] else NOT_MEMBER
  if active:
    upsert reactions[messageId=messageId, userId=viewer, emoji=emoji] { messageId: messageId, conversationId: message.conversationId, userId: viewer, emoji: emoji }
  else:
    delete reactions[messageId=messageId, userId=viewer, emoji=emoji]
  return true
''')
for f in ['scripts/server.mjs','src/client.tsx','scripts/seed.mjs']:
 p=Path(f);p.write_text(p.read_text().replace('54800','54900'))
