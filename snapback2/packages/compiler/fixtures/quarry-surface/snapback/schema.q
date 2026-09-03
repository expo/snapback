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
  insert <- .principal = viewer
  update (old, next) <- old.principal = viewer and next.principal = viewer
  delete <- deny

table groups:
  owner: principal
  label: text <=80
  public
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer

table memberships:
  group: groups
  principal: principal
  active: bool
  unique group, principal
  by byPrincipalActive: principal, active
  read <- .principal = viewer or .active = true
  insert <- .principal = viewer and not (.active = false)
  update <- .principal = viewer
  delete <- .principal = viewer

table posts:
  author: principal
  group: groups
  body: text <=500
  at: time
  editedAt: time ?
  visible: bool
  mood: enum('plain', 'bright')
  by byAuthorAt: author, at, id
  by byAuthorVisibleAt: author, visible, at, id
  by byGroupAt: group, at, id
  public
  insert <- .author = viewer
  update <- .author = viewer
  delete <- .author = viewer

table counters:
  owner: principal
  value: int
  note: text <=40 ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer

table pairs:
  lo: principal
  hi: principal
  unique lo, hi
  read <- .lo = viewer or .hi = viewer
  insert <- .lo = viewer or .hi = viewer

table keyedRows:
  owner: principal
  label: text <=40
  value: int
  unique owner, label
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow

table nodes:
  name: text <=80
  parent: nodes ?
  by parent, name
  public

maintain counterTotals = sum counters of value by owner:
  read <- .owner = viewer
  readable <- allow

channel typing(group: groups):
  publish <- exists memberships[group, viewer]
  subscribe <- exists memberships[group, viewer]
  ttl 5s
