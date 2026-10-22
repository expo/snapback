-- Foster Pet Adoptions: no personas and no public administrative bootstrap.
use identity password

table roles:
  principal: principal
  role: enum('applicant', 'foster', 'counselor', 'director')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'applicant')
  update <- viewer = 'service:operator'
  online only

table animals:
  name: text 1..60
  species: enum('dog', 'cat')
  ageMonths: int 0..360
  description: text 1..1000
  feeCents: int 0..100000
  photos: [image <=5000000] 0..4
  status: enum('fostered', 'pending', 'adopted') default 'fostered'
  createdAt: time default now
  immutable createdAt
  public 'The adoption board shares animal listings, photos, fees and placement status.'
  insert <- exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  update (old, next) <- (old.photos = next.photos and ((old.status = 'fostered' and next.status = 'pending' and (exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'])) or (old.status = 'pending' and next.status = 'adopted' and exists roles[viewer, role = 'director']) or (old.status = 'adopted' and next.status = 'fostered' and exists roles[viewer, role = 'applicant']))) or (old.status = next.status and (exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']))
  online only

table care:
  animal: animals
  foster: principal
  medicalNotes: text <=4000
  behaviorNotes: text <=4000
  unique animal
  immutable animal
  read <- (exists roles[viewer, role = 'foster'] and .foster = viewer) or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  update <- (exists roles[viewer, role = 'foster'] and .foster = viewer) or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  online only

table applications:
  animal: animals
  applicant: principal
  fullName: text 1..100
  homeAddress: text 5..500
  motivation: text 10..2000
  status: enum('submitted', 'pending', 'adopted', 'returned') default 'submitted'
  createdAt: time default now
  adoptedAt: time ?
  returnBy: time ?
  returnedAt: time ?
  feePaidCents: int 0..100000 default 0
  refundCents: int 0..100000 default 0
  unique animal, applicant
  immutable animal, applicant, fullName, homeAddress, motivation, createdAt
  read <- (.applicant = viewer and exists roles[viewer, role = 'applicant']) or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  insert <- .applicant = viewer and exists roles[viewer, role = 'applicant'] and .status = 'submitted'
  update (old, next) <- (old.status = 'submitted' and next.status = 'pending' and (exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'])) or (old.status = 'pending' and next.status = 'adopted' and exists roles[viewer, role = 'director']) or (old.applicant = viewer and next.applicant = viewer and old.status = 'adopted' and next.status = 'returned' and exists roles[viewer, role = 'applicant'])
  online only

table referenceChecks:
  application: applications
  verdict: enum('cleared', 'concern')
  notes: text 1..4000
  checkedBy: principal
  checkedAt: time default now
  unique application
  immutable application
  read <- exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
  online only

-- Independent policy statements taken from the brief.
invariant care.read only (.foster = viewer and exists roles[viewer, role = 'foster']) or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
invariant applications.read only (.applicant = viewer and exists roles[viewer, role = 'applicant']) or exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
invariant referenceChecks.read only exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director']
invariant applications.approveAdoption only exists roles[viewer, role = 'director']
invariant roles.role update only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('applicant', 'foster', 'counselor', 'director')):
  require viewer = 'service:operator' else FORBIDDEN
  return upsert roles[principal] { principal, role }

mutation enrollApplicant():
  require not exists roles[viewer] else ALREADY_ENROLLED
  return insert roles { principal: viewer, role: 'applicant' }

query myRole():
  return roles[viewer]

query roster(c: cursor ?):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  return roles first 100 by .id after c

query board(c: cursor ?):
  return animals last 100 by .createdAt, .id after c

query animalDetails(animal: animals):
  return animals[animal]

query careForAnimal(animal: animals):
  return care[animal = animal]

query myCare(c: cursor ?):
  require exists roles[viewer, role = 'foster'] else FORBIDDEN
  return care where .foster = viewer first 100 by .id after c

query myApplications(c: cursor ?):
  require exists roles[viewer, role = 'applicant'] else FORBIDDEN
  return applications where .applicant = viewer last 100 by .createdAt, .id after c

query applicationsForAnimal(animal: animals, c: cursor ?):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  return applications where .animal = animal last 100 by .createdAt, .id after c

query applicationDetails(application: applications):
  return applications[application]

query referenceCheck(application: applications):
  return referenceChecks[application = application]

mutation createAnimal(name: text 1..60, species: enum('dog', 'cat'), ageMonths: int 0..360, description: text 1..1000, feeCents: int 0..100000, photos: [image <=5000000] 0..4, foster: principal):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  require exists roles[foster, role = 'foster'] else INVALID_FOSTER
  a = insert animals { name, species, ageMonths, description, feeCents, photos }
  insert care { animal: a.id, foster, medicalNotes: '', behaviorNotes: '' }
  return a

mutation assignFoster(animal: animals, foster: principal):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  require exists roles[foster, role = 'foster'] else INVALID_FOSTER
  a = animals[animal] ! else NOT_FOUND
  require a.status != 'adopted' else ALREADY_ADOPTED
  update care[animal = animal] { foster }

mutation saveCareNotes(animal: animals, medicalNotes: text <=4000, behaviorNotes: text <=4000):
  row = care[animal = animal] ! else NOT_FOUND
  update care[row.id] { medicalNotes, behaviorNotes }

mutation apply(animal: animals, fullName: text 1..100, homeAddress: text 5..500, motivation: text 10..2000):
  require exists roles[viewer, role = 'applicant'] else FORBIDDEN
  a = animals[animal] ! else NOT_FOUND
  require a.status = 'fostered' else NOT_AVAILABLE
  return insert applications { animal, applicant: viewer, fullName, homeAddress, motivation }

mutation saveReferenceCheck(application: applications, verdict: enum('cleared', 'concern'), notes: text 1..4000):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = applications[application] ! else NOT_FOUND
  require row.status = 'submitted' or row.status = 'pending' else APPLICATION_CLOSED
  return upsert referenceChecks[application] { application, verdict, notes, checkedBy: viewer, checkedAt: now }

mutation markPending(application: applications):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = applications[application] ! else NOT_FOUND
  a = animals[row.animal] ! else NOT_FOUND
  require row.status = 'submitted' and a.status = 'fostered' else NOT_AVAILABLE
  update applications[application] { status: 'pending' }
  update animals[a.id] { status: 'pending' }

mutation approveAdoption(application: applications):
  require exists roles[viewer, role = 'director'] else FORBIDDEN
  row = applications[application] ! else NOT_FOUND
  a = animals[row.animal] ! else NOT_FOUND
  check = referenceChecks[application = application] ! else REFERENCES_REQUIRED
  require check.verdict = 'cleared' else REFERENCES_REQUIRED
  require row.status = 'pending' and a.status = 'pending' else NOT_PENDING
  update applications[application] { status: 'adopted', adoptedAt: now, returnBy: now + 14d, feePaidCents: a.feeCents }
  update animals[a.id] { status: 'adopted' }

mutation returnAnimal(application: applications):
  require exists roles[viewer, role = 'applicant'] else FORBIDDEN
  row = applications[application] ! else NOT_FOUND
  require row.applicant = viewer else NOT_FOUND
  require row.status = 'adopted' else NOT_ADOPTED
  require row.returnBy != null and now <= row.returnBy else RETURN_WINDOW_CLOSED
  a = animals[row.animal] ! else NOT_FOUND
  require a.status = 'adopted' else NOT_ADOPTED
  update applications[application] { status: 'returned', returnedAt: now, refundCents: row.feePaidCents }
  update animals[a.id] { status: 'fostered' }

-- Photo placement changes always require a staff seat, regardless of foster assignment.
mutation setAnimalPhotos(animal: animals, photos: [image <=5000000] 0..4):
  require exists roles[viewer, role = 'counselor'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  a = animals[animal] ! else NOT_FOUND
  update animals[a.id] { photos }
  return animals[a.id]
