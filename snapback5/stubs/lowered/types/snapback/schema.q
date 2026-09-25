-- LLP 4001 §3.1 and maintained/capped columns.
use identity password
table posts:
  owner: principal
  parentId: posts ?
  title: text
  short: text <=20
  ranged: text 3..20
  handle: text 3..20 format handle
  link: text <=2000 format url ?
  n: int
  flag: bool default false
  at: time default now
  readAt: time default 0
  kind: enum('a', 'b')
  photo: image <=10000000 once
  clip: video <=50000000
  tag: id
  childCount: count posts by parentId
  likeCount: count likes
  weightTotal: sum likes of .weight
  selectedCount: count likes where .selected
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable owner, parentId, at
  search title, handle
  public
  insert <- .owner = viewer
  update <- .owner = viewer
  sync public
table likes:
  postId: posts
  principal: principal
  weight: int
  selected: bool
  unique postId, principal
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public
table privateRows:
  principal: principal
  chat: id
  message: id
  at: time
  expiresAt: time ?
  cap 1 by principal
  cap 50 by chat, message
  immutable principal, at
  read <- .principal = viewer
  sync to .principal last 500 by .at
  retain delivered-history
  expire at .expiresAt
table onlineRows:
  owner: principal
  read <- .owner = viewer
query viewerValue():
  return viewer
query echoId(value: id):
  return value
query media(clip: video <=50000000):
  return clip.duration
query scalars(body: text, a: int, b: int):
  return { text: slice(body, 4, 14), low: min(a, b), high: max(a, b), choice: 'yes' if a < b else 'no', fallback: null ?? 'fallback', length: count(body), day: day(now), hour: hour(now) }
query listForms(ids: [id] <=50, extra: id, body: text):
  grown = ids
  grown = grown + [extra]
  return count(grown) + count(body)
fn loopForms(items: [int] <=50):
  n = 0
  for x in items:
    if x = 0:
      continue
    else if x < 0:
      break
    else:
      n = n + x
  return n
query loops(items: [int] <=50):
  return loopForms(items)

table audienceGroups:
  title: text
  read <- exists audienceMembers[.id, viewer]
  sync to audienceMembers[.id] by .principal
table audienceMembers:
  groupId: audienceGroups
  principal: principal
  addedBy: principal
  unique groupId, principal
  cap 50 by groupId
  immutable groupId, principal
  read <- exists audienceMembers[.groupId, viewer]
  sync by .principal

-- §3.3/3.7 total equality in value positions, including two nullable operands.
query nullForms(a: int ?, b: int ?):
  return { isNull: a = null, isNotNull: a != null, equal: a = b, different: a != b }
