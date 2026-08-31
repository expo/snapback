query userByName(name: text <=40):
  users[name = name] {
    *,
    label: .name,
  }

query requiredUser(u: users):
  user = users[u]! else USER_NOT_FOUND
  user { name, role }

query hasMembership(group: groups, user: users):
  exists memberships[group, user]

query postsAfter(author: users, cursor: time ?):
  if cursor:
    posts[author] after cursor first 3 by byAuthorAt {
      *,
      author: .author { name, role },
      edited: .editedAt ?? .at,
    }
  else:
    posts[author] first 3 by byAuthorAt {
      *,
      author: .author { name, role },
      edited: .editedAt ?? .at,
    }

query postsBefore(author: users, cursor: time):
  posts[author] before cursor last 3 by byAuthorAt {
    body,
    author: .author { name },
  }

query ancestors(seed: nodes):
  walk nodes[seed] up .parent depth 4

query parentName(seed: nodes):
  node = nodes[seed]! else NODE_NOT_FOUND
  node.parent.name

query wordTokens(body: text <=500):
  tokens(body)

query children(parent: nodes):
  nodes[parent] first 5 by byParentName { name }

query noteIsSet(counter: counters):
  row = counters[counter]! else COUNTER_NOT_FOUND
  row.note = 'set'

mutation ensureUser(name: text <=40, nickname: text <=40 ?, role: enum('member', 'admin')) -> users:
  match users[name = name]:
    some found:
      found { * }
    none:
      +users { name, nickname, score: 0, active: true, role, joinedAt: now }

mutation createPost(group: groups, body: text <=500, at: time, visible: bool, peers: [users] <=5) -> posts:
  require commit >= at else FUTURE_POST
  post = +posts { id: new, author: viewer, group, body, at: now, visible, mood: 'plain' }
  for peer in peers:
    +memberships { group, user: peer, active: true }
  ~posts[post] { body, editedAt: now }
  post { id, body }

mutation bump(counter: counters, owner: users, note: text <=40 ?) -> counters:
  +~counters[counter] { owner, value: (.value ?? 0) + 1, note }
  counters[counter]

mutation addPair(a: users, b: users) -> pairs:
  (lo, hi) = sorted(a, b)
  +pairs { lo, hi }

mutation boundedBuiltins(owner: users, a: int, b: int, body: text <=500) -> counters:
  words = tokens(body)
  for word in words:
    require word != '' else EMPTY_TOKEN
  for i in range(0, 2):
    require i >= 0 else BAD_RANGE
  +counters { owner, value: min(a, max(b, 0)) }

mutation removePost(post: posts):
  -posts[post]
