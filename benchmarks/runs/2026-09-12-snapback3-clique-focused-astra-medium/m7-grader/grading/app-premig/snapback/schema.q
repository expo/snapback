use identity password

table profiles:
  owner: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  unique byOwner: owner
  unique byHandle: handle
  read <- allow
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- deny

table conversations:
  messageCount: int ?
  name: text <=100
  kind: text <=10
  owner: principal
  read <- exists members[conversationId=.id, userId=viewer]
  insert <- .owner = viewer
  update (old, next) <- old.owner = next.owner and old.name = next.name and old.kind = next.kind and exists members[conversationId=old.id, userId=viewer]
  delete <- deny

table members:
  addedBy: principal
  conversationId: conversations
  userId: principal
  unique byPair: conversationId, userId
  by byUser: userId, conversationId, id
  read <- .userId = viewer or exists members[conversationId=.conversationId, userId=viewer]
  insert <- .addedBy = viewer
  update <- deny
  delete <- deny

table messages:
  type: text <=10 ?
  conversationId: conversations
  senderId: principal
  text: text 1..1000
  serverTimestamp: time
  replyTo: messages ?
  edited: bool
  tombstone: bool
  by byVisible: conversationId, tombstone, serverTimestamp, id
  by byConversation: conversationId, serverTimestamp, id
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .senderId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.senderId = viewer and next.senderId = viewer and old.conversationId = next.conversationId
  delete <- deny

table reads:
  conversationId: conversations
  userId: principal
  viewedThrough: time ?
  fetchedThrough: time
  unique byPair: conversationId, userId
  by byConversation: conversationId, userId
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .userId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.userId = viewer and next.userId = viewer and old.conversationId = next.conversationId
  delete <- deny

table reactions:
  messageId: messages
  conversationId: conversations
  userId: principal
  emoji: text 1..16
  unique byActor: messageId, userId
  unique byOwn: messageId, userId, emoji
  by byScope: conversationId, messageId, id
  by byMessage: messageId, userId
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .userId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.userId = viewer and next.userId = viewer and old.messageId = next.messageId and old.conversationId = next.conversationId
  delete <- .userId = viewer

table posts:
  authorId: principal
  text: text 1..1000
  parentId: posts ?
  parentAuthor: principal ?
  serverTimestamp: time
  day: int
  by byAuthor: authorId, id
  by byParentAuthor: parentAuthor, id
  by byDay: authorId, day, id
  read <- allow
  insert <- .authorId = viewer
  update <- deny
  delete <- deny

table follows:
  userId: principal
  targetId: principal
  unique byPair: userId, targetId
  by byTarget: targetId, id
  by byUser: userId, id
  read <- allow
  insert <- .userId = viewer
  update <- deny
  delete <- .userId = viewer

table likes:
  day: int ?
  by byDay: authorId, day, id
  userId: principal
  postId: posts
  authorId: principal
  unique byPair: userId, postId
  by byAuthor: authorId, id
  read <- allow
  insert <- .userId = viewer
  update <- deny
  delete <- .userId = viewer

table reposts:
  userId: principal
  postId: posts
  authorId: principal
  unique byPair: userId, postId
  by byAuthor: authorId, id
  read <- allow
  insert <- .userId = viewer
  update <- deny
  delete <- .userId = viewer

table polls:
  messageId: messages
  conversationId: conversations
  question: text 1..200
  optionA: text 1..50
  optionB: text 1..50
  optionC: text 1..50 ?
  optionD: text 1..50 ?
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- exists members[conversationId=.conversationId, userId=viewer]
  update <- deny
  delete <- deny

table votes:
  pollId: polls
  conversationId: conversations
  userId: principal
  optionId: text 1..1
  unique byActor: pollId, userId
  by byPoll: conversationId, pollId, optionId, id
  read <- exists members[conversationId=.conversationId, userId=viewer]
  insert <- .userId = viewer and exists members[conversationId=.conversationId, userId=viewer]
  update (old, next) <- old.userId = viewer and next.userId = viewer and old.pollId = next.pollId and old.conversationId = next.conversationId
  delete <- deny

maintain pollTallies: count votes by conversationId, pollId, optionId
  read <- exists members[conversationId=.conversationId, userId=viewer]
