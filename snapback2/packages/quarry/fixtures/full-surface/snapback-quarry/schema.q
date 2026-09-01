use identity

table users:
  name: text <=40
  nickname: text <=40 ?
  score: int
  active: bool
  role: enum('member', 'admin')
  joinedAt: time
  unique name
  public
  insert r <- allow
  update r <- r.id = viewer
  delete r <- deny

table groups:
  owner: users
  label: text <=80
  public
  insert r <- r.owner = viewer
  update r <- r.owner != 'blocked'
  delete r <- r.owner = viewer

table memberships:
  group: groups
  user: users
  active: bool
  unique group, user
  by byUserActive: user, active
  read r <- r.user = viewer or r.active = true
  insert r <- r.user = viewer and not (r.active = false)
  update r <- r.user = viewer
  delete r <- r.user = viewer

table posts:
  author: users
  group: groups
  body: text <=500
  at: time
  editedAt: time ?
  visible: bool
  mood: enum('plain', 'bright')
  by byAuthorAt: author, at
  by byGroupAt: group, at
  public
  insert r <- r.author = viewer
  update r <- r.author = viewer
  delete r <- r.author = viewer

table counters:
  owner: users
  value: int
  note: text <=40 ?
  read r <- r.owner = viewer
  insert r <- r.owner = viewer
  update r <- r.owner = viewer
  delete r <- r.owner = viewer

table pairs:
  lo: users
  hi: users
  unique lo, hi
  read r <- r.lo = viewer or r.hi = viewer
  insert r <- r.lo = viewer or r.hi = viewer

table nodes:
  name: text <=80
  parent: nodes ?
  by parent, name
  public

channel typing(group: groups):
  publish <- exists memberships[group, viewer]
  subscribe <- exists memberships[group, viewer]
  ttl 5s
