table posts:
  author: principal
  hourKey: int
  at: time
  by byHour: hourKey, at, id
  by byAuthor: author, at, id
  public 'posts'
  sync public

table likes:
  postId: posts
  postHour: int
  postAt: time
  public 'likes'
  sync public

maintain trend: count likes by postHour, postAt, postId
  read <- allow
  by byScore: postHour, value, id

query ranking(c: cursor ?):
  return merge trend after c last 10 by byScore where .postAt > now - 86400000:
    [h] for h in range(hour(now) - 24, hour(now) + 1)

query typedRanking(c: cursor ?):
  return merge trend after c last 10 by byScore where .postAt > now - 86400000:
    [5]
    [6]
    [7]
    [8]
    [9]
    [10]
    [11]
    [12]
    [13]
    [14]
    [15]
    [16]
    [17]
    [18]
    [19]
    [20]
    [21]
    [22]
    [23]
    [24]
    [25]
    [26]
    [27]
    [28]
    [29]

query ranged(start: int, end: int, c: cursor ?):
  return merge posts after c last 10 by byHour:
    [h] for h in range(start, end)

query inline(at: time, c: cursor ?):
  return merge posts after c last 10 by byHour:
    [h] for h in range(hour(at - 86400000), hour(at) + 1)

query bound(at: time, c: cursor ?):
  startHour = hour(at - 86400000)
  endHour = hour(at) + 1
  return merge posts after c last 10 by byHour:
    [h] for h in range(startHour, endHour)

query clockRange(delta: int, c: cursor ?):
  startHour = hour(now) - delta
  return merge posts after c last 10 by byHour:
    [h] for h in range(startHour, hour(now) + 1)

query byAuthors(authors: [principal] <=50, c: cursor ?):
  return merge posts after c last 20 by byAuthor:
    [a] for a in authors

query literalAuthors(c: cursor ?):
  return merge posts after c last 20 by byAuthor:
    ['dev:alice']
    ['dev:bob']

query listExpression(c: cursor ?):
  return merge posts after c last 20 by byAuthor:
    [a] for a in [viewer, viewer]

query alice(c: cursor ?):
  return merge posts after c last 20 by byAuthor:
    [viewer]
