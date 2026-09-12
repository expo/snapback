use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatar: image <=10000000 ?
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  unique byPrincipal: principal
  unique byHandle: handle
  by byNameSearch: wordPrefixes(displayName), id
  by byHandleSearch: wordPrefixes(handle), id
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny

table conversations:
  title: text 1..50
  kind: enum('dm', 'group') ?
  accent: text <=7 ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') ?
  description: text <=200 ?
  lo: principal ?
  hi: principal ?
  creatorId: principal
  by byCreator: creatorId
  unique byIdCreator: id, creatorId
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
  conversationId: conversations
  authorId: principal
  body: text <=2000 ?
  quoteId: messages ?
  tombstone: bool ?
  kind: enum('text', 'image', 'video') ?
  photo: image <=10000000 ?
  clip: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  viewOnce: bool ?
  expiresAt: time ?
  editedAt: time ?
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


table posts:
  author: principal
  body: text <=500
  images: [image <=10000000] <=4 ?
  clip: video <=50000000 ?
  parent: posts ?
  parentAuthor: principal ?
  day: int ?
  period: int ?
  at: time
  by byParentTime: parent, at, id
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

table feedHeads:
  owner: principal ?
  post: posts
  actor: principal
  repost: bool
  at: time
  unique byActorPost: actor, post, repost
  by byTime: at, id
  by byActorTime: actor, at, id
  immutable post, actor, repost, at
  public
  insert <- .actor = viewer
  update <- deny
  delete <- .actor = viewer

table likes:
  owner: principal ?
  day: int ?
  post: posts
  actor: principal
  at: time
  unique byPostActor: post, actor
  public
  insert <- .actor = viewer
  update <- deny
  delete <- .actor = viewer

maintain likeCounts: count likes by post
  read <- allow

maintain repostCounts: count feedHeads by post, repost
  read <- allow

maintain replyCounts: count posts by parent
  read <- allow

maintain followerCounts: count follows by followed
  read <- allow

maintain followingCounts: count follows by follower
  read <- allow

table intents:
  principal: principal
  key: id
  unique byPrincipalKey: principal, key
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- deny
  delete <- deny

table dmPairs:
  lo: principal
  hi: principal
  conversationId: conversations
  unique byPair: lo, hi
  read <- .lo = viewer or .hi = viewer
  insert <- .lo = viewer or .hi = viewer
  update <- deny
  delete <- deny

table readCursors:
  conversationId: conversations
  principal: principal
  readAt: time
  unique byConversationPrincipal: conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- deny

table reactions:
  message: messages
  conversationId: conversations
  actor: principal
  emoji: text 1..32
  unique byMessageActor: message, actor
  by byMessage: message, actor
  cap 50 by message
  read <- exists memberships[.conversationId, viewer]
  insert <- .actor = viewer and exists memberships[.conversationId, viewer]
  update <- .actor = viewer and exists memberships[.conversationId, viewer]
  delete <- .actor = viewer

table pushEvents:
  targetUserId: principal
  chatId: conversations ?
  senderDisplayName: text <=50 ?
  preview: text <=80 ?
  kind: enum('message', 'digest')
  payload: json <=2000 ?
  at: time
  by byTargetTime: targetUserId, at, id
  read <- .targetUserId = viewer
  insert <- exists memberships[.chatId, viewer]
  update <- deny
  delete <- deny

maintain postTotals: count posts by author
  read <- allow
maintain receivedLikes: count likes by owner
  read <- allow
maintain receivedReposts: count feedHeads by owner, repost
  read <- allow
maintain receivedReplies: count posts by parentAuthor
  read <- allow
maintain postDays: count posts by author, day
  read <- allow
maintain likedDays: count likes by owner, day
  read <- allow
maintain authorPeriods: count posts by author, period, parent
  read <- allow

table trendingPosts:
  post: posts
  author: principal
  score: int
  at: time
  expiresAt: time ?
  unique byPost: post
  by byRank: score, at, post
  public
  insert <- .author = viewer
  update <- exists profiles[viewer]
  delete <- deny

table digestClocks:
  nextAt: time ?
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table digestWork:
  principal: principal
  cutoff: time
  followers: int
  posts: int
  unreadMessages: int
  unreadChats: int
  unique byPrincipalCutoff: principal, cutoff
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table digestChats:
  principal: principal
  cutoff: time
  conversationId: conversations
  unique byPrincipalCutoffChat: principal, cutoff, conversationId
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

table digestReceipts:
  principal: principal
  cutoff: time
  unique byPrincipalCutoff: principal, cutoff
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
