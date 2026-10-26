-- Honor Guard Details: funeral homes request honor-guard details for
-- military funeral honors; members sign up; short details escalate.
-- Grammar: `npx snapback4 guide language`.
use identity password

-- Roster: commander, scheduler (scheduling officer), member, funeral home.
table roles:
  principal: principal
  role: enum('commander', 'scheduler', 'member', 'funeral')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'commander']
  insert <- viewer = 'service:operator' or (.principal = viewer and (.role = 'member' or .role = 'funeral'))
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- One funeral request / honor-guard detail. Discharge papers and the
-- family's request live in `papers` so members and funeral homes can read
-- detail rows without ever reaching them.
table details:
  home: principal
  veteran: text 1..120
  serviceAt: time
  location: text 1..300
  needed: int 1..50
  status: enum('open', 'assigned', 'completed', 'cancelled') default 'open'
  escalated: bool default false
  immutable home, serviceAt
  read <- .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] or exists signups[.id, viewer] or (.status = 'open' and exists roles[viewer, role = 'member'])
  insert <- .home = viewer and exists roles[viewer, role = 'funeral']
  update <- .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
  online only

-- Uploaded evidence and verification state: commander and scheduler only.
-- `clearance` is the required papers clearance description every detail
-- carries: verified papers, a commander exception, or awaiting
-- verification. It lives here (not on `details`) so members and funeral
-- homes, who can read detail rows, can never read it.
table papers:
  detail: details
  home: principal
  requestDoc: file <=10000000
  discharge: file <=10000000
  papersVerified: bool default false
  overrideReason: text <=500 ?
  clearance: enum('verified', 'exception', 'awaiting') default 'awaiting'
  unique detail
  immutable detail, home
  read <- exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
  insert <- .home = viewer and exists roles[viewer, role = 'funeral']
  update <- .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
  online only

-- Member signups. `home` is copied from the detail at signup so the
-- funeral home's read rule needs no hop into `details`.
table signups:
  detail: details
  member: principal
  home: principal
  at: time default now
  unique detail, member else ALREADY_SIGNED_UP
  cap 50 by detail
  immutable detail, member, home
  read <- .member = viewer or .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
  insert <- .member = viewer and exists roles[viewer, role = 'member']
  delete <- .member = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
  online only

-- Public-to-role-holders occupancy over private signups.
view filled: count signups by .detail
  read <- exists roles[viewer]

mutation provision(who: principal, role: enum('commander', 'scheduler', 'member', 'funeral')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[who] { role }

-- Self-registration for non-privileged roles only; commander and
-- scheduler seats come from the operator. One row per principal, so the
-- first claim wins and later claims return null.
mutation claimRole(role: enum('member', 'funeral')):
  require role = 'member' or role = 'funeral' else BAD_ROLE
  return insert roles { principal: viewer, role } if absent

query myRole():
  return roles[viewer]

query roster(c: cursor ?):
  require exists roles[viewer, role = 'commander'] else NOT_COMMANDER
  return roles last 100 by .id after c

query homeRequests(c: cursor ?):
  require exists roles[viewer, role = 'funeral'] else NOT_FUNERAL_HOME
  return details where .home = viewer first 50 by .serviceAt after c { id, veteran, serviceAt, location, needed, status, escalated, filled: filled[.id] }

query openDetails(c: cursor ?):
  require exists roles[viewer, role = 'member'] else NOT_MEMBER
  return details where .status = 'open' first 50 by .serviceAt after c { id, veteran, serviceAt, location, needed, status, escalated, filled: filled[.id] }

query myDetails(c: cursor ?):
  require exists roles[viewer, role = 'member'] else NOT_MEMBER
  return details where exists signups[.id, viewer] first 50 by .serviceAt after c { id, veteran, serviceAt, location, needed, status, escalated, filled: filled[.id] }

query allDetails(c: cursor ?):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  return details first 100 by .serviceAt after c { id, home, veteran, serviceAt, location, needed, status, escalated, filled: filled[.id], papers: papers[detail = .id] { papersVerified, overrideReason, clearance } }

query escalated(c: cursor ?):
  require exists roles[viewer, role = 'commander'] else NOT_COMMANDER
  return details where .escalated first 50 by .serviceAt after c { id, veteran, serviceAt, location, needed, status, escalated, filled: filled[.id] }

query detailRoster(detailId: details, c: cursor ?):
  d = details[detailId] ! else NOT_FOUND
  require d.home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] or exists signups[detailId, viewer] else NOT_ALLOWED
  return signups where .detail = detailId last 50 by .at after c { id, member, at }

query detailPapers(detailId: details):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  return papers[detail = detailId]

mutation requestDetail(veteran: text 1..120, serviceAt: time, location: text 1..300, needed: int 1..50, requestDoc: file <=10000000, discharge: file <=10000000):
  require exists roles[viewer, role = 'funeral'] else NOT_FUNERAL_HOME
  require serviceAt > now else IN_THE_PAST
  d = insert details { home: viewer, veteran, serviceAt, location, needed }
  insert papers { detail: d.id, home: viewer, requestDoc, discharge }
  return d

mutation updatePapers(detailId: details, requestDoc: file <=10000000, discharge: file <=10000000):
  require exists roles[viewer, role = 'funeral'] else NOT_FUNERAL_HOME
  d = details[detailId] ! else NOT_FOUND
  require d.home = viewer else NOT_OWNER
  require d.status = 'open' else NOT_OPEN
  -- A blind upsert: the home replaces evidence without reading it, and a
  -- re-upload clears verification and any override reason, so clearance
  -- returns to awaiting verification.
  return upsert papers[detailId] { home: viewer, requestDoc, discharge, papersVerified: false, overrideReason: null, clearance: 'awaiting' }

mutation editDetail(detailId: details, location: text 1..300 ?, needed: int 1..50 ?):
  d = details[detailId] ! else NOT_FOUND
  require d.home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_ALLOWED
  require d.status = 'open' else NOT_OPEN
  n = needed ?? d.needed
  require n >= (filled[detailId] ?? 0) else TOO_SMALL
  update details[detailId] { location: location ?? d.location, needed: n }
  return details[detailId]

mutation signUp(detailId: details):
  require exists roles[viewer, role = 'member'] else NOT_MEMBER
  d = details[detailId] ! else NOT_FOUND
  require d.status = 'open' else NOT_OPEN
  require d.serviceAt > now else DEPARTED
  require not exists signups[detailId, viewer] else ALREADY_SIGNED_UP
  require (filled[detailId] ?? 0) < d.needed else FULL
  return insert signups { detail: detailId, member: viewer, home: d.home }

mutation withdraw(detailId: details):
  require exists roles[viewer, role = 'member'] else NOT_MEMBER
  d = details[detailId] ! else NOT_FOUND
  require d.status = 'open' or d.status = 'assigned' else CLOSED
  s = signups[detailId, viewer] ! else NOT_SIGNED_UP
  delete signups[s.id]

mutation unassign(detailId: details, member: principal):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  d = details[detailId] ! else NOT_FOUND
  s = signups[detailId, member] ! else NOT_SIGNED_UP
  delete signups[s.id]

-- Staff-only repair for the clearance description: recomputes it from the
-- papers row. Used once to migrate pre-v2 rows (whose clearance the deploy
-- fills as awaiting verification) and after any forward from a release that
-- cannot hold clearance writes.
mutation refreshClearance(detailId: details):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  d = details[detailId] ! else NOT_FOUND
  p = papers[detail = detailId] ! else NO_PAPERS
  if p.papersVerified:
    update papers[p.id] { clearance: 'verified' }
  else:
    if p.overrideReason != null:
      update papers[p.id] { clearance: 'exception' }
    else:
      update papers[p.id] { clearance: 'awaiting' }
  return papers[p.id]

mutation verifyPapers(detailId: details, verified: bool):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  d = details[detailId] ! else NOT_FOUND
  p = papers[detail = detailId] ! else NO_PAPERS
  -- Verification drives the clearance description: verified papers when
  -- verified; a commander exception when unverified but an override reason
  -- stands; awaiting verification otherwise.
  if verified:
    update papers[p.id] { papersVerified: verified, clearance: 'verified' }
  else:
    if p.overrideReason != null:
      update papers[p.id] { papersVerified: verified, clearance: 'exception' }
    else:
      update papers[p.id] { papersVerified: verified, clearance: 'awaiting' }
  return papers[p.id]

mutation approveDetail(detailId: details, reason: text <=500 ?):
  d = details[detailId] ! else NOT_FOUND
  require d.status = 'open' else NOT_OPEN
  p = papers[detail = detailId] ! else NO_PAPERS
  -- Approval drives the clearance description: verified papers stay
  -- verified; a commander override without verified papers records a
  -- commander exception. The commander's exclusive override authority is
  -- unchanged: only commanders approve unverified details, with a reason.
  if p.papersVerified:
    require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
    update details[detailId] { status: 'assigned' }
    update papers[p.id] { overrideReason: reason ?? p.overrideReason, clearance: 'verified' }
  else:
    require exists roles[viewer, role = 'commander'] else ONLY_COMMANDER
    require reason != null else REASON_REQUIRED
    update details[detailId] { status: 'assigned' }
    update papers[p.id] { overrideReason: reason, clearance: 'exception' }
  return details[detailId]

mutation completeDetail(detailId: details):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  d = details[detailId] ! else NOT_FOUND
  require d.status = 'assigned' else NOT_ASSIGNED
  require d.serviceAt <= now else TOO_EARLY
  update details[detailId] { status: 'completed' }

mutation cancelDetail(detailId: details):
  d = details[detailId] ! else NOT_FOUND
  require d.status = 'open' or d.status = 'assigned' else CLOSED
  require d.home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_ALLOWED
  update details[detailId] { status: 'cancelled' }

-- A detail still short of members within 48h of the service escalates.
-- The hourly schedule flips it; staff can also trigger one row directly.
mutation escalateCheck(detailId: details):
  require exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] else NOT_STAFF
  d = details[detailId] ! else NOT_FOUND
  if d.status = 'open' and not d.escalated and d.serviceAt >= now and d.serviceAt < now + 48h and (filled[detailId] ?? 0) < d.needed:
    update details[detailId] { escalated: true }
  return details[detailId]

job escalateSweep(periodStart: time, periodEnd: time):
  for d in details where .serviceAt >= periodEnd - 1d and .serviceAt < periodEnd + 48h by .serviceAt:
    if d.status = 'open' and not d.escalated and filled[d.id] < d.needed:
      update details[d.id] { escalated: true }

schedule escalation every 1h: escalateSweep

-- Independent privacy intent; `guide security` states unproved paths.
invariant details.read only .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler'] or exists signups[.id, viewer] or .status = 'open'
invariant papers.read only exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
invariant signups.read only .member = viewer or .home = viewer or exists roles[viewer, role = 'commander'] or exists roles[viewer, role = 'scheduler']
