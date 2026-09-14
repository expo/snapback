table chats:
  key: text 1..64
  admin: principal
  unique byKey: key
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow

table members:
  chatKey: text 1..64
  principal: principal
  unique byChatPrincipal: chatKey, principal
  read <- allow
  insert <- created chats[key = .chatKey] or exists chats[key = .chatKey, admin = viewer]

mutation add(chatKey: text 1..64, principal: principal):
  insert members { chatKey, principal }
query probe(chatKey: text 1..64, admin: principal):
  return exists chats[key = chatKey, admin = admin]
query get(chatKey: text 1..64, admin: principal):
  return chats[admin = admin, key = chatKey]
mutation bootstrap(chatKey: text 1..64):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer }
