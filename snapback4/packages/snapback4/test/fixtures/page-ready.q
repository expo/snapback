use identity password
table profiles:
  principal: principal
  handle: text <=40
  unique principal
  unique handle
  public
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public
mutation saveProfile(handle: text <=40):
  upsert profiles[principal = viewer] { principal: viewer, handle }
query profile(handle: text <=40):
  return profiles[handle = handle]
table chats:
  owner: principal
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
  retain delivered-history
  sync to members[.id]
table members:
  chat: chats
  principal: principal
  at: time
  readAt: time default 0
  unique chat, principal
  immutable chat, principal, at
  read <- exists members[.chat, viewer]
  insert <- created chats[.chat]
  update <- .principal = viewer
  retain delivered-history
  sync to members[.chat]
table messages:
  chat: chats
  sender: principal
  body: text <=100
  at: time
  immutable chat, sender, at
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  retain delivered-history
  sync to members[.chat] last 2 by .at
mutation startDM(other: principal): server
  chat = insert chats { owner: viewer }
  insert members { chat: chat.id, principal: viewer, at: now }
  insert members { chat: chat.id, principal: other, at: now }
  return chat.id
mutation send(chat: chats, body: text <=100): server
  insert messages { chat, sender: viewer, body, at: now }
mutation markRead(chat: chats):
  update members[chat, viewer] { readAt: now }
query history(chat: chats, c: cursor ?):
  return messages where .chat = chat last 50 by .at after c { *, senderProfile: profiles[principal = .sender] }
fn unread(m: members):
  return count(messages where .chat = m.chat and .sender != viewer and .at > m.readAt)
query inbox(c: cursor ?):
  return members where .principal = viewer last 50 by .at after c { *, unread: unread(.) }
table online:
  public
  online only
query ping():
  return online first 1
query absent():
  return profiles[handle = 'absent']
query totalList(chat: chats):
  return [count(messages where .chat = chat)]
table controls:
  owner: principal
  grow: bool
  unique owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation setCost(grow: bool): server
  upsert controls[owner = viewer] { owner: viewer, grow }
query costly():
  control = controls[owner = viewer]
  text = ''
  for n in range(0, 10000 if control.grow = true else 1):
    text = text + 'an allocation that stays bounded by the heap meter'
  return [text]
