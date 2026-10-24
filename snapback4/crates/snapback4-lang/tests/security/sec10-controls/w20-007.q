use identity password

table roles:
  principal: principal
  role: enum('customer', 'upholsterer', 'owner')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'upholsterer', 'owner'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'customer' first 100 by .id after c

table jobs:
  customer: principal
  piece: text 1..120
  fabric: text 1..160
  laborCents: int 0..10000000
  fabricCents: int 0..10000000
  intakePhoto: image <=5000000
  createdAt: time
  approveBy: time
  approval: enum('pending', 'approved', 'lost') default 'pending'
  approvedAt: time ?
  fabricState: enum('not_ordered', 'ordered', 'arrived', 'cut', 'returned') default 'not_ordered'
  arrivedAt: time ?
  cutBy: time ?
  stage: enum('intake', 'recovering', 'complete') default 'intake'
  frame: enum('sound', 'waiting', 'approved', 'repaired') default 'sound'
  frameNote: text 1..1000 ?
  agreement: text 1..1000 ?
  rebuildCents: int 1..10000000 ?
  rebuildApprovedBy: principal ?
  rebuildApprovedAt: time ?
  immutable customer, piece, fabric, laborCents, fabricCents, intakePhoto, createdAt, approveBy
  read <- .customer = viewer or exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner']
  update <- .customer = viewer or exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner']
  online only

table photos:
  job: jobs
  photo: image <=5000000
  caption: text 1..200
  at: time
  author: principal
  immutable job, photo, caption, at, author
  read <- exists jobs[.job, customer = viewer] or exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner']
  insert <- .author = viewer and (exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'])
  online only

invariant jobs.read only .customer = viewer or exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner']
invariant jobs.approveRebuild only exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant jobs always .intakePhoto != null

query listJobs(c: cursor ?):
  return jobs last 100 by .id after c

query getJob(job: jobs):
  return jobs[job]

query jobPhotos(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return photos where .job = job last 100 by .id after c

query repairQueue(c: cursor ?):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return jobs where .frame = 'waiting' first 100 by .id after c

mutation intake(customer: principal, piece: text 1..120, fabric: text 1..160, laborCents: int 0..10000000, fabricCents: int 0..10000000, intakePhoto: image <=5000000):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER
  return insert jobs { customer, piece, fabric, laborCents, fabricCents, intakePhoto, createdAt: now, approveBy: now + 10d }

mutation approveEstimate(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.approval = 'pending' else ALREADY_ANSWERED
  require now < j.approveBy else APPROVAL_EXPIRED
  update jobs[job] { approval: 'approved', approvedAt: now }

mutation orderFabric(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.approval = 'approved' else ESTIMATE_NOT_APPROVED
  require j.fabricState = 'not_ordered' else FABRIC_STATE
  update jobs[job] { fabricState: 'ordered' }

mutation receiveFabric(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.fabricState = 'ordered' else FABRIC_STATE
  update jobs[job] { fabricState: 'arrived', arrivedAt: now, cutBy: now + 30d }

mutation cutFabric(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.fabricState = 'arrived' else FABRIC_STATE
  require j.cutBy != null else FABRIC_STATE
  require now < j.cutBy else FABRIC_RETURN_DUE
  require j.frame != 'waiting' else FRAME_NOT_APPROVED
  update jobs[job] { fabricState: 'cut' }

mutation flagFrame(job: jobs, note: text 1..1000):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.frame = 'sound' else FRAME_STATE
  require j.stage != 'complete' else JOB_COMPLETE
  update jobs[job] { frame: 'waiting', frameNote: note }

mutation approveRebuild(job: jobs, agreement: text 1..1000, costCents: int 1..10000000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.frame = 'waiting' else FRAME_STATE
  update jobs[job] { frame: 'approved', agreement, rebuildCents: costCents, rebuildApprovedBy: viewer, rebuildApprovedAt: now }

mutation repairFrame(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.frame = 'approved' else FRAME_NOT_APPROVED
  update jobs[job] { frame: 'repaired' }

mutation startRecovering(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.approval = 'approved' else ESTIMATE_NOT_APPROVED
  require j.fabricState = 'cut' else FABRIC_NOT_CUT
  require j.frame = 'sound' or j.frame = 'repaired' else FRAME_NOT_REPAIRED
  require j.stage = 'intake' else JOB_STATE
  update jobs[job] { stage: 'recovering' }

mutation completeJob(job: jobs):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.stage = 'recovering' else JOB_STATE
  require j.frame = 'sound' or j.frame = 'repaired' else FRAME_NOT_REPAIRED
  update jobs[job] { stage: 'complete' }

mutation addPhoto(job: jobs, photo: image <=5000000, caption: text 1..200):
  require exists roles[viewer, role = 'upholsterer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert photos { job, photo, caption, at: now, author: viewer }

job deadlines(periodStart: time, periodEnd: time):
  for j in jobs by .id:
    if j.approval = 'pending' and j.approveBy <= periodEnd:
      update jobs[j.id] { approval: 'lost' }
    if j.fabricState = 'arrived' and j.cutBy != null and j.cutBy <= periodEnd:
      update jobs[j.id] { fabricState: 'returned' }

schedule sweep every 1m: deadlines
