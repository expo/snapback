use identity guests
use personas alice
table posts:
 authorId: principal
 immutable authorId
 read <- allow
 insert <- .authorId = viewer
 sync public
table likes:
 postId: posts
 principal: principal
 immutable postId
 read <- allow
 insert <- .principal = viewer
 sync public
mutation like(postId: posts):
 insert likes {postId, principal: viewer}
query posts():
 return posts first 10
query likes():
 return likes first 10
