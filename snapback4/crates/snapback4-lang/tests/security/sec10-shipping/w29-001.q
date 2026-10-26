-- Antique Barometer Restorations.
-- Roles: owner, foreman, restorer, master_restorer (roster in `roles`,
-- provisioned by the local operator; see `snapback4 guide staging`).
-- Flow: foreman opens a restoration with damage photos + quoted price;
-- owner accepts within 30 days or it is packed and returned; restorers move
-- the board dismantling -> cleaning -> refilling -> calibrating -> ready;
-- ready but uncollected after 45 days accrues a storage charge; only the
-- master restorer may approve replacing an original mercury tube, recording
-- the owner's written consent.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'foreman', 'restorer', 'master_restorer')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'foreman', 'restorer', 'master_restorer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table restorations:
  owner: principal
  title: text 3..120
  dialPhoto: text 1..500
  tubePhoto: text 1..500
  casePhoto: text 1..500
  quotePrice: int 1..100000000
  quotedAt: time
  acceptedAt: time ?
  stage: enum('quoted', 'dismantling', 'cleaning', 'refilling', 'calibrating', 'ready', 'collected', 'returned') default 'quoted'
  readyAt: time ?
  collectedAt: time ?
  storageCents: int 0..100000000 default 0
  tubeReplaced: bool default false
  tubeConsent: text 10..2000 ?
  tubeApprovedAt: time ?
  tubeApprovedBy: principal ?
  tubeInstruction: enum('retain_original', 'replacement_approved') default 'retain_original'
  immutable owner, quotedAt
  cap 500 by owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'master_restorer']
  insert <- exists roles[principal = viewer, role = 'foreman']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'master_restorer']
  online only

-- Owners see only their own barometers; foreman, restorer and
-- master_restorer see the live workshop board (every restoration).
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'master_restorer']:
    return restorations last 50 by .id after c
  return restorations where .owner = viewer last 50 by .id after c

query detail(which: restorations):
  return restorations[which]

mutation openRestoration(owner: principal, title: text 3..120, dialPhoto: text 1..500, tubePhoto: text 1..500, casePhoto: text 1..500, quotePrice: int 1..100000000):
  require exists roles[principal = viewer, role = 'foreman'] else NOT_FOREMAN 'Only the workshop foreman can open a restoration.'
  return insert restorations { owner, title, dialPhoto, tubePhoto, casePhoto, quotePrice, quotedAt: now, tubeInstruction: 'retain_original' }

mutation acceptQuote(which: restorations):
  r = restorations[which] ! else NOT_FOUND
  require r.owner = viewer else NOT_OWNER 'Only the owning owner can accept this quote.'
  require r.stage = 'quoted' else BAD_STAGE 'This quote is no longer open.'
  require now <= r.quotedAt + 30d else QUOTE_EXPIRED 'The 30-day acceptance window has passed.'
  update restorations[which] { stage: 'dismantling', acceptedAt: now }
  return null

mutation advanceStage(which: restorations, to: enum('cleaning', 'refilling', 'calibrating', 'ready')):
  r = restorations[which] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'master_restorer'] else NOT_RESTORER 'Only a restorer can move the workshop board.'
  require r.stage = 'dismantling' and to = 'cleaning' or r.stage = 'cleaning' and to = 'refilling' or r.stage = 'refilling' and to = 'calibrating' or r.stage = 'calibrating' and to = 'ready' else BAD_TRANSITION 'Move one step along dismantling, cleaning, refilling, calibrating, ready.'
  if to = 'ready':
    update restorations[which] { stage: 'ready', readyAt: now }
  else:
    update restorations[which] { stage: to }
  return null

mutation collectBarometer(which: restorations):
  r = restorations[which] ! else NOT_FOUND
  require r.stage = 'ready' else BAD_STAGE 'This barometer is not ready for collection.'
  require r.owner = viewer or exists roles[principal = viewer, role = 'foreman'] else NOT_ALLOWED 'Only the owner or the foreman can hand over a barometer.'
  update restorations[which] { stage: 'collected', collectedAt: now }
  return null

mutation approveTubeReplacement(which: restorations, consent: text 10..2000):
  r = restorations[which] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'master_restorer'] else NOT_MASTER 'Only the master restorer can approve replacing an original mercury tube.'
  require r.stage = 'dismantling' or r.stage = 'cleaning' or r.stage = 'refilling' or r.stage = 'calibrating' or r.stage = 'ready' else BAD_STAGE 'Tube replacement needs a restoration in progress.'
  update restorations[which] { tubeReplaced: true, tubeConsent: consent, tubeApprovedAt: now, tubeApprovedBy: viewer, tubeInstruction: 'replacement_approved' }
  return null

mutation setTubeInstruction(which: restorations, instruction: enum('retain_original', 'replacement_approved')):
  r = restorations[which] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'master_restorer'] else NOT_MASTER 'Only the master restorer may change the tube handling instruction.'
  update restorations[which] { tubeInstruction: instruction }
  return null

-- A quoted barometer whose owner never accepts within 30 days is packed and
-- returned. The sweep looks back from the period end so one run catches up
-- across coalesced schedule windows.
job sweepQuotes(periodStart: time, periodEnd: time):
  for r in restorations where .quotedAt >= periodEnd - 60d and .quotedAt < periodEnd by .quotedAt:
    if r.stage = 'quoted':
      if r.quotedAt + 30d < now:
        update restorations[r.id] { stage: 'returned' }

schedule quoteSweeper every 1d at 03:00: sweepQuotes

-- A restored barometer uncollected 45 days after its ready notice accrues
-- $5.00 per late day in storageCents.
job sweepStorage(periodStart: time, periodEnd: time):
  for r in restorations where .quotedAt >= periodEnd - 400d and .quotedAt < periodEnd by .quotedAt:
    if r.stage = 'ready':
      if r.readyAt != null:
        if r.readyAt + 45d < now:
          late = (now - r.readyAt - 45d) / 1d
          update restorations[r.id] { storageCents: late * 500 }

schedule storageSweeper every 1d at 03:30: sweepStorage

-- Every restoration carries a tube handling instruction: 'retain_original'
-- unless the master restorer's tube-replacement approval is recorded, in
-- which case 'replacement_approved'. The backfill reads the pre-patch row:
-- approved rows move forward as 'replacement_approved', all others keep the
-- literal default 'retain_original'. Newly opened restorations are always
-- 'retain_original' (see openRestoration); only the master restorer may
-- change the instruction afterwards (see setTubeInstruction), and replacing
-- a tube still needs the owner's written consent (see
-- approveTubeReplacement).
backfill restorations tubeInstructionFill(tubeReplaced: bool): {tubeInstruction: 'replacement_approved' if tubeReplaced else 'retain_original'}

-- Spec privacy intent, stated separately from the table rules.
invariant restorations.acceptQuote only .owner = viewer
invariant restorations.approveTubeReplacement only exists roles[principal = viewer, role = 'master_restorer']
invariant restorations.setTubeInstruction only exists roles[principal = viewer, role = 'master_restorer']
