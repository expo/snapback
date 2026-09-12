from pathlib import Path
p=Path('snapback/schema.q');s=p.read_text()
s+='''
table posts:
  authorId: principal
  text: text 1..1000
  parentId: posts ?
  parentAuthor: principal ?
  serverTimestamp: time
  day: int
  by byAuthor: authorId, id
  by byParentAuthor: parentAuthor, id
  by byDay: authorId, day, id
  read <- allow
  insert <- .authorId = viewer
  update <- deny
  delete <- deny

table follows:
  userId: principal
  targetId: principal
  unique byPair: userId, targetId
  by byTarget: targetId, id
  by byUser: userId, id
  read <- allow
  insert <- .userId = viewer
  update <- deny
  delete <- .userId = viewer
'''
for name in ['likes','reposts']:
 s+=f'''
table {name}:
  userId: principal
  postId: posts
  authorId: principal
  unique byPair: userId, postId
  by byAuthor: authorId, id
  read <- allow
  insert <- .userId = viewer
  update <- deny
  delete <- .userId = viewer
'''
p.write_text(s)
s='''mutation post(id: posts, text: text 1..1000, parentId: posts ?):
  parent = posts[id=parentId]
  day = divmod(now, 86400000)
  insert posts { id: id, authorId: viewer, text: text, parentId: parentId, parentAuthor: parent.authorId, serverTimestamp: now, day: day.quotient }
  return posts[id=id]

mutation follow(targetId: principal):
  upsert follows[userId=viewer, targetId=targetId] { userId: viewer, targetId: targetId }
  return true
'''
for name in ['likes','reposts']:
 s+=f'''
mutation {name}(postId: posts, active: bool):
  post = posts[id=postId] ! else NOT_FOUND
  if active:
    upsert {name}[userId=viewer, postId=postId] {{ userId: viewer, postId: postId, authorId: post.authorId }}
  else:
    delete {name}[userId=viewer, postId=postId]
  return true
'''
s+='''
query insights(today: int):
  return { posts: count(posts[authorId=viewer] first 100 by byAuthor), likesReceived: count(likes[authorId=viewer] first 100 by byAuthor), repostsReceived: count(reposts[authorId=viewer] first 100 by byAuthor), repliesReceived: count(posts[parentAuthor=viewer] first 100 by byParentAuthor), followers: count(follows[targetId=viewer] first 100 by byTarget), following: count(follows[userId=viewer] first 100 by byUser), buckets: '''
s+='['+', '.join('{ day: today - '+str(i)+', posts: count(posts[authorId=viewer, day=today - '+str(i)+'] first 100 by byDay) }' for i in range(6,-1,-1))+'] }\n'
Path('snapback/social.q').write_text(s)
