use identity password

-- Staff grants are provisioned by the local store operator, never by a user's choice.
fn producer(): exists roles[principal = viewer, role = 'producer']
fn owner(): exists roles[principal = viewer, role = 'owner']
fn animator(): exists roles[principal = viewer, role = 'animator']
fn staff(): producer() or owner() or animator()
fn privateDesk(): producer() or owner()
fn production(): producer() or animator()

table roles:
  principal: principal
  role: enum('producer', 'animator', 'client', 'owner')
  label: text 1..100
  unique principal
  immutable principal
  read <- .principal = viewer or privateDesk() or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('producer', 'animator', 'client', 'owner'), label: text 1..100):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role, label }

query myRole():
  return roles[principal = viewer]

query clients(c: cursor ?):
  require privateDesk() else FORBIDDEN
  return roles where .role = 'client' last 100 by .id after c { principal, label }

table jobs:
  client: principal
  producer: principal
  title: text 3..100
  company: text 2..100
  phone: text 5..40 read <- privateDesk()
  companyAddress: text 8..300 read <- privateDesk()
  packagePrice: int 100..100000000 read <- privateDesk()
  script: file <=10000000 ('application/pdf', 'text/plain')
  storyboard: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg') ?
  voice: file <=20000000 ('audio/wav', 'audio/mpeg') ?
  preview: video <=50000000 ?
  previewAt: time ?
  stage: enum('opened', 'storyboarded', 'animated', 'voiced', 'delivered') default 'opened'
  openedAt: time default now
  immutable client, producer, title, company, phone, companyAddress, packagePrice, script, openedAt
  read <- .client = viewer or staff()
  insert <- producer() and .producer = viewer and exists roles[principal = .client, role = 'client']
  update <- staff()
  online only

query board(c: cursor ?):
  require exists roles[principal = viewer] else FORBIDDEN
  if staff():
    return jobs last 100 by .id after c
  return jobs where .client = viewer last 100 by .id after c

query job(job: jobs):
  require exists roles[principal = viewer] else FORBIDDEN
  return jobs[job]

mutation openJob(client: principal, title: text 3..100, company: text 2..100, phone: text 5..40, companyAddress: text 8..300, packagePrice: int 100..100000000, script: file <=10000000 ('application/pdf', 'text/plain')):
  require producer() else FORBIDDEN
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT
  return insert jobs { client, producer: viewer, title, company, phone, companyAddress, packagePrice, script }

mutation saveStoryboard(job: jobs, storyboard: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg')):
  require production() else FORBIDDEN
  j = jobs[job] ! else NOT_FOUND
  require j.stage = 'opened' or j.stage = 'storyboarded' else WRONG_STAGE
  return update jobs[job] { storyboard }

mutation saveVoice(job: jobs, voice: file <=20000000 ('audio/wav', 'audio/mpeg')):
  require production() else FORBIDDEN
  j = jobs[job] ! else NOT_FOUND
  require j.stage = 'animated' or j.stage = 'voiced' else WRONG_STAGE
  return update jobs[job] { voice }

mutation advanceStage(job: jobs, stage: enum('storyboarded', 'animated', 'voiced')):
  require production() else FORBIDDEN
  j = jobs[job] ! else NOT_FOUND
  require (j.stage = 'opened' and stage = 'storyboarded') or (j.stage = 'storyboarded' and stage = 'animated') or (j.stage = 'animated' and stage = 'voiced') else WRONG_STAGE
  if stage = 'storyboarded':
    require j.storyboard != null else STORYBOARD_REQUIRED
  if stage = 'voiced':
    require j.voice != null else VOICE_REQUIRED
  return update jobs[job] { stage }

mutation deliverPreview(job: jobs, preview: video <=50000000):
  require producer() else FORBIDDEN
  j = jobs[job] ! else NOT_FOUND
  require j.stage = 'voiced' else WRONG_STAGE
  return update jobs[job] { preview, previewAt: now, stage: 'delivered' }

table changeRequests:
  job: jobs
  client: principal
  previewAt: time
  reason: text 10..2000
  requestedAt: time default now
  unique job, previewAt
  immutable job, client, previewAt, reason, requestedAt
  read <- .client = viewer or staff()
  insert <- .client = viewer and exists roles[principal = viewer, role = 'client'] and exists jobs[.job, client = viewer, stage = 'delivered']
  online only

query changes(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return changeRequests where .job = job last 100 by .id after c

mutation requestChanges(job: jobs, reason: text 10..2000):
  require exists roles[principal = viewer, role = 'client'] else FORBIDDEN
  j = jobs[job] ! else NOT_FOUND
  require j.client = viewer else FORBIDDEN
  require j.stage = 'delivered' and j.previewAt != null else PREVIEW_REQUIRED
  require now <= j.previewAt + 21d else WINDOW_CLOSED 'Changes must be requested within 21 days of the preview.'
  return insert changeRequests { job, client: viewer, previewAt: j.previewAt, reason }

table approvals:
  request: changeRequests
  job: jobs
  client: principal
  approvedBy: principal
  reason: text 10..1000
  approvedAt: time default now
  unique request
  immutable request, job, client, approvedBy, reason, approvedAt
  read <- .client = viewer or staff()
  insert <- owner() and .approvedBy = viewer
  online only

query reanimations(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return approvals where .job = job last 100 by .id after c

mutation approveReanimation(request: changeRequests, reason: text 10..1000):
  require owner() else FORBIDDEN
  r = changeRequests[request] ! else NOT_FOUND
  j = jobs[r.job] ! else NOT_FOUND
  require j.previewAt = r.previewAt and j.stage = 'delivered' else STALE_REQUEST
  insert approvals { request, job: r.job, client: r.client, approvedBy: viewer, reason }
  update jobs[r.job] { stage: 'storyboarded', preview: null, previewAt: null }
  return approvals[request = request]

-- Independent privacy/authority intent from the brief.
invariant jobs.read only .client = viewer or exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'animator'] or exists roles[viewer, role = 'owner']
invariant jobs.phone read only exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'owner']
invariant jobs.companyAddress read only exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'owner']
invariant jobs.packagePrice read only exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'owner']
invariant approvals.insert only exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant changeRequests.read only .client = viewer or exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'animator'] or exists roles[viewer, role = 'owner']
invariant approvals.read only .client = viewer or exists roles[viewer, role = 'producer'] or exists roles[viewer, role = 'animator'] or exists roles[viewer, role = 'owner']
invariant jobs.insert only exists roles[viewer, role = 'producer']
invariant jobs always .script != null
