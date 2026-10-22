-- Daycare Enrollment Waitlist.
-- Roles: family, teacher, office, director. Password identity; roles are
-- provisioned by the local operator (service:operator), never self-claimed.
-- A family files an application (immunization scan + fee required). Staff
-- move children waitlisted -> offered -> enrolled. Offers expire 7 days
-- after they are made. Immunization records older than 365 days must be
-- renewed before offer/accept/direct-enroll. Only the director can skip
-- the waitlist. Teachers see enrolled children only, and never financials.

use identity password

table roles:
  principal: principal
  role: enum('family', 'teacher', 'office', 'director')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('family', 'teacher', 'office', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role }

query myRole():
  return roles[principal = viewer]

table children:
  family: principal
  childName: text 1..80
  dob: time
  photo: image <=5000000
  allergies: text <=500
  napNotes: text <=1000
  pickupList: text <=500
  income: int read <- .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
  subsidy: enum('none', 'partial', 'full') read <- .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
  balance: int read <- .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
  immunRecord: image <=10000000
  immunDate: time
  feePaid: bool default false
  status: enum('waitlisted', 'offered', 'enrolled', 'expired', 'withdrawn') default 'waitlisted'
  appliedAt: time default now
  offeredAt: time ?
  enrolledAt: time ?
  immutable family
  read <- .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] or (exists roles[principal = viewer, role = 'teacher'] and .status = 'enrolled')
  insert <- .family = viewer and exists roles[principal = viewer, role = 'family']
  update <- .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
  online only

-- Families file their own application. The fee is collected at submit, so
-- feePaid is always stored true; no later mutation can clear it.
mutation apply(childName: text 1..80, dob: time, photo: image <=5000000, allergies: text <=500, napNotes: text <=1000, pickupList: text <=500, income: int, subsidy: enum('none', 'partial', 'full'), immunRecord: image <=10000000, immunDate: time):
  require exists roles[principal = viewer, role = 'family'] else NOT_FAMILY 'Only a family account can file an application.'
  require dob <= now else BAD_DOB 'Date of birth cannot be in the future.'
  require immunDate <= now else IMMUN_FUTURE 'The immunization record date cannot be in the future.'
  require immunDate >= now - 730d else IMMUN_TOO_OLD 'The immunization record is too old to file; get a new one first.'
  require income >= 0 else BAD_INCOME 'Income cannot be negative.'
  return insert children { family: viewer, childName, dob, photo, allergies, napNotes, pickupList, income, subsidy, balance: 0, immunRecord, immunDate, feePaid: true, status: 'waitlisted' }

-- Renew the immunization scan after it goes stale (older than 365 days).
mutation renewImmunization(child: children, immunRecord: image <=10000000, immunDate: time):
  c = children[child] ! else NOT_FOUND
  require c.family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_OWNER
  require immunDate <= now else IMMUN_FUTURE 'The immunization record date cannot be in the future.'
  require immunDate >= now - 730d else IMMUN_TOO_OLD 'The immunization record is too old; get a new one first.'
  update children[child] { immunRecord, immunDate }
  return null

-- Office or director offers a waitlisted child a place. Stale immunization
-- blocks the offer even before the deadline logic matters.
mutation offer(child: children):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_STAFF 'Only office staff or the director can make offers.'
  c = children[child] ! else NOT_FOUND
  require c.status = 'waitlisted' else BAD_STATUS 'Only a waitlisted child can be offered a place.'
  require c.immunDate >= now - 365d else IMMUN_STALE 'The immunization record is older than 365 days and must be renewed first.'
  update children[child] { status: 'offered', offeredAt: now }
  return null

-- The family accepts within 7 days of the offer. The same 7-day bound is
-- enforced here and by the sweep below, so writes stop exactly at the deadline.
mutation acceptOffer(child: children):
  c = children[child] ! else NOT_FOUND
  require c.family = viewer else NOT_OWNER 'Only the child\u2019s own family can accept the offer.'
  require c.status = 'offered' else BAD_STATUS 'There is no open offer to accept.'
  require c.offeredAt != null else NO_OFFER 'There is no open offer to accept.'
  require c.offeredAt + 7d > now else OFFER_EXPIRED 'The offer expired seven days after it was made.'
  require c.immunDate >= now - 365d else IMMUN_STALE 'The immunization record is older than 365 days and must be renewed first.'
  update children[child] { status: 'enrolled', enrolledAt: now }
  return null

-- The family (or office/director) withdraws a pending application.
mutation withdraw(child: children):
  c = children[child] ! else NOT_FOUND
  require c.family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_OWNER
  require c.status = 'waitlisted' or c.status = 'offered' else BAD_STATUS 'Only a waitlisted or offered application can be withdrawn.'
  update children[child] { status: 'withdrawn' }
  return null

-- Only the director can skip the waitlist and enroll directly.
mutation enrollDirect(child: children):
  require exists roles[principal = viewer, role = 'director'] else NOT_DIRECTOR 'Only the director can skip the waitlist.'
  c = children[child] ! else NOT_FOUND
  require c.status = 'waitlisted' else BAD_STATUS 'Only a waitlisted child can be enrolled directly.'
  require c.immunDate >= now - 365d else IMMUN_STALE 'The immunization record is older than 365 days and must be renewed first.'
  update children[child] { status: 'enrolled', enrolledAt: now }
  return null

-- Care notes the teachers rely on: the family keeps them current.
mutation updateCare(child: children, allergies: text <=500, napNotes: text <=1000, pickupList: text <=500, photo: image <=5000000 ?):
  c = children[child] ! else NOT_FOUND
  require c.family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_OWNER
  update children[child] { allergies, napNotes, pickupList, photo: photo ?? c.photo }
  return null

-- Money fields: office and director only.
mutation updateFinancials(child: children, income: int, subsidy: enum('none', 'partial', 'full'), balance: int):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_STAFF 'Only office staff or the director can change financials.'
  c = children[child] ! else NOT_FOUND
  require income >= 0 else BAD_INCOME 'Income cannot be negative.'
  require balance >= 0 else BAD_BALANCE 'Balance cannot be negative.'
  update children[child] { income, subsidy, balance }
  return null

-- The family's own board: live statuses of their applications. Teachers see
-- enrolled children; office and director see the whole board. Anyone without
-- a role sees nothing.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'family']:
    return children where .family = viewer last 50 by .appliedAt after c
  if exists roles[principal = viewer, role = 'teacher']:
    return children where .status = 'enrolled' last 50 by .appliedAt after c
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] else NOT_STAFF
  return children last 50 by .appliedAt after c

query childProfile(child: children):
  return children[child]

-- Only office and director may read every row, so only they may read totals
-- over rows other roles cannot read. Teachers use the board (enrolled rows).
view statusCounts: count children by .status
  read <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
  online only

query statusCount(status: enum('waitlisted', 'offered', 'enrolled', 'expired', 'withdrawn')):
  return { count: statusCounts[status] }

-- Offers expire 7 days after they are made; the sweep below moves them to
-- expired. The acceptOffer mutation enforces the same bound for writes.
job expireOffers():
  for c in children:
    if c.status = 'offered' and c.offeredAt != null and c.offeredAt + 7d < now:
      update children[c.id] { status: 'expired' }

schedule sweepOffers every 1m: expireOffers

-- Security intent, stated independently from the rules above.
invariant children.read only .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director'] or (exists roles[principal = viewer, role = 'teacher'] and .status = 'enrolled')
invariant children.income read only .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
invariant children.subsidy read only .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
invariant children.balance read only .family = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'director']
invariant children.insert only .family = viewer and exists roles[principal = viewer, role = 'family']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
