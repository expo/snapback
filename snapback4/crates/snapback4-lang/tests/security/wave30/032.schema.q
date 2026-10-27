use identity password

table roles:
  principal: principal
  role: enum('coordinator', 'director', 'advisor', 'family')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table placements:
  family: principal
  student: text 1..100
  stage: enum('shortlisted', 'visiting', 'enrolled')
  openedAt: time
  enrolledAt: time ?
  checkinDue: time ?
  checkedAt: time ?
  checkinNote: text 1..1000 ?
  immutable family, student, openedAt
  read <- .family = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
  online only

table finances:
  placement: placements
  feeCents: int 1..10000000
  phone: text 7..30
  financialDetails: text 1..2000
  application: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  unique placement
  immutable placement, feeCents, phone, financialDetails, application
  read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'coordinator'] and created placements[.placement]
  online only

table schools:
  placement: placements
  name: text 1..120
  immutable placement, name
  read through .placement
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
  cap 50 by placement
  online only

table visits:
  placement: placements
  school: schools
  startsAt: time
  note: text 1..500
  immutable placement, school, startsAt, note
  read through .placement
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
  cap 100 by placement
  online only

table essays:
  placement: placements
  title: text 1..120
  body: text 1..10000
  authoredBy: principal
  authoredAt: time
  immutable placement, title, body, authoredBy, authoredAt
  read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
  insert <- .authoredBy = viewer and exists placements[.placement] and (exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor'])
  cap 100 by placement
  online only

table refunds:
  placement: placements
  amountCents: int 1..10000000
  reason: text 10..1000
  approvedBy: principal
  approvedAt: time
  unique placement
  immutable placement, amountCents, reason, approvedBy, approvedAt
  read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director']
  insert <- .approvedBy = viewer and exists roles[viewer, role = 'director']
  online only

mutation provision(principal: principal, role: enum('coordinator', 'director', 'advisor', 'family')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query families(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  return roles where .role = 'family' last 100 by .id after c

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  if exists roles[viewer, role = 'family']:
    return placements where .family = viewer last 100 by .id after c
  return placements last 100 by .id after c

query placement(placement: placements):
  return placements[placement]

query privateDetails(placement: placements):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] else PRIVATE
  return finances[placement = placement]

query schoolList(placement: placements, c: cursor ?):
  return schools where .placement = placement last 50 by .id after c

query campusVisits(placement: placements, c: cursor ?):
  return visits where .placement = placement last 100 by .id after c

query essayDrafts(placement: placements, c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor'] else PRIVATE
  return essays where .placement = placement last 100 by .id after c

query refund(placement: placements):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] else PRIVATE
  return refunds[placement = placement]

mutation openPlacement(family: principal, student: text 1..100, feeCents: int 1..10000000, phone: text 7..30, financialDetails: text 1..2000, application: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require exists roles[family, role = 'family'] else NOT_FAMILY
  p = insert placements { family, student, stage: 'shortlisted', openedAt: now }
  insert finances { placement: p.id, feeCents, phone, financialDetails, application }
  return p

mutation addSchool(placement: placements, name: text 1..120):
  p = placements[placement] ! else NOT_FOUND
  return insert schools { placement, name }

mutation scheduleVisit(placement: placements, school: schools, startsAt: time, note: text 1..500):
  p = placements[placement] ! else NOT_FOUND
  s = schools[school] ! else NOT_FOUND
  require s.placement = placement else WRONG_PLACEMENT
  require startsAt > now else VISIT_IN_PAST
  return insert visits { placement, school, startsAt, note }

mutation saveEssay(placement: placements, title: text 1..120, body: text 1..10000):
  p = placements[placement] ! else NOT_FOUND
  return insert essays { placement, title, body, authoredBy: viewer, authoredAt: now }

mutation advancePlacement(placement: placements):
  p = placements[placement] ! else NOT_FOUND
  if p.stage = 'shortlisted':
    return update placements[placement] { stage: 'visiting' }
  require p.stage = 'visiting' else ALREADY_ENROLLED
  return update placements[placement] { stage: 'enrolled', enrolledAt: now, checkinDue: now + 90d }

mutation recordCheckin(placement: placements, note: text 1..1000):
  p = placements[placement] ! else NOT_FOUND
  require p.stage = 'enrolled' else NOT_ENROLLED
  require p.checkinDue != null else NO_DEADLINE
  require now <= p.checkinDue else CHECKIN_OVERDUE
  require p.checkedAt = null else ALREADY_CHECKED
  return update placements[placement] { checkedAt: now, checkinNote: note }

mutation approveRefund(placement: placements, amountCents: int 1..10000000, reason: text 10..1000):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  p = placements[placement] ! else NOT_FOUND
  f = finances[placement = placement] ! else NOT_FOUND
  require amountCents <= f.feeCents else EXCEEDS_FEE
  return insert refunds { placement, amountCents, reason, approvedBy: viewer, approvedAt: now }

-- Product intent: staff collaborate across the agency; families only see their own journey.
-- The brief specifies no advisor assignment boundary.
invariant placements.read only .family = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'advisor']
invariant placements.insert only exists roles[viewer, role = 'coordinator']
-- The fee, phone, finances and application are restricted even on an otherwise shared placement.
invariant finances.read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director']
invariant finances.insert only exists roles[viewer, role = 'coordinator']
-- Refund reasons and amounts are private administrative records; approval needs a director.
invariant refunds.read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'director']
invariant refunds.insert only exists roles[viewer, role = 'director']
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
