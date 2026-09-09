table profiles:
  principal: principal
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
  digestPeriodMs: int
  replayMode: bool
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
  kind: enum('message', 'digest')
  chatId: conversations ?
  sender: principal ?
  preview: text <=80 ?
  messageId: messages ?
  periodStart: time ?
  periodEnd: time ?
  newFollowers: int ?
  newPostsInFollowing: int ?
  unreadMessages: int ?
  unreadChats: int ?
  public
  insert <- allow
  update <- deny
  delete <- deny

table follows:
  follower: principal
  followed: principal
  periodStart: time
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, followed
  cap 500 by follower
  public
  insert <- allow
  update <- deny
  delete <- allow

table digestFollows:
  follower: principal
  followed: principal
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, followed
  cap 500 by follower
  public
  insert <- allow
  update <- deny
  delete <- allow

table posts:
  author: principal
  isReply: bool
  periodStart: time
  public
  insert <- allow
  update <- deny
  delete <- allow

table postPeriodCounters:
  author: principal
  isReply: bool
  periodStart: time
  total: int
  unique byAuthorReplyPeriod: author, isReply, periodStart
  public
  insert <- allow
  update <- allow
  delete <- deny

table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 100 by principal
  public
  insert <- allow
  update <- deny
  delete <- allow

table pendingRead:
  messageId: messages
  recipient: principal
  conversationId: conversations
  periodStart: time
  unique byMessageRecipient: messageId, recipient
  by byRecipientConversation: recipient, conversationId, messageId
  cap 50 by recipient, conversationId
  public
  insert <- allow
  update <- deny
  delete <- allow

table digestPostScratch:
  total: int
  public
  insert <- allow
  update <- allow
  delete <- allow

table digestUnreadScratch:
  packed: int
  public
  insert <- allow
  update <- allow
  delete <- allow

table digests:
  principal: principal
  periodStart: time
  periodEnd: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  unique byPrincipalPeriod: principal, periodStart
  public
  insert <- allow
  update <- deny
  delete <- deny

maintain newFollowerPeriodCounts: count follows by followed, periodStart
  read <- allow

maintain pendingReadPeriodByChat: count pendingRead by recipient, conversationId, periodStart
  read <- allow
