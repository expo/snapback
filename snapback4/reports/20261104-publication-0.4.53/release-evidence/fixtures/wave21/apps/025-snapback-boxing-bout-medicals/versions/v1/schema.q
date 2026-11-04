-- Boxing Bout Medicals.
-- Roles: coach, matchmaker, boxer, physician (ringside), inspector (commission).
-- Provisioned by the local operator; signup alone grants no role.
use identity password

table roles:
  principal: principal
  role: enum('coach', 'matchmaker', 'boxer', 'physician', 'inspector')
  unique principal
  immutable principal, role
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

-- One medical record per boxer user. Weight, record and photo are gym-visible;
-- physician notes and the suspension reason stay with physician + inspector.
table boxers:
  owner: principal
  name: text 1..80
  weightLb: int 60..600
  wins: int 0..1000 default 0
  losses: int 0..1000 default 0
  draws: int 0..1000 default 0
  photo: image <=5000000 ?
  examAt: time ?
  physicianNotes: text <=2000 ?
  suspensionReason: text <=500 ?
  suspensionUntil: time ?
  unique owner
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'coach'] or exists roles[principal = viewer, role = 'matchmaker'] or exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
  read (physicianNotes, suspensionReason) <- exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
  insert <- .owner = viewer and exists roles[principal = viewer, role = 'boxer']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
  delete <- deny
  online only

-- Exam history. The owner principal is copied at placement so a boxer's own
-- history stays readable without multi-hop rules.
table exams:
  boxer: boxers
  owner: principal
  takenAt: time
  scan: image <=10000000
  resultNotes: text <=1000 ?
  immutable boxer, owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'coach'] or exists roles[principal = viewer, role = 'matchmaker'] or exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
  read (resultNotes) <- .owner = viewer or exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
  insert <- exists roles[principal = viewer, role = 'physician']
  update <- deny
  delete <- deny
  online only

-- The bout card is public to every signed-in viewer; it carries no medical fields.
table bouts:
  boxerA: boxers
  boxerB: boxers
  boutAt: time
  venue: text 1..120
  status: enum('proposed', 'confirmed', 'completed', 'cancelled') default 'proposed'
  stoppedBoxer: boxers ?
  method: text <=80 ?
  immutable boxerA, boxerB, boutAt
  public 'the bout card is visible to every signed-in viewer'
  insert <- exists roles[principal = viewer, role = 'matchmaker']
  update <- exists roles[principal = viewer, role = 'matchmaker'] or exists roles[principal = viewer, role = 'physician']
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('coach', 'matchmaker', 'boxer', 'physician', 'inspector')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query boxersList(c: cursor ?):
  return boxers last 50 by .id after c

query boxerCard(boxer: boxers):
  return boxers[boxer]

query myBoxer():
  return boxers[owner = viewer]

query examsOf(boxer: boxers, c: cursor ?):
  return exams where .boxer = boxer last 50 by .takenAt after c

query boutCard(c: cursor ?):
  return bouts first 100 by .boutAt after c

query eligibility(boxer: boxers):
  b = boxers[boxer] ! else NOT_FOUND
  return { examValid: b.examAt != null and b.examAt >= now - 365d, suspended: b.suspensionUntil != null and b.suspensionUntil > now }

mutation registerBoxer(name: text 1..80, weightLb: int 60..600, photo: image <=5000000 ?):
  require exists roles[principal = viewer, role = 'boxer'] else NOT_BOXER
  return insert boxers { owner: viewer, name, weightLb, photo }

mutation updateMyProfile(name: text 1..80 ?, weightLb: int 60..600 ?, photo: image <=5000000 ?):
  require exists roles[principal = viewer, role = 'boxer'] else NOT_BOXER
  row = boxers[owner = viewer] ! else NO_PROFILE
  update boxers[row.id] { name: name ?? row.name, weightLb: weightLb ?? row.weightLb, photo: photo ?? row.photo }
  return null

-- takenAt is when the exam happened (paperwork is often filed later).
mutation recordExam(boxer: boxers, takenAt: time, scan: image <=10000000, resultNotes: text <=1000 ?):
  require exists roles[principal = viewer, role = 'physician'] else NOT_PHYSICIAN
  b = boxers[boxer] ! else NOT_FOUND
  insert exams { boxer, owner: b.owner, takenAt, scan, resultNotes }
  update boxers[b.id] { examAt: takenAt }
  return null

mutation setNotes(boxer: boxers, notes: text <=2000 ?):
  require exists roles[principal = viewer, role = 'physician'] else NOT_PHYSICIAN
  b = boxers[boxer] ! else NOT_FOUND
  update boxers[b.id] { physicianNotes: notes }
  return null

mutation proposeBout(boxerA: boxers, boxerB: boxers, boutAt: time, venue: text 1..120):
  require exists roles[principal = viewer, role = 'matchmaker'] else NOT_MATCHMAKER
  require boxerA != boxerB else SAME_BOXER
  require boutAt >= now else BOUT_IN_PAST
  a = boxers[boxerA] ! else NOT_FOUND
  b = boxers[boxerB] ! else NOT_FOUND
  return insert bouts { boxerA: a.id, boxerB: b.id, boutAt, venue }

mutation confirmBout(bout: bouts):
  require exists roles[principal = viewer, role = 'matchmaker'] else NOT_MATCHMAKER
  t = bouts[bout] ! else NOT_FOUND
  require t.status = 'proposed' else BAD_STATUS
  require t.boutAt >= now else BOUT_IN_PAST
  a = boxers[t.boxerA] ! else NOT_FOUND
  b = boxers[t.boxerB] ! else NOT_FOUND
  require a.examAt != null and a.examAt >= now - 365d else EXAM_EXPIRED
  require b.examAt != null and b.examAt >= now - 365d else EXAM_EXPIRED
  require a.suspensionUntil = null or a.suspensionUntil <= now else BOXER_SUSPENDED
  require b.suspensionUntil = null or b.suspensionUntil <= now else BOXER_SUSPENDED
  update bouts[t.id] { status: 'confirmed' }
  return null

mutation cancelBout(bout: bouts):
  require exists roles[principal = viewer, role = 'matchmaker'] else NOT_MATCHMAKER
  t = bouts[bout] ! else NOT_FOUND
  require t.status = 'proposed' or t.status = 'confirmed' else BAD_STATUS
  update bouts[t.id] { status: 'cancelled' }
  return null

-- stoppedAt defaults to the bout date; backdated paperwork stays testable.
mutation recordResult(bout: bouts, stoppedBoxer: boxers ?, method: text <=80 ?, stoppedAt: time ?, reason: text <=500 ?):
  require exists roles[principal = viewer, role = 'physician'] else NOT_PHYSICIAN
  t = bouts[bout] ! else NOT_FOUND
  require t.status = 'confirmed' else BAD_STATUS
  if stoppedBoxer != null:
    s = boxers[stoppedBoxer] ! else NOT_FOUND
    require s.id = t.boxerA or s.id = t.boxerB else NOT_IN_BOUT
    start = stoppedAt ?? t.boutAt
    update boxers[s.id] { suspensionUntil: start + 30d, suspensionReason: reason ?? 'Stopped by the ringside physician' }
  update bouts[t.id] { status: 'completed', stoppedBoxer, method }
  return null

mutation liftSuspension(boxer: boxers):
  require exists roles[principal = viewer, role = 'inspector'] else NOT_INSPECTOR
  b = boxers[boxer] ! else NOT_FOUND
  require b.suspensionUntil != null and b.suspensionUntil > now else NO_SUSPENSION
  update boxers[b.id] { suspensionUntil: null, suspensionReason: null }
  return null

-- Spec intent, stated separately from the rules that enforce it.
invariant roles.read only .principal = viewer
invariant roles.insert only viewer = 'service:operator'
invariant boxers.read only .owner = viewer or exists roles[principal = viewer, role = 'coach'] or exists roles[principal = viewer, role = 'matchmaker'] or exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
invariant boxers.physicianNotes read only exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
invariant boxers.suspensionReason read only exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']
invariant boxers.insert only .owner = viewer
invariant exams.insert only exists roles[principal = viewer, role = 'physician']
