table profiles:
  handle: text <=20
  newFollowers: int
  unreadMessages: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table appSettings:
  key: text <=20
  disappear24hMs: int
  disappear7dMs: int
  unique byKey: key
  public
  insert <- allow
  update <- allow
  delete <- deny

table conversations:
  disappearing: enum('off', '24h', '7d')
  public
  insert <- allow
  update <- allow
  delete <- deny

table messages:
  conversationId: conversations
  author: principal
  body: text <=2000 ?
  photo: image <=10485760 ?
  clip: video <=52428800 ?
  oncePhoto: image <=10485760 once ?
  expiresAt: time ?
  public
  insert <- allow
  update <- allow
  delete <- allow

table pushLog:
  target: principal
  chatId: conversations
  sender: principal
  preview: text <=80
  unique byMessage: messageId
  messageId: messages
  public
  insert <- allow
  update <- deny
  delete <- deny
