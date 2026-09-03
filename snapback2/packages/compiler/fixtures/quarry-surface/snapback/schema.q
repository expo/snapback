use identity guests

table users:
  principal: principal
  name: text 1..40 format handle
  nickname: text <=40 ?
  score: int
  active: bool
  role: enum('member', 'admin')
  joinedAt: time
  metadata: json <=2048
  avatar: bytes <=1024 ?
  externalId: id
  unique principal
  unique name
  immutable principal, joinedAt
  public 'directory profiles are public'
  insert r <- r.principal = viewer
  update (old, next) <- old.principal = viewer and next.principal = viewer
  delete r <- deny

table groups:
  owner: principal
  label: text <=80
  public
  insert r <- r.owner = viewer
  update r <- r.owner = viewer
  delete r <- r.owner = viewer

table memberships:
  group: groups
  principal: principal
  active: bool
  unique group, principal
  by byPrincipalActive: principal, active
  read r <- r.principal = viewer or r.active = true
  insert r <- r.principal = viewer and not (r.active = false)
  update r <- r.principal = viewer
  delete r <- r.principal = viewer

table posts:
  author: principal
  group: groups
  body: text <=500
  at: time
  editedAt: time ?
  visible: bool
  mood: enum('plain', 'bright')
  by byAuthorAt: author, at, id
  by byGroupAt: group, at, id
  public
  insert r <- r.author = viewer
  update r <- r.author = viewer
  delete r <- r.author = viewer

table counters:
  owner: principal
  value: int
  note: text <=40 ?
  read r <- r.owner = viewer
  insert r <- r.owner = viewer
  update r <- r.owner = viewer
  delete r <- r.owner = viewer

table pairs:
  lo: principal
  hi: principal
  unique lo, hi
  read r <- r.lo = viewer or r.hi = viewer
  insert r <- r.lo = viewer or r.hi = viewer

table keyedRows:
  owner: principal
  label: text <=40
  value: int
  unique owner, label
  read r <- allow
  insert r <- allow
  update r <- allow
  delete r <- allow

table nodes:
  name: text <=80
  parent: nodes ?
  by parent, name
  public

maintain counterTotals = sum counters of value by owner:
  read r <- r.owner = viewer
  readable <- allow

channel typing(group: groups):
  publish <- exists memberships[group, viewer]
  subscribe <- exists memberships[group, viewer]
  ttl 5s
