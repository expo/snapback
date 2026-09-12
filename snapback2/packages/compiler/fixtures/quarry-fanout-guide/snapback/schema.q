use identity

table posts:
  author: principal
  body: text <=500
  period: time
  at: time
  images: [image <=10000000] <=4 ?
  clip: video <=50000000 ?
  by byAuthorTime: author, at, id
  immutable author, period, at
  public
  insert <- .author = viewer
  update <- .author = viewer
  delete <- .author = viewer

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
  period: time ?
  digestEligible: bool ?
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, id
  immutable follower, followed, period, digestEligible
  public
  insert <- .follower = viewer
  delete <- .follower = viewer

table digests:
  target: principal
  period: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  unique byTargetPeriod: target, period
  read <- .target = viewer
  insert <- deny
  update <- deny

table digestLogs:
  target: principal
  period: time
  periodEnd: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  unique byTargetPeriod: target, period
  immutable target, period, periodEnd
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

maintain periodPosts: count posts by author, period
  read <- allow

maintain newFollowerPeriodCounts: count follows by followed, digestEligible, period
  read <- deny

table digestPeriodChanges:
  period: time
  immutable period
  read <- deny
  insert <- allow
  update <- deny
  delete <- deny

table digestRecipientChanges:
  target: principal
  immutable target
  read <- deny
  insert <- allow
  update <- deny
  delete <- deny

maintain digestPeriodVersions: count digestPeriodChanges by period
  read <- deny

maintain digestRecipientVersions: count digestRecipientChanges by target
  read <- deny

table digestRecipientPeriodChanges:
  target: principal
  period: time
  immutable target, period
  read <- deny
  insert <- allow
  update <- deny
  delete <- deny

maintain digestRecipientPeriodVersions: count digestRecipientPeriodChanges by target, period
  read <- deny

-- Persistent candidates prevent unrelated profiles from delaying one user's
-- closed-period digest. A relationship or unread event makes the recipient a
-- candidate; zero-activity periods still settle without an emission.
table digestTargets:
  target: principal
  unique byTarget: target
  immutable target
  read <- allow
  insert <- allow
  update <- deny
  delete <- deny

table digestPeriodTargets:
  target: principal
  period: time
  unique byTargetPeriod: target, period
  by byPeriod: period, id
  immutable target, period
  read <- allow
  insert <- allow
  update <- deny
  delete <- deny

table digestRuns:
  target: principal
  period: time
  periodEnd: time
  attempt: int
  periodRevision: int
  recipientRevision: int
  recipientPeriodRevision: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  lastUnreadConversation: conversations ?
  earliestExpiry: time ?
  retryAt: time ?
  status: enum('pending', 'done')
  unique byTargetPeriod: target, period
  immutable target, period, periodEnd
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny


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
  immutable conversationId, authorId, period, expiresAt, deleted, at
  deliver to memberships[.conversationId] as deliveries with receipts
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- (
    .authorId = viewer
    and exists memberships[.conversationId, viewer]
  )
  update <- .authorId = viewer
  delete <- .authorId = viewer

table periodUnread:
  messageId: messages
  sender: principal
  recipient: principal
  conversationId: conversations
  membershipId: memberships
  period: time
  sentAt: time
  expiresAt: time ?
  unique byMessageRecipient: messageId, recipient
  by byMessageSender: messageId, sender, recipient
  by byRecipientPeriodConversation: recipient, period, conversationId, id
  cap 50 by messageId
  immutable messageId, sender, recipient, conversationId, membershipId, period, sentAt, expiresAt
  read <- .recipient = viewer or .sender = viewer
  insert <- exists memberships[.conversationId, viewer]
  delete <- allow


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
