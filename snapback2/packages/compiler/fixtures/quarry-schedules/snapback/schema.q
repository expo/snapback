table profiles:
  handle: text <=20
  newFollowers: int
  unreadMessages: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table messages:
  body: text <=200 ?
  expiresAt: time ?
  public
  insert <- allow
  update <- allow
  delete <- allow
