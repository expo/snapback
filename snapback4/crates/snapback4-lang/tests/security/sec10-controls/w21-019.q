use identity password

-- Enrollment is controlled by the local store operator, never by signup data.
table roles:
  principal: principal
  role: enum('funeral_home', 'operator', 'manager')
  home: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('funeral_home', 'operator', 'manager'), home: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, home }

query me():
  return roles[viewer] ! else NO_ROLE 'Your account has not been enrolled. Contact the crematory.'

table cases:
  home: text 1..80
  decedent: text 2..120
  reference: text 2..80
  tagCode: text 2..80
  authorization: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?
  tagPhoto: image <=5000000
  authorizationRoute: enum('manager_approved_exception', 'signed_authorization', 'awaiting_authorization')
  authorizationRouteUpdatedAt: time
  hasSignature: bool
  signedAt: time ?
  eligibleAt: time ?
  status: enum('arrived', 'verified', 'cremating', 'ready', 'released')
  createdBy: principal
  arrivedAt: time
  verifiedBy: principal ?
  courtOrder: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?
  exceptionReason: text 10..1000 ?
  approvedBy: principal ?
  approvedAt: time ?
  startedAt: time ?
  crematedAt: time ?
  releasedAt: time ?
  releasedTo: text 2..120 ?
  overdueFlag: bool default false
  immutable home, decedent, reference, tagCode, authorization, tagPhoto, hasSignature, signedAt, createdBy, arrivedAt
  read <- exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'funeral_home', home = .home]
  insert <- .createdBy = viewer and exists roles[viewer, role = 'funeral_home', home = .home] and .status = 'arrived'
  update <- exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager']
  online only

-- An immutable record of each custody event, with the same tenant boundary.
table events:
  caseId: cases
  home: text 1..80
  actor: principal
  action: text 2..80
  note: text 1..1000
  at: time
  immutable caseId, home, actor, action, note, at
  read <- exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'funeral_home', home = .home]
  insert <- .actor = viewer and (exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'funeral_home', home = .home])
  online only

invariant roles.role write only viewer = 'service:operator'
invariant cases.read only exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'funeral_home', home = .home]
invariant cases.approveException only exists roles[viewer, role = 'manager']
invariant cases.courtOrder update only exists roles[viewer, role = 'manager']
invariant events.read only exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'funeral_home', home = .home]

query listCases(c: cursor ?):
  role = roles[viewer] ! else NO_ROLE
  if role.role = 'funeral_home':
    return cases where .home = role.home last 100 by .arrivedAt after c { *, overdue: .status = 'ready' and .crematedAt != null and now >= .crematedAt + 120d }
  return cases last 100 by .arrivedAt after c { *, overdue: .status = 'ready' and .crematedAt != null and now >= .crematedAt + 120d }

query caseDetail(caseId: cases):
  require exists roles[viewer] else NO_ROLE
  return cases[caseId] ! else NOT_FOUND

query history(caseId: cases, c: cursor ?):
  role = roles[viewer] ! else NO_ROLE
  row = cases[caseId] ! else NOT_FOUND
  if role.role = 'funeral_home':
    return events where .caseId = row.id and .home = role.home first 100 by .at after c
  return events where .caseId = row.id first 100 by .at after c

mutation createCase(decedent: text 2..120, reference: text 2..80, tagCode: text 2..80, authorization: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?, tagPhoto: image <=5000000, hasSignature: bool, signedAt: time ?):
  role = roles[viewer] ! else NO_ROLE
  require role.role = 'funeral_home' else NOT_FUNERAL_HOME
  if hasSignature:
    require authorization != null else AUTHORIZATION_SCAN_REQUIRED
    require signedAt != null else SIGNATURE_DATE_REQUIRED
    require signedAt <= now and signedAt >= now - 365d else BAD_SIGNATURE_DATE
  else:
    require signedAt = null else UNSIGNED_DATE_FORBIDDEN
  row = insert cases { authorizationRouteUpdatedAt: now, authorizationRoute: 'signed_authorization' if hasSignature and authorization != null else 'awaiting_authorization', home: role.home, decedent, reference, tagCode, authorization, tagPhoto, hasSignature, signedAt, eligibleAt: signedAt + 48h if signedAt != null else null, status: 'arrived', createdBy: viewer, arrivedAt: now }
  insert events { caseId: row.id, home: role.home, actor: viewer, action: 'Arrival', note: 'Authorization and identification tag received.', at: now }
  return row

mutation verifyTag(caseId: cases, tagCode: text 2..80):
  require exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  row = cases[caseId] ! else NOT_FOUND
  require row.status = 'arrived' else BAD_STATUS
  require tagCode = row.tagCode else TAG_MISMATCH
  update cases[caseId] { status: 'verified', verifiedBy: viewer }
  insert events { caseId, home: row.home, actor: viewer, action: 'Identification verified', note: 'Physical identification tag matched the case.', at: now }

mutation approveException(caseId: cases, courtOrder: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png'), reason: text 10..1000):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  row = cases[caseId] ! else NOT_FOUND
  require not row.hasSignature else SIGNATURE_PRESENT
  require row.approvedAt = null else ALREADY_APPROVED
  require row.status = 'arrived' or row.status = 'verified' else BAD_STATUS
  update cases[caseId] { authorizationRouteUpdatedAt: now, authorizationRoute: 'manager_approved_exception', courtOrder, exceptionReason: reason, approvedBy: viewer, approvedAt: now, eligibleAt: now + 48h }
  insert events { caseId, home: row.home, actor: viewer, action: 'Court-order exception approved', note: reason, at: now }

mutation startCremation(caseId: cases, tagCode: text 2..80):
  require exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  row = cases[caseId] ! else NOT_FOUND
  require row.status = 'verified' else BAD_STATUS
  require tagCode = row.tagCode else TAG_MISMATCH
  require (row.hasSignature and row.authorization != null) or (row.courtOrder != null and row.approvedAt != null and row.exceptionReason != null) else MISSING_SIGNATURE
  require row.eligibleAt != null and now >= row.eligibleAt else WAIT_48_HOURS 'The 48-hour waiting period has not ended.'
  update cases[caseId] { status: 'cremating', startedAt: now }
  insert events { caseId, home: row.home, actor: viewer, action: 'Cremation started', note: 'Tag confirmed; authorization and waiting period checked.', at: now }

mutation completeCremation(caseId: cases, tagCode: text 2..80):
  require exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  row = cases[caseId] ! else NOT_FOUND
  require row.status = 'cremating' else BAD_STATUS
  require tagCode = row.tagCode else TAG_MISMATCH
  update cases[caseId] { status: 'ready', crematedAt: now }
  insert events { caseId, home: row.home, actor: viewer, action: 'Ready for collection', note: 'Cremation complete; identification tag remains with the remains.', at: now }

mutation releaseRemains(caseId: cases, tagCode: text 2..80, collectedBy: text 2..120):
  require exists roles[viewer, role = 'operator'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  row = cases[caseId] ! else NOT_FOUND
  require row.status = 'ready' else BAD_STATUS
  require tagCode = row.tagCode else TAG_MISMATCH
  update cases[caseId] { status: 'released', releasedAt: now, releasedTo: collectedBy, overdueFlag: false }
  insert events { caseId, home: row.home, actor: viewer, action: 'Released', note: 'Collected by ' + collectedBy, at: now }

-- Catch up all unfinished cases, including after downtime. Exact query flags
-- use now, so a home sees an overdue flag even between scheduled sweeps.
job flagUncollected():
  for row in cases:
    if row.status = 'ready' and row.crematedAt != null and now >= row.crematedAt + 120d and not row.overdueFlag:
      update cases[row.id] { overdueFlag: true }
schedule collectionCheck every 1h: flagUncollected

mutation setAuthorizationRoute(caseId: cases, route: enum('manager_approved_exception', 'signed_authorization', 'awaiting_authorization')):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  row = cases[caseId] ! else NOT_FOUND
  update cases[caseId] { authorizationRouteUpdatedAt: now, authorizationRoute: route }
  insert events { caseId, home: row.home, actor: viewer, action: 'Authorization route changed', note: route, at: now }

invariant cases.authorizationRoute update only exists roles[viewer, role = 'manager']
