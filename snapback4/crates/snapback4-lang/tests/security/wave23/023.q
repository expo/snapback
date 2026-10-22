use identity password

-- Roles are granted by the local operator, or self-enrolled as member only.
table roles:
  principal: principal
  role: enum('member', 'steward', 'lead')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'member')
  update <- viewer = 'service:operator'
  online only

table training:
  principal: principal
  trainedAt: time
  recordedBy: principal
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
  insert <- exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
  update <- exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
  online only

table suspensions:
  principal: principal
  incident: text 10..2000
  recordedBy: principal
  at: time default now
  unique principal
  immutable principal, incident, recordedBy, at
  read <- .principal = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
  insert <- exists roles[principal = viewer, role = 'lead']
  online only

table laserJobs:
  owner: principal
  title: text 1..100
  material: text 1..80
  minutes: int 1..240
  cutFile: file <=5000000 ('application/pdf', 'text/plain')
  materialPhoto: image <=5000000 ?
  stage: enum('queued', 'cutting', 'done', 'picked_up') default 'queued'
  approvedBy: principal ?
  approvalNote: text 5..500 ?
  approvedAt: time ?
  queuedAt: time default now
  startedAt: time ?
  cutAt: time ?
  pickedUpAt: time ?
  immutable owner, title, material, minutes, cutFile, queuedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
  insert <- .owner = viewer and exists roles[principal = viewer] and .stage = 'queued' and .approvedBy = null and .cutAt = null
  update (old, next) <- (old.owner = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']) and (old.materialPhoto = next.materialPhoto or (old.owner = viewer and exists roles[principal = viewer, role = 'member']) or exists roles[principal = viewer, role = 'lead'])
  online only

table fees:
  job: laserJobs
  owner: principal
  cents: int 75..18000
  unique job
  immutable job, owner, cents
  read <- .owner = viewer
  insert <- .owner = viewer and created laserJobs[id = .job, owner = viewer]
  online only

shape jobCard = { *, materialPhotoNeeded: .materialPhoto = null, status: 'free_bin' if .stage = 'done' and .cutAt != null and now >= .cutAt + 14d else .stage, pickupBy: .cutAt + 14d if .cutAt != null else null }

mutation provision(principal: principal, role: enum('member', 'steward', 'lead'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  require len(trim(name)) >= 1 else NAME_REQUIRED
  return upsert roles[principal] { principal, role, name: trim(name) }

mutation enroll(name: text 1..80):
  require not exists roles[principal = viewer] else ALREADY_ENROLLED
  require len(trim(name)) >= 1 else NAME_REQUIRED
  return insert roles {principal: viewer, role: 'member', name: trim(name)}

query me():
  return { account: roles[principal = viewer], training: training[principal = viewer], suspension: suspensions[principal = viewer], serverNow: now }

query policy():
  return { safeMaterials: ['Birch plywood', 'Cast acrylic', 'Cardboard'], centsPerMinute: 75, trainingDays: 365, pickupDays: 14 }

query myJobs():
  return laserJobs where .owner = viewer last 200 by .queuedAt jobCard

query job(job: laserJobs):
  return laserJobs[job] jobCard

query myFees():
  return fees where .owner = viewer last 200 by .id

query fee(job: laserJobs):
  return fees[job = job]

query board():
  require exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] else STAFF_ONLY
  return laserJobs last 300 by .queuedAt jobCard

query roster():
  require exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] else STAFF_ONLY
  return roles first 300 by .id { *, training: training[principal = .principal], suspension: suspensions[principal = .principal] }

mutation recordTraining(principal: principal):
  require exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] else STAFF_ONLY
  person = roles[principal = principal] ! else NO_MEMBER
  return upsert training[principal] { principal, trainedAt: now, recordedBy: viewer }

mutation submitJob(title: text 1..100, material: text 1..80, minutes: int 1..240, cutFile: file <=5000000 ('application/pdf', 'text/plain'), materialPhoto: image <=5000000 ?):
  require len(trim(title)) >= 1 and len(trim(material)) >= 1 else PROJECT_FIELDS_REQUIRED
  person = roles[principal = viewer] ! else ENROLL_FIRST
  require not exists suspensions[principal = viewer] else SUSPENDED 'Membership is suspended after a fire. Contact the shop lead.'
  passed = training[principal = viewer] ! else TRAINING_REQUIRED
  require passed.trainedAt <= now and passed.trainedAt >= now - 365d else TRAINING_EXPIRED 'Laser training must be within the last 365 days.'
  require cutFile.bytes > 0 else FILES_REQUIRED
  require materialPhoto = null or materialPhoto.bytes > 0 else PHOTO_REQUIRED
  row = insert laserJobs { owner: viewer, title, material, minutes, cutFile, materialPhoto }
  insert fees {job: row.id, owner: viewer, cents: minutes * 75}
  return row jobCard

mutation setMaterialPhoto(job: laserJobs, materialPhoto: image <=5000000):
  row = laserJobs[job] ! else NOT_FOUND
  require (row.owner = viewer and exists roles[principal = viewer, role = 'member']) or exists roles[principal = viewer, role = 'lead'] else PHOTO_EDITOR_ONLY
  require materialPhoto.bytes > 0 else PHOTO_REQUIRED
  update laserJobs[job] {materialPhoto}
  return laserJobs[job] jobCard

mutation approveMaterial(job: laserJobs, note: text 5..500):
  require exists roles[principal = viewer, role = 'lead'] else LEAD_ONLY
  row = laserJobs[job] ! else NOT_FOUND
  require row.stage = 'queued' else BAD_STAGE
  require row.approvedBy = null else ALREADY_APPROVED
  require len(trim(note)) >= 5 else APPROVAL_NOTE_REQUIRED
  update laserJobs[job] {approvedBy: viewer, approvalNote: note, approvedAt: now}
  return laserJobs[job] jobCard

mutation startCut(job: laserJobs):
  require exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] else STAFF_ONLY
  row = laserJobs[job] ! else NOT_FOUND
  require row.stage = 'queued' else BAD_STAGE
  require not exists suspensions[principal = row.owner] else SUSPENDED
  require row.material = 'Birch plywood' or row.material = 'Cast acrylic' or row.material = 'Cardboard' or row.approvedBy != null else MATERIAL_APPROVAL_REQUIRED
  update laserJobs[job] {stage: 'cutting', startedAt: now}
  return laserJobs[job] jobCard

mutation finishCut(job: laserJobs):
  require exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead'] else STAFF_ONLY
  row = laserJobs[job] ! else NOT_FOUND
  require row.stage = 'cutting' else BAD_STAGE
  update laserJobs[job] {stage: 'done', cutAt: now}
  return laserJobs[job] jobCard

mutation pickup(job: laserJobs):
  row = laserJobs[job] ! else NOT_FOUND
  require row.owner = viewer else OWNER_ONLY
  require row.stage = 'done' and row.cutAt != null else BAD_STAGE
  require now < row.cutAt + 14d else PICKUP_EXPIRED 'The 14-day pickup window ended. Parts are in the free bin.'
  update laserJobs[job] {stage: 'picked_up', pickedUpAt: now}
  return laserJobs[job] jobCard

mutation suspendMember(principal: principal, incident: text 10..2000):
  require exists roles[principal = viewer, role = 'lead'] else LEAD_ONLY
  require len(trim(incident)) >= 10 else INCIDENT_REQUIRED
  person = roles[principal = principal] ! else NO_MEMBER
  require person.role = 'member' else MEMBER_ONLY
  require not exists suspensions[principal = principal] else ALREADY_SUSPENDED
  return insert suspensions {principal, incident, recordedBy: viewer}

invariant fees.read only .owner = viewer
invariant laserJobs.read only .owner = viewer or exists roles[principal = viewer, role = 'steward'] or exists roles[principal = viewer, role = 'lead']
invariant roles.update only viewer = 'service:operator'
invariant suspensions.insert only exists roles[principal = viewer, role = 'lead']
