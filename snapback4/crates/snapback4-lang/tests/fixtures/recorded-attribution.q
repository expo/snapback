table posts:
  authorId: principal
  parentId: posts ?
  at: time
  until: time ?
  immutable authorId, parentId, at
  by byExpiry: until, id
  expire at .until
  read <- allow
  insert <- .authorId = viewer
  delete <- .authorId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time
  until: time ?
  note: text <=20 default ''
  immutable postId
  by byExpiry: until, id
  expire at .until
  read <- allow
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync public

maintain receivedLikes: count likes where true by postId.authorId
  read <- allow
maintain dailyLikes: count likes by postId.authorId, day(.at)
  read <- allow
maintain trend: count likes where postId.parentId = null by hour(postId.at), postId.at, postId
  read <- allow
maintain receivedReplies: count posts where .parentId != null by parentId.authorId
  read <- allow

mutation like(postId: posts, at: time, until: time ?):
  insert likes {postId, principal: viewer, at, until}
mutation edit(row: likes, note: text <=20):
  update likes[row] {note}
mutation unlike(row: likes):
  delete likes[row]
query received(authorId: principal ?):
  return receivedLikes[authorId]
query allLikes():
  return likes first 100 by byId
query answers():
  return {
    received: receivedLikes first 100 by byGroup,
    daily: dailyLikes first 100 by byGroup,
    trend: trend first 100 by byGroup,
    replies: receivedReplies first 100 by byGroup
  }
