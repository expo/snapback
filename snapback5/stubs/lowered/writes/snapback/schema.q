-- LLP 4001 §3.6: matched point writes and application refusals.
effect push
table posts:
  authorId: principal
  body: text <=500
  parentId: posts ?
  removed: bool default false
  immutable authorId, parentId
  public
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- .authorId = viewer
table likes:
  postId: posts
  principal: principal
  unique postId, principal
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
table counters:
  principal: principal
  n: int
  unique principal
  public
  insert <- allow
  update <- allow
mutation createPost(postId: id, body: text <=500, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, body } if absent
mutation upsertCounter(who: principal, value: int):
  upsert counters[principal = who] { n: value }
mutation edit(postId: posts, body: text <=500): server
  update posts[postId] { body }
mutation editIf(postId: posts, body: text <=500):
  update posts[postId] { body } if not .removed
mutation deletePost(postId: posts):
  delete posts[postId]
mutation requireOther(who: principal):
  require who != viewer else CANNOT_FOLLOW_SELF
  return true
mutation emitExample():
  emit push { principal: viewer } once [viewer, now]
mutation setLike(postId: posts, want: bool):
  if want:
    insert likes { postId, principal: viewer } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation presence(who: principal):
  if not exists connected[who]:
    emit push { principal: who }
