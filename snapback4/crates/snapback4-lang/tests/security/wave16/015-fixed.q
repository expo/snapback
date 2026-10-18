-- SEC2 ordinary custody repair of wave-16 lane 015. Original kept as 015.q.
-- Every placement/adoption records a photo-backed handoff in the same transaction.
-- @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — ordinary operations, not seeded custody.
-- Roles: coordinator (sees everything, only approver), foster (pets in
-- their care), adopter (their application + that pet's public profile),
-- vet (medical records only). Real password auth; dev personas for tests.
use identity password
use personas alice, bob

-- One roster row per user. Self-registration is open for the three
-- non-privileged roles; coordinators are granted by an existing
-- coordinator or the service:ops seat (first-coordinator recipe).
table profiles:
  principal: principal
  role: enum('coordinator', 'foster', 'adopter', 'vet')
  displayName: text 1..60 default 'Member'
  unique principal
  read <- .principal = viewer or exists profiles[viewer, role = 'coordinator']
  insert <- (.principal = viewer and (.role = 'foster' or .role = 'adopter' or .role = 'vet')) or viewer = 'service:ops'
  update (old, next) <- (old.principal = viewer and next.principal = viewer and next.role = old.role) or exists profiles[viewer, role = 'coordinator'] or viewer = 'service:ops'
  online only

-- Private pet record: coordinator + current foster only.
table pets:
  name: text 1..60
  species: text 1..40
  breed: text 1..60 ?
  description: text <=500 ?
  photo: image <=10000000 ?
  status: enum('shelter', 'fostered', 'pending-adoption', 'adopted') default 'shelter'
  currentFoster: principal ?
  read <- .currentFoster = viewer or exists profiles[viewer, role = 'coordinator']
  insert <- exists profiles[viewer, role = 'coordinator']
  update <- exists profiles[viewer, role = 'coordinator']
  online only

-- Public profile copy: coordinator, the pet's foster, adopters who applied.
table petCards:
  pet: pets
  name: text 1..60
  species: text 1..40
  breed: text 1..60 ?
  description: text <=500 ?
  immutable pet
  unique pet
  read <- exists profiles[viewer, role = 'coordinator'] or exists pets[.pet, currentFoster = viewer] or exists applications[pet = .pet, applicant = viewer]
  insert <- exists profiles[viewer, role = 'coordinator']
  update <- exists profiles[viewer, role = 'coordinator']
  online only

-- Adoption applications: applicant + coordinator.
table applications:
  pet: pets
  applicant: principal
  status: enum('applied', 'approved', 'rejected') default 'applied'
  note: text <=500 ?
  at: time default now
  immutable pet, applicant
  unique pet, applicant
  read <- .applicant = viewer or exists profiles[viewer, role = 'coordinator']
  insert <- .applicant = viewer and exists pets[.pet]
  update <- exists profiles[viewer, role = 'coordinator']
  delete <- .applicant = viewer or exists profiles[viewer, role = 'coordinator']
  online only

-- A handoff with a photo and both parties' confirmation.
table handoffs:
  pet: pets
  fromParty: principal
  toParty: principal
  photo: image <=10000000
  note: text <=200 ?
  fromConfirmed: bool default false
  toConfirmed: bool default false
  at: time default now
  immutable pet, fromParty, toParty, photo, at
  read <- .fromParty = viewer or .toParty = viewer or exists profiles[viewer, role = 'coordinator']
  insert <- exists profiles[viewer, role = 'coordinator']
  update <- .fromParty = viewer or .toParty = viewer or exists profiles[viewer, role = 'coordinator']
  online only

-- Medical records: coordinator, vet, and the pet's foster.
table vaccinations:
  pet: pets
  vaccine: text 1..60
  dueAt: time
  done: bool default false
  doneAt: time ?
  notes: text <=300 ?
  immutable pet, vaccine, dueAt
  read <- exists profiles[viewer, role = 'coordinator'] or exists profiles[viewer, role = 'vet'] or exists pets[.pet, currentFoster = viewer]
  insert <- (exists profiles[viewer, role = 'coordinator'] or exists profiles[viewer, role = 'vet']) and exists pets[.pet]
  update <- exists profiles[viewer, role = 'coordinator'] or exists profiles[viewer, role = 'vet']
  online only

query myProfile():
  return profiles[principal = viewer]

query allProfiles(c: cursor ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return profiles first 50 by .id after c

query myPets(c: cursor ?):
  return pets where .currentFoster = viewer first 50 by .id after c

query allPets(c: cursor ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return pets first 50 by .id after c

query petDetail(pet: pets):
  return pets[pet]

query publicCard(pet: pets):
  return petCards[pet]

query myHandoffs(c: cursor ?):
  return handoffs where .fromParty = viewer or .toParty = viewer first 50 by .id after c

query allHandoffs(c: cursor ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return handoffs first 50 by .id after c

query handoffsFor(pet: pets, c: cursor ?):
  return handoffs where .pet = pet first 50 by .id after c

query myApplications(c: cursor ?):
  return applications where .applicant = viewer first 50 by .id after c

query allApplications(c: cursor ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return applications first 50 by .id after c

query applicationsFor(pet: pets, c: cursor ?):
  return applications where .pet = pet first 50 by .id after c

query petVaccinations(pet: pets, c: cursor ?):
  return vaccinations where .pet = pet first 50 by .dueAt after c

-- Due within the next week, undone, for pets in the caller's care.
query fosterReminders(c: cursor ?):
  require exists profiles[viewer, role = 'foster'] else NOT_FOSTER
  return vaccinations where not .done and .dueAt >= now and .dueAt < now + 7d and exists pets[.pet, currentFoster = viewer] first 50 by .dueAt after c

-- Overdue and undone: the coordinator's lapse alert.
query lapsedVaccinations(c: cursor ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return vaccinations where not .done and .dueAt < now first 50 by .dueAt after c

query allVaccinations(c: cursor ?):
  require exists profiles[viewer, role = 'vet'] or exists profiles[viewer, role = 'coordinator'] else NOT_VET
  return vaccinations first 50 by .dueAt after c

mutation grantCoordinator(who: principal):
  require exists profiles[viewer, role = 'coordinator'] or viewer = 'service:ops' else NOT_COORDINATOR
  return upsert profiles[who] { principal: who, role: 'coordinator' }

mutation registerProfile(role: enum('foster', 'adopter', 'vet'), displayName: text 1..60 ?):
  require not exists profiles[viewer] else ALREADY_REGISTERED
  return insert profiles { principal: viewer, role, displayName: displayName ?? 'Member' }

mutation setOwnDisplayName(displayName: text 1..60):
  require exists profiles[viewer] else NOT_REGISTERED
  update profiles[viewer] { displayName }
  return null

mutation registerPet(name: text 1..60, species: text 1..40, breed: text 1..60 ?, description: text <=500 ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return insert pets { name, species, breed, description, status: 'shelter' }

mutation setPetPhoto(pet: pets, photo: image <=10000000):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  p = pets[pet] ! else NOT_FOUND
  update pets[pet] { photo }
  return null

mutation placeWithFoster(pet: pets, foster: principal, photo: image <=10000000):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  p = pets[pet] ! else NOT_FOUND
  require exists profiles[foster, role = 'foster'] else NOT_FOSTER
  require p.status = 'shelter' or p.status = 'fostered' else NOT_PLACEABLE
  fromParty = p.currentFoster ?? viewer
  require fromParty != foster else SAME_PARTY
  insert handoffs { pet, fromParty, toParty: foster, photo }
  update pets[pet] { currentFoster: foster, status: 'fostered' }
  return null

mutation publishCard(pet: pets, name: text 1..60, species: text 1..40, breed: text 1..60 ?, description: text <=500 ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  p = pets[pet] ! else NOT_FOUND
  return upsert petCards[pet] { pet, name, species, breed, description }

mutation scheduleVaccination(pet: pets, vaccine: text 1..60, dueAt: time):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  p = pets[pet] ! else NOT_FOUND
  return insert vaccinations { pet, vaccine, dueAt, done: false }

mutation recordVaccination(vaccination: vaccinations, notes: text <=300 ?):
  require exists profiles[viewer, role = 'vet'] or exists profiles[viewer, role = 'coordinator'] else NOT_VET
  v = vaccinations[vaccination] ! else NOT_FOUND
  require not v.done else ALREADY_DONE
  update vaccinations[vaccination] { done: true, doneAt: now, notes: notes ?? v.notes }
  return null

-- A vet logs an administered vaccine that was never scheduled. Blind insert:
-- rule probes (not program lookups) authorize the pet, which the vet cannot read.
mutation logVaccination(pet: pets, vaccine: text 1..60, notes: text <=300 ?):
  require exists profiles[viewer, role = 'vet'] or exists profiles[viewer, role = 'coordinator'] else NOT_VET
  return insert vaccinations { pet, vaccine, dueAt: now, done: true, doneAt: now, notes }

-- Coordinator records a handoff with its photo. Blind parties: the record
-- names principals, no lookup needed beyond the coordinator's pet read.
mutation recordHandoff(pet: pets, fromParty: principal, toParty: principal, photo: image <=10000000, note: text <=200 ?, at: time ?):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  p = pets[pet] ! else NOT_FOUND
  require fromParty = (p.currentFoster ?? viewer) else NOT_CURRENT_CUSTODIAN
  require fromParty != toParty else SAME_PARTY
  require exists profiles[toParty, role = 'foster'] or exists applications[pet = pet, applicant = toParty, status = 'approved'] else INVALID_RECIPIENT
  require at = null or (at <= now and at >= now - 30d) else INVALID_TIME
  return insert handoffs { pet, fromParty, toParty, photo, note, at: at ?? now }

-- Each party confirms their own side within 30 days of the handoff.
mutation confirmHandoff(handoff: handoffs):
  h = handoffs[handoff] ! else NOT_FOUND
  require h.fromParty = viewer or h.toParty = viewer else NOT_PARTY
  require now <= h.at + 30d else CONFIRM_LATE
  update handoffs[handoff] { fromConfirmed: true if h.fromParty = viewer else h.fromConfirmed, toConfirmed: true if h.toParty = viewer else h.toConfirmed }
  return null

-- Any adopter applies blind: the insert rule (not a program lookup)
-- authorizes the pet, which the adopter cannot read.
mutation applyForAdoption(pet: pets, note: text <=500 ?):
  require exists profiles[viewer, role = 'adopter'] else NOT_ADOPTER
  return insert applications { pet, applicant: viewer, status: 'applied', note }

mutation approveAdoption(application: applications, photo: image <=10000000):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  a = applications[application] ! else NOT_FOUND
  require a.status = 'applied' else ALREADY_DECIDED
  p = pets[a.pet] ! else NOT_FOUND
  require p.status = 'shelter' or p.status = 'fostered' else NOT_ADOPTABLE
  fromParty = p.currentFoster ?? viewer
  require fromParty != a.applicant else SAME_PARTY
  insert handoffs { pet: a.pet, fromParty, toParty: a.applicant, photo }
  update applications[application] { status: 'approved' }
  update pets[a.pet] { status: 'adopted', currentFoster: null }
  return null

mutation rejectApplication(application: applications):
  require exists profiles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  a = applications[application] ! else NOT_FOUND
  require a.status = 'applied' else ALREADY_DECIDED
  update applications[application] { status: 'rejected' }
  return null

mutation withdrawApplication(application: applications):
  a = applications[application] ! else NOT_FOUND
  require a.applicant = viewer else NOT_APPLICANT
  delete applications[application]
  return null

invariant pets.placeWithFoster only exists profiles[viewer, role = 'coordinator']
invariant pets.approveAdoption only exists profiles[viewer, role = 'coordinator']
invariant handoffs always .photo != null
