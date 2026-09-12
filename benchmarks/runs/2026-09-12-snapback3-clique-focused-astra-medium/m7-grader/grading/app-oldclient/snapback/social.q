mutation post(id: posts, text: text 1..1000, parentId: posts ?):
  parent = posts[id=parentId]
  day = divmod(now, 86400000)
  insert posts { id: id, authorId: viewer, text: text, parentId: parentId, parentAuthor: parent.authorId, serverTimestamp: now, day: day.quotient }
  return posts[id=id]

mutation follow(targetId: principal):
  upsert follows[userId=viewer, targetId=targetId] { userId: viewer, targetId: targetId }
  return true

mutation likes(postId: posts, active: bool):
  day = divmod(now, 86400000)
  post = posts[id=postId] ! else NOT_FOUND
  if active:
    upsert likes[userId=viewer, postId=postId] { day: day.quotient, userId: viewer, postId: postId, authorId: post.authorId }
  else:
    delete likes[userId=viewer, postId=postId]
  return true

mutation reposts(postId: posts, active: bool):
  post = posts[id=postId] ! else NOT_FOUND
  if active:
    upsert reposts[userId=viewer, postId=postId] { userId: viewer, postId: postId, authorId: post.authorId }
  else:
    delete reposts[userId=viewer, postId=postId]
  return true

query insights(today: int):
  return { posts: count(posts[authorId=viewer] first 100 by byAuthor), likesReceived: count(likes[authorId=viewer] first 100 by byAuthor), repostsReceived: count(reposts[authorId=viewer] first 100 by byAuthor), repliesReceived: count(posts[parentAuthor=viewer] first 100 by byParentAuthor), followers: count(follows[targetId=viewer] first 100 by byTarget), following: count(follows[userId=viewer] first 100 by byUser), d0: count(posts[authorId=viewer, day=today - 0] first 100 by byDay), d1: count(posts[authorId=viewer, day=today - 1] first 100 by byDay), d2: count(posts[authorId=viewer, day=today - 2] first 100 by byDay), d3: count(posts[authorId=viewer, day=today - 3] first 100 by byDay), d4: count(posts[authorId=viewer, day=today - 4] first 100 by byDay), d5: count(posts[authorId=viewer, day=today - 5] first 100 by byDay), d6: count(posts[authorId=viewer, day=today - 6] first 100 by byDay) , l0: count(likes[authorId=viewer, day=today - 0] first 100 by byDay), l1: count(likes[authorId=viewer, day=today - 1] first 100 by byDay), l2: count(likes[authorId=viewer, day=today - 2] first 100 by byDay), l3: count(likes[authorId=viewer, day=today - 3] first 100 by byDay), l4: count(likes[authorId=viewer, day=today - 4] first 100 by byDay), l5: count(likes[authorId=viewer, day=today - 5] first 100 by byDay), l6: count(likes[authorId=viewer, day=today - 6] first 100 by byDay) }
