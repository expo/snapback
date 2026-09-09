use identity

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatarUrl: text <=2048 format url ?
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
  title: text <=120
  creatorId: principal
  by byCreator: creatorId
  unique byIdCreator: id, creatorId
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- deny
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
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  photo: image <=5000000 ?
  clip: video <=50000000 ?
  oncePhoto: image <=5000000 once ?
  expiresAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  by bySearch: conversationId, wordPrefixes(body), at, id
  immutable conversationId, authorId
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- (
    .authorId = viewer
    and exists memberships[.conversationId, viewer]
  )
  update <- .authorId = viewer
  delete <- .authorId = viewer

table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('message', 'edit', 'removed', 'expired')
  at: time
  by byRecipientAt: recipient, at, id
  by byRecipientConversationAt: recipient, conversationId, at, id
  by byRecipientConversationKindAt: recipient, conversationId, kind, at, id
  immutable recipient, conversationId, messageId, kind, at
  tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny

table posts:
  author: principal
  body: text 1..500
  at: time
  by byTime: at, id
  by byAuthorTime: author, at, id
  immutable author, at
  public 'posts are globally readable product content'
  insert <- .author = viewer
  update <- .author = viewer
  delete <- .author = viewer
  after insert <- exists profiles[.author]

table follows:
  follower: principal
  followed: principal
  at: time
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, followed
  by byFollowed: followed, follower
  immutable follower, followed, at
  public 'follows are public product-selection relationships'
  insert <- .follower = viewer
  update <- deny
  delete <- .follower = viewer

table notifications:
  outboxId: id
  effect: text <=100
  providerId: text <=200
  unique byOutbox: outboxId
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer]

channel typing(conversationId: conversations):
  value: { typing: bool }
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s

maintain memberCounts: count memberships by conversationId
  read <- exists memberships[.conversationId, viewer]
