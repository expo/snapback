table users:
  name: text <=80

table clubs:
  name: text <=100

table members:
  club: clubs
  user: users
  joinedAt: time
  by byClubJoinedAt: club, joinedAt
  unique byClubUser: club, user

table posts:
  club: clubs
  author: users
  body: text <=4096
  at: time
  by byClubAt: club, at

table unseen:
  club: clubs
  user: users
  n: int
  unique byClubUser: club, user

mutation announce(clubId: clubs, body: text <=4096) -> posts:
  require exists members[clubId, viewer] else NOT_MEMBER
  post = +posts { club: clubId, author: viewer, body, at: now }
  clubMembers = members[clubId] first 200
  for member in clubMembers:
    +~unseen[clubId, member.user] { n: (.n ?? 0) + 1 }
  post
