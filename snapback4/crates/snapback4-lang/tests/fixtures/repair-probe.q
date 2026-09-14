table chats:
  key: text <=64
  admin: principal
  by byKey: key, id
  public 'directory'
table messages:
  chatKey: text <=64
  read <- exists chats[key = .chatKey, admin = viewer]
