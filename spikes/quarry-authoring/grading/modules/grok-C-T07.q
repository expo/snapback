table users:
  name: text <=80

table clubs:
  name: text <=100

table members:
  club: clubs
  user: users
  joinedAt: time
  by club, joinedAt
  unique club, user

table posts:
  club: clubs
  author: users
  body: text <=4096
  at: time
  by club, at

table unseen:
  club: clubs
  user: users
  n: int
  unique club, user

mutation announce(clubId: clubs, body: text <=4096) -> posts:
  require exists members[clubId, viewer] else NOT_MEMBER
  for m in members[clubId] first 200:
    +~unseen[clubId, m.user] { n: (.n ?? 0) + 1 }
  +posts { club: clubId, author: viewer, body, at: now }
