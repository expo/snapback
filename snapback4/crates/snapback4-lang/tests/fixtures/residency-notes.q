table likes:
  postId: id
  owner: principal
  by byPost: postId, id
  cap 1000 by postId
  public 'likes are public'
  insert <- allow
  sync

maintain likeCounts: count likes by postId
  read <- allow

mutation like(postId: id):
  total = likeCounts[postId]
  insert likes { postId, owner: viewer }
  return total

mutation createPost(postId: id):
  return likeCounts[postId]

mutation repost(postId: id):
  return likeCounts[postId]
