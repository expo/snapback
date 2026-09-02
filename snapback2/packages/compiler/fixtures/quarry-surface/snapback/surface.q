query userByName(name: text <=40):
  return users[name = name] {
    *,
    label: .name,
  }

query requiredUser(u: users):
  user = users[u]! else USER_NOT_FOUND
  return user { name, role }

query hasMembership(group: groups, principal: principal):
  return exists memberships[group, principal]

query postsAfter(author: principal, cursor: time ?):
  if cursor:
    return posts[author] after cursor first 3 by byAuthorAt {
      *,
      author: users[.author] by byPrincipal { name, role },
      edited: .editedAt ?? .at,
    }
  else:
    return posts[author] first 3 by byAuthorAt {
      *,
      author: users[.author] by byPrincipal { name, role },
      edited: .editedAt ?? .at,
    }

query postsBefore(author: principal, cursor: time):
  return posts[author] before cursor last 3 by byAuthorAt {
    body,
    author: users[.author] by byPrincipal { name },
  }

query visiblePosts(author: principal):
  page = posts[author] first 5 by byAuthorAt where .visible = true
  return { rows: page, count: count(page) }

query ancestors(seed: nodes):
  return walk nodes[seed] up .parent depth 4

query parentName(seed: nodes):
  node = nodes[seed]! else NODE_NOT_FOUND
  return node.parent.name

query wordTokens(body: text <=500):
  return tokens(body)

query children(parent: nodes):
  return nodes[parent] first 5 by byParentName { name }

query noteIsSet(counter: counters):
  row = counters[counter]! else COUNTER_NOT_FOUND
  return row.note = 'set'

query counterTotal(owner: principal):
  return #counterTotals[owner]

query firstPositive(values: [int] <=5):
  for value in values:
    if value > 0:
      return value
  return 0

mutation ensureUser(name: text <=40, nickname: text <=40 ?, role: enum('member', 'admin')) -> users:
  match users[name = name]:
    some found:
      return found { * }
    none:
      return +users { principal: viewer, name, nickname, score: 0, active: true, role, joinedAt: now, metadata: {}, externalId: new }

mutation createPost(group: groups, body: text <=500, at: time, visible: bool, peers: [principal] <=5) -> posts:
  require commit >= at else FUTURE_POST
  post = +posts { id: new, author: viewer, group, body, at: now, visible, mood: 'plain' }
  for principal in peers:
    +memberships { group, principal, active: true }
  ~posts[post] { body, editedAt: now }
  return post { id, body }

mutation bump(counter: counters, owner: principal, note: text <=40 ?) -> counters:
  +~counters[counter] { owner, value: (.value ?? 0) + 1, note }
  return counters[counter]

mutation addPair(a: principal, b: principal) -> pairs:
  (lo, hi) = sorted(a, b)
  return +pairs { lo, hi }

mutation boundedBuiltins(owner: principal, a: int, b: int, body: text <=500) -> counters:
  words = tokens(body)
  for word in words:
    require word != '' else EMPTY_TOKEN
  for i in range(0, 2):
    require i >= 0 else BAD_RANGE
  return +counters { owner, value: min(a, max(b, 0)) }

mutation removePost(post: posts):
  -posts[post]
  return null

mutation branchWrite(useFirst: bool):
  if useFirst:
    +counters { owner: viewer, value: 1 }
  else:
    +counters { owner: viewer, value: 2 }
  return null
