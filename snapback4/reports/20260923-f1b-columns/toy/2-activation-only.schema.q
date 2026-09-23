use personas alice

table posts:
  body: text <=5000
  at: time
  likeCount: count likes by postId
  by byTime: at, id
  public 'activation measurement parents'
  sync public last 100000 by byTime

table likes:
  postId: posts
  read <- deny
  online only

query one(id: posts):
  return posts[id]
