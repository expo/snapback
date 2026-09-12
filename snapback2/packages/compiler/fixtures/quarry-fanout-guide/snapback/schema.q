use identity

table posts:
  author: principal
  body: text <=500
  period: int
  at: time
  images: [image <=10000000] <=4 ?
  clip: video <=50000000 ?
  by byAuthorTime: author, at, id
  public
  insert <- .author = viewer

table postHeads:
  post: posts
  author: principal
  at: time
  unique byPost: post
  by byAuthorTime: author, at, id
  immutable post, author, at
  public
  insert <- .author = viewer
  delete <- .author = viewer

table follows:
  follower: principal
  followed: principal
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, id
  public
  insert <- .follower = viewer
  delete <- .follower = viewer

table digests:
  target: principal
  period: int
  newPostsInFollowing: int
  unique byTargetPeriod: target, period
  read <- .target = viewer
  insert <- deny
  update <- deny

maintain periodPosts: count posts by author, period
  read <- allow


table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatarUrl: text <=2048 format url ?
  avatar: image <=10000000 ?
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  unique byPrincipal: principal
  unique byHandle: handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny


table conversations:
  messageCount: int
  title: text <=120
  description: text <=200 ?
  kind: enum('dm', 'group') ?
  pairLo: principal ?
  pairHi: principal ?
  creatorId: principal
  latestMessage: messages ?
  accent: text <=7 ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') ?
  ttlMs: int ?
  by byCreator: creatorId
  unique byIdCreator: id, creatorId
  by byPair: pairLo, pairHi, id
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']


table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- (
    exists memberships[.conversationId, viewer, 'admin']
    or (
      .principal = viewer
      and .role = 'admin'
      and created conversations[.conversationId, viewer]
    )
  )
  update (old, next) <- (
    exists memberships[old.conversationId, viewer, 'admin']
    and old.role = 'member'
    and next.role = 'admin'
  )
  delete <- (
    .principal = viewer
    or exists memberships[.conversationId, viewer, 'admin']
  )


table messages:
  period: time ?
  digestEligible: bool ?
  conversationId: conversations
  authorId: principal
  pollOptions: [text 1..50] <=4 ?
  body: text <=2000 ?
  quoteId: messages ?
  photo: image <=10000000 ?
  clip: video <=50000000 ?
  hasOnce: bool ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  editedAt: time ?
  deleted: bool ?
  at: time
  by byConvTime: conversationId, at, id
  by bySearch: conversationId, wordPrefixes(body), at, id
  immutable conversationId, authorId
  deliver to memberships[.conversationId] as deliveries with receipts
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- (
    .authorId = viewer
    and exists memberships[.conversationId, viewer]
  )
  update <- .authorId = viewer
  delete <- .authorId = viewer


table reactions:
  messageId: messages
  actor: principal
  emoji: text <=40
  unique byMessageActor: messageId, actor
  by byMessage: messageId, id
  cap 50 by messageId
  read <- exists messages[.messageId]
  insert <- .actor = viewer and exists messages[.messageId]
  update <- .actor = viewer and exists messages[.messageId]
  delete <- .actor = viewer and exists messages[.messageId]


table readMarks:
  conversationId: conversations
  actor: principal
  readAt: time
  unique byConversationActor: conversationId, actor
  read <- exists memberships[.conversationId, viewer]
  insert <- .actor = viewer and exists memberships[.conversationId, viewer]
  update <- .actor = viewer and exists memberships[.conversationId, viewer]
  delete <- deny

table directory:
  handle: text <=20
  normalized: text <=50 ?
  public
  update <- allow
