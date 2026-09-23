table posts:
  at: time
  likeCount: count likes by postId
  selected: count likes where .active by postId
  total: sum likes of amount where .active by postId
  by byLikes: likeCount, at, id
  public
  insert <- allow
  delete <- allow
  online only
table likes:
  postId: posts ?
  active: bool
  amount: int
  public
  insert <- allow
  update <- allow
  delete <- allow
  online only
mutation post(id: id, at: time):
  return insert posts { id, at }
mutation like(id: id, postId: posts ?, active: bool, amount: int):
  insert likes { id, postId, active, amount }
mutation change(id: likes, postId: posts ?, active: bool, amount: int):
  update likes[id] { postId, active, amount }
mutation unlike(id: likes):
  delete likes[id]
mutation deletePost(id: posts):
  delete posts[id]
query postRow(id: posts):
  return posts[id]
query ranked(c: cursor ?):
  return posts after c last 2 by byLikes { id, at, likeCount }
