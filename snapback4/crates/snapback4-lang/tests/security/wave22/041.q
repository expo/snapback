use identity password

table roles:
  principal: principal
  role: enum('parent', 'instructor', 'frontDesk', 'director')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('parent', 'instructor', 'frontDesk', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table children:
  parent: principal
  name: text 1..80
  photo: image <=5000000
  level: int 1..6
  lesson: text 1..60
  levelStarted: time
  assessedAt: time
  lessons: int 0..10000
  immutable parent, photo
  read <- .parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  online only

table billing:
  child: children
  feeCents: int 100..100000
  refundedCents: int 0..100000
  unique child
  immutable child, feeCents
  read <- .child.parent = viewer or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  online only

table assessments:
  child: children
  author: principal
  note: text 1..1000
  level: int 1..6
  at: time
  immutable child, author, note, level, at
  read <- .child.parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- .author = viewer and (exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'])
  online only

table payments:
  child: children
  kind: enum('fee', 'refund')
  cents: int 1..100000
  reason: text 1..300
  author: principal
  at: time
  immutable child, kind, cents, reason, author, at
  read <- .child.parent = viewer or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- .author = viewer and (exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director'])
  online only

table movements:
  child: children
  author: principal
  fromLevel: int 1..6
  toLevel: int 1..6
  lesson: text 1..60
  reason: text 1..300
  at: time
  immutable child, author, fromLevel, toLevel, lesson, reason, at
  read <- .child.parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
  insert <- .author = viewer and (exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'])
  online only

query roster(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  return children first 200 by .id after c { id, parent, name, photo, level, lesson, levelStarted, assessedAt, lessons, overdue: now >= .assessedAt + 60d }

query history(child: children, c: cursor ?):
  row = children[child] ! else NOT_FOUND
  return assessments where .child = child last 100 by .id after c

query transfers(child: children, c: cursor ?):
  row = children[child] ! else NOT_FOUND
  return movements where .child = child last 100 by .id after c

query ledger(child: children, c: cursor ?):
  row = children[child] ! else NOT_FOUND
  require row.parent = viewer or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director'] else PAYMENT_PRIVATE
  return payments where .child = child last 100 by .id after c

mutation enroll(parent: principal, name: text 1..80, photo: image <=5000000, level: int 1..6, lesson: text 1..60, feeCents: int 100..100000):
  require exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director'] else NOT_DESK
  require trim(name) != '' and trim(lesson) != '' else EMPTY_TEXT
  -- Parents are supplied by their account identifier; only operator-provisioned parent accounts qualify.
  require exists roles[principal = parent, role = 'parent'] else NOT_PARENT
  child = insert children { parent, name, photo, level, lesson, levelStarted: now, assessedAt: now, lessons: 0 }
  insert billing { child: child.id, feeCents, refundedCents: 0 }
  insert payments { child: child.id, kind: 'fee', cents: feeCents, reason: 'Session enrollment', author: viewer, at: now }
  return child

mutation assess(child: children, note: text 1..1000):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'] else NOT_INSTRUCTOR
  row = children[child] ! else NOT_FOUND
  require trim(note) != '' else EMPTY_NOTE
  result = insert assessments { child, note, level: row.level, author: viewer, at: now }
  update children[child] { assessedAt: now }
  return result

mutation move(child: children, level: int 1..6, lesson: text 1..60, reason: text 1..300):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'] else NOT_INSTRUCTOR
  row = children[child] ! else NOT_FOUND
  require trim(reason) != '' and trim(lesson) != '' else REASON_REQUIRED
  require level <= row.level + 2 else TOO_MANY_LEVELS
  require level < row.level + 2 or exists roles[viewer, role = 'director'] else DIRECTOR_REQUIRED
  insert movements { child, author: viewer, fromLevel: row.level, toLevel: level, lesson, reason, at: now }
  if level != row.level:
    update children[child] { level, lesson, levelStarted: now, assessedAt: now }
  else:
    update children[child] { lesson }

mutation completeLesson(child: children):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'] else NOT_INSTRUCTOR
  row = children[child] ! else NOT_FOUND
  update children[child] { lessons: row.lessons + 1 }

mutation refund(child: children, cents: int 1..100000, reason: text 1..300):
  require exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director'] else NOT_DESK
  row = children[child] ! else NOT_FOUND
  require trim(reason) != '' else REASON_REQUIRED
  require (row.lessons <= 3 and cents <= 2500) or exists roles[viewer, role = 'director'] else DIRECTOR_REQUIRED
  bill = billing[child] ! else NOT_FOUND
  require bill.refundedCents + cents <= bill.feeCents else EXCEEDS_PAYMENT
  update billing[bill.id] { refundedCents: bill.refundedCents + cents }
  return insert payments { child, kind: 'refund', cents, reason, author: viewer, at: now }

-- Independent product intent: parents read only their own children and history.
invariant children.read only .parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
invariant assessments.read only .child.parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
invariant movements.read only .child.parent = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
-- Instructors have no financial audience.
invariant payments.read only .child.parent = viewer or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
invariant billing.read only .child.parent = viewer or exists roles[viewer, role = 'frontDesk'] or exists roles[viewer, role = 'director']
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
