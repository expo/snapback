-- Therapeutic Riding Sessions.
-- Roles: director (program director), instructor (certified instructor),
-- volunteer (side walkers / barn volunteers), family (guardian of a rider).
-- Privacy: volunteers see a rider's first name, horse, tack, mounting
-- method and safety notes; diagnosis, rider goals and guardian contact
-- are instructor/director-only columns. Families read only their own
-- (v2: therapy goals renamed to rider goals; only the director may change
-- them, instructors keep read access).
-- rider's progress notes and photos. Medical forms expire one year after
-- signing. Only the director can suspend a horse, with a recorded reason.
use identity password

table roles:
  principal: principal
  role: enum('director', 'instructor', 'volunteer', 'family')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table horses:
  name: text 1..80
  status: enum('active', 'suspended') default 'active'
  suspendReason: text 1..500 ?
  read <- exists roles[principal = viewer]
  insert <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or viewer = 'service:operator'
  update <- exists roles[viewer, role = 'director'] or viewer = 'service:operator'
  immutable name
  online only

table riders:
  firstName: text 1..80
  horse: horses ?
  tack: text 1..200 ?
  mountingMethod: text 1..200 ?
  safetyNotes: text 1..1000 ?
  diagnosis: text 1..1000 ? read <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  riderGoals: text 1..1000 ? renamed from therapyGoals read <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  guardianContact: text 1..200 ? read <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  medicalSignedAt: time ?
  read <- exists roles[principal = viewer] or exists familyLinks[.id, viewer]
  insert <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or viewer = 'service:operator'
  update <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  online only

table familyLinks:
  rider: riders
  family: principal
  unique rider, family
  immutable rider, family
  read <- .family = viewer or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or viewer = 'service:operator'
  insert <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or viewer = 'service:operator'
  delete <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  online only

table sessions:
  rider: riders
  horse: horses
  instructor: principal
  startsAt: time
  status: enum('scheduled', 'confirmed', 'completed') default 'scheduled'
  confirmedBy: principal ?
  immutable rider, horse, instructor, startsAt
  read <- exists roles[principal = viewer]
  insert <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or viewer = 'service:operator'
  update <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'volunteer']
  online only

table progressNotes:
  rider: riders
  author: principal
  body: text 1..2000
  photo: image <=5000000 ?
  at: time default now
  immutable rider, author, at
  read <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or exists familyLinks[.rider, viewer]
  insert <- exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor']
  online only

query myRole():
  return roles[principal = viewer]

query roster(c: cursor ?):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  return roles first 100 by .id after c

query horsesList(c: cursor ?):
  require exists roles[principal = viewer] else NOT_SIGNED_IN
  return horses first 100 by .id after c

query riderList(c: cursor ?):
  require exists roles[principal = viewer] else NOT_SIGNED_IN
  if exists roles[viewer, role = 'family']:
    return riders where exists familyLinks[.id, viewer] first 100 by .id after c
  return riders first 100 by .id after c

query riderDetail(rider: riders):
  require exists roles[principal = viewer] else NOT_SIGNED_IN
  return riders[rider]

query riderPrivate(rider: riders):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  return riders[rider]

query barnBoard(c: cursor ?):
  require exists roles[principal = viewer] else NOT_SIGNED_IN
  return sessions first 100 by .startsAt after c

query myFamilyRiders(c: cursor ?):
  require exists roles[viewer, role = 'family'] else NOT_FAMILY
  return riders where exists familyLinks[.id, viewer] first 100 by .id after c

query notesForRider(rider: riders, c: cursor ?):
  require exists roles[principal = viewer] else NOT_SIGNED_IN
  r = riders[rider] ! else NOT_FOUND
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] or exists familyLinks[rider, viewer] else NOT_YOUR_RIDER
  return progressNotes where .rider = rider first 50 by .at after c

query medicalStatus(rider: riders):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  r = riders[rider] ! else NOT_FOUND
  return { signedAt: r.medicalSignedAt, expired: r.medicalSignedAt = null or now >= r.medicalSignedAt + 365d }

mutation provision(principal: principal, role: enum('director', 'instructor', 'volunteer', 'family')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal: principal, role: role }

mutation addHorse(name: text 1..80):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  return insert horses { name }

mutation suspendHorse(horse: horses, reason: text 1..500):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  h = horses[horse] ! else NOT_FOUND
  require h.status = 'active' else ALREADY_SUSPENDED
  update horses[horse] { status: 'suspended', suspendReason: reason }
  return null

mutation reinstateHorse(horse: horses):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  h = horses[horse] ! else NOT_FOUND
  require h.status = 'suspended' else NOT_SUSPENDED
  update horses[horse] { status: 'active', suspendReason: null }
  return null

mutation addRider(firstName: text 1..80, horse: horses ?, tack: text 1..200 ?, mountingMethod: text 1..200 ?, safetyNotes: text 1..1000 ?, diagnosis: text 1..1000 ?, riderGoals: text 1..1000 ? alias therapyGoals, guardianContact: text 1..200 ?, family: principal):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  require exists roles[family, role = 'family'] else NOT_FAMILY
  if horse != null:
    h = horses[horse] ! else NOT_FOUND
  r = insert riders { firstName, horse, tack, mountingMethod, safetyNotes, diagnosis, riderGoals, guardianContact, medicalSignedAt: null }
  rid = (r.id) ! else NOT_FOUND
  insert familyLinks { rider: rid, family }
  return r

mutation updateRiderBoard(rider: riders, horse: horses ?, tack: text 1..200 ?, mountingMethod: text 1..200 ?, safetyNotes: text 1..1000 ?):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  r = riders[rider] ! else NOT_FOUND
  if horse != null:
    h = horses[horse] ! else NOT_FOUND
  update riders[rider] { horse, tack, mountingMethod, safetyNotes }
  return null

mutation updateRiderPrivate(rider: riders, diagnosis: text 1..1000 ?, riderGoals: text 1..1000 ? alias therapyGoals, guardianContact: text 1..200 ?):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  r = riders[rider] ! else NOT_FOUND
  if riderGoals != null:
    require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  update riders[rider] { diagnosis, guardianContact, riderGoals: riderGoals ?? r.riderGoals }
  return null

mutation updateRiderGoals(rider: riders, riderGoals: text 1..1000 ?):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  r = riders[rider] ! else NOT_FOUND
  update riders[rider] { riderGoals }
  return null

mutation signMedicalForm(rider: riders):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  r = riders[rider] ! else NOT_FOUND
  update riders[rider] { medicalSignedAt: now }
  return null

mutation scheduleSession(rider: riders, horse: horses, startsAt: time, instructor: principal):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  require exists roles[instructor, role = 'instructor'] else NOT_INSTRUCTOR
  r = riders[rider] ! else NOT_FOUND
  h = horses[horse] ! else NOT_FOUND
  require h.status = 'active' else HORSE_SUSPENDED
  require r.medicalSignedAt != null and now < r.medicalSignedAt + 365d else MEDICAL_EXPIRED
  require startsAt > now else IN_THE_PAST
  return insert sessions { rider, horse, instructor, startsAt }

mutation confirmSession(session: sessions):
  require exists roles[viewer, role = 'volunteer'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'director'] else NOT_CONFIRMER
  s = sessions[session] ! else NOT_FOUND
  require s.status = 'scheduled' else ALREADY_CONFIRMED
  h = horses[s.horse] ! else NOT_FOUND
  require h.status = 'active' else HORSE_SUSPENDED
  r = riders[s.rider] ! else NOT_FOUND
  require r.medicalSignedAt != null and now < r.medicalSignedAt + 365d else MEDICAL_EXPIRED
  update sessions[session] { status: 'confirmed', confirmedBy: viewer }
  return null

mutation completeSession(session: sessions):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  s = sessions[session] ! else NOT_FOUND
  require s.status = 'confirmed' else NOT_CONFIRMED
  update sessions[session] { status: 'completed' }
  return null

mutation addProgressNote(rider: riders, body: text 1..2000, photo: image <=5000000 ?):
  require exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  r = riders[rider] ! else NOT_FOUND
  return insert progressNotes { rider, author: viewer, body, photo }

-- Spec intent, independent of the rules above.
-- Only instructors and the director read clinical and contact fields.
-- Only the director changes rider goals; instructors keep read access.
-- Families read only their own rider's notes; instructors and the director read all notes.

-- spec-worded intent (analysis, from spec+change text only)
invariant riders.riderGoals write only exists roles[viewer, role = 'director']
