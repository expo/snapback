use identity

table posts:
  author: principal
  body: text <=500
  period: int
  at: time
  by byAuthorTime: author, at, id
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

table conversations:
  title: text <=50
  public

table memberships:
  conversation: conversations
  principal: principal
  unique byConversationPrincipal: conversation, principal
  by byPrincipalConversation: principal, conversation, id
  cap 50 by conversation
  read <- exists memberships[.conversation, viewer]

table messages:
  conversation: conversations
  author: principal
  body: text <=500
  at: time
  by byConversationTime: conversation, at, id
  by bySearch: conversation, wordPrefixes(body), at, id
  read <- exists memberships[.conversation, viewer]

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

table directory:
  handle: text <=20
  normalized: text <=50 ?
  public
  update <- allow
