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
  insert r <- r.principal = viewer
  update r <- r.principal = viewer
  delete r <- deny

table conversations:
  title: text <=120
  creatorId: principal
  by byCreator: creatorId
  unique byIdCreator: id, creatorId
  read r <- exists memberships[r.id, viewer]
  insert r <- r.creatorId = viewer
  update r <- deny
  delete r <- deny
  after insert r <- exists memberships[r.id, r.creatorId, 'admin']

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId
  immutable conversationId, principal, joinedAt
  read r <- exists memberships[r.conversationId, viewer]
  insert r <- (
    exists memberships[r.conversationId, viewer, 'admin']
    or (
      r.principal = viewer
      and r.role = 'admin'
      and created conversations[r.conversationId, viewer]
    )
  )
  update (old, next) <- (
    exists memberships[old.conversationId, viewer, 'admin']
    and old.conversationId = next.conversationId
    and old.principal = next.principal
    and old.role = 'member'
    and next.role = 'admin'
  )
  delete r <- (
    r.principal = viewer
    or exists memberships[r.conversationId, viewer, 'admin']
  )

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read r <- exists memberships[r.conversationId, viewer]
  insert r <- (
    r.authorId = viewer
    and exists memberships[r.conversationId, viewer]
  )
  update r <- r.authorId = viewer
  delete r <- r.authorId = viewer

table posts:
  author: principal
  body: text 1..500
  at: time
  by byTime: at, id
  by byAuthorTime: author, at, id
  immutable author, at
  public 'posts are globally readable product content'
  insert r <- r.author = viewer
  update r <- r.author = viewer
  delete r <- r.author = viewer

table follows:
  follower: principal
  followed: principal
  at: time
  unique byFollowerFollowed: follower, followed
  by byFollower: follower, followed
  by byFollowed: followed, follower
  immutable follower, followed, at
  public 'follows are public product-selection relationships'
  insert r <- r.follower = viewer
  update r <- deny
  delete r <- r.follower = viewer

table notifications:
  outboxId: id
  effect: text <=100
  providerId: text <=200
  unique byOutbox: outboxId
  read r <- deny
  insert r <- system
  update r <- system
  delete r <- deny

maintain messageCounts = count messages by conversationId:
  read r <- exists memberships[r.conversationId, viewer]

channel typing(conversationId: conversations):
  publish <- exists memberships[conversationId, viewer]
  subscribe <- exists memberships[conversationId, viewer]
  ttl 4s
