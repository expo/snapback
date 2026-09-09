use identity

table posts:
  author: principal
  body: text <=100
  period: int
  by byAuthorTime: author, id
  public
  insert <- .author = viewer

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
