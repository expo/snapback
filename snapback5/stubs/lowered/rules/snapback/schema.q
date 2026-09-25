-- LLP 4001 §3.3: per-image policy composition and transaction probes.
table chats:
  owner: principal
  public
table members:
  chat: chats
  principal: principal
  role: enum('member', 'admin')
  leftAt: time ?
  unique chat, principal
  read <- .principal = viewer
  insert <- exists members[chat = .chat, principal = viewer, role = 'admin']
table messages:
  chat: chats
  sender: principal
  body: text
  immutable chat, sender
  read <- exists members[chat = .chat, principal = viewer, leftAt = null] or viewer = 'service:x'
  insert <- .sender = viewer and exists members[.chat, viewer]
  update <- .sender = viewer
table receipts:
  chat: chats
  message: messages
  principal: principal
  readAt: time default 0
  unique message, principal
  read <- .principal = viewer
  insert <- created messages[.message]
  update (old, next) <- (allow and allow) and old.principal = viewer and next.principal = viewer and next.principal = old.principal
  delete <- .principal = viewer
table allRules:
  owner: principal
  flag: bool
  read <- .owner = viewer and .flag = true
  insert <- .owner = viewer and .flag = true
  update (old, next) <- old.owner = viewer and next.owner = viewer and old.flag = true and next.flag = true
  delete <- .owner = viewer and .flag = true
table alternative:
  principal: principal
  message: messages
  immutable principal, message
  read <- .principal = viewer
  update (old, next) <- old.principal = viewer or exists messages[id = old.message, sender = viewer]
table createdChat:
  chat: chats
  insert <- created chats[.chat]
