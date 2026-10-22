-- Mobile Notary Signings.
-- Roles: owner (agency owner), dispatcher, notary, title_company.
-- A signing always carries the signer's ID scan and the signing fee.
-- Notaries read operational fields but never the fee or billing notes;
-- only dispatcher/owner read those. Title companies read only their own
-- signings. Status flows requested -> assigned -> signed -> returned, and
-- returned must land within 24h of signing. Only the owner approves a
-- notary for out-of-state papers.
use identity password
use personas alice, bob

-- Roster: exactly one role per principal. Only the local operator
-- (staging/production bootstrap) writes it; app code never self-assigns.
table roles:
  principal: principal
  role: enum('owner', 'dispatcher', 'notary', 'title_company')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  cap 1000
  online only

mutation provision(principal: principal, role: enum('owner', 'dispatcher', 'notary', 'title_company')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Out-of-state approval per notary. Notaries register themselves; only the
-- owner flips the approval flag.
table notaryProfiles:
  principal: principal
  approvedOutOfState: bool default false
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
  insert <- .principal = viewer
  update <- exists roles[principal = viewer, role = 'owner']
  cap 1000
  online only

mutation registerNotary():
  require exists roles[principal = viewer, role = 'notary'] else NOT_NOTARY
  if exists notaryProfiles[principal = viewer]:
    return notaryProfiles[principal = viewer]
  return insert notaryProfiles { principal: viewer }

mutation approveNotary(notary: principal, approved: bool):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the agency owner approves notaries for out-of-state papers.'
  require exists roles[principal = notary, role = 'notary'] else NOT_A_NOTARY 'That principal is not a notary.'
  p = notaryProfiles[principal = notary] ! else NOT_REGISTERED 'That notary has not registered.'
  update notaryProfiles[p.id] { approvedOutOfState: approved }
  return null

query notaryDirectory():
  return roles where .role = 'notary' first 100 by .principal

query approvalDirectory():
  return notaryProfiles first 100 by .principal

table signings:
  titleCompany: principal
  notary: principal ?
  signerName: text 1..120
  address: text 1..300
  documents: [text <=200] 1..20
  idScan: image <=10000000
  fee: money USD
  agencyBillingNotes: text <=2000 ? renamed from billingNotes
  outOfState: bool default false
  status: enum('requested', 'assigned', 'signed', 'returned') default 'requested'
  signedAt: time ?
  returnedAt: time ?
  createdAt: time default now
  immutable titleCompany, createdAt
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'notary'] or .titleCompany = viewer
  read (fee, agencyBillingNotes) <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
  insert <- exists roles[principal = viewer, role = 'title_company'] and .titleCompany = viewer
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher'] or .notary = viewer
  cap 5000
  online only

-- Title companies file signing requests for themselves. The ID scan and the
-- fee are required: omitting either refuses at decode time.
mutation createSigning(signerName: text 1..120, address: text 1..300, documents: [text <=200] 1..20, idScan: image <=10000000, fee: money USD, agencyBillingNotes: text <=2000 ? alias billingNotes, outOfState: bool ?):
  require exists roles[principal = viewer, role = 'title_company'] else NOT_TITLE_COMPANY
  return insert signings { titleCompany: viewer, signerName, address, documents, idScan, fee, agencyBillingNotes, outOfState: outOfState ?? false }

-- Dispatchers and the owner assign a registered notary. Out-of-state papers
-- need an owner-approved notary.
mutation assignSigning(signing: signings, notary: principal):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only dispatch staff assign signings.'
  require exists roles[principal = notary, role = 'notary'] else NOT_A_NOTARY 'That principal is not a notary.'
  s = signings[signing] ! else NOT_FOUND
  require s.status = 'requested' else BAD_STATUS 'Only requested signings can be assigned.'
  if s.outOfState:
    p = notaryProfiles[principal = notary] ! else NOT_APPROVED 'That notary is not approved for out-of-state papers.'
    require p.approvedOutOfState else NOT_APPROVED 'That notary is not approved for out-of-state papers.'
  update signings[signing] { notary, status: 'assigned' }
  return null

-- The assigned notary (or dispatch staff) records the signing.
mutation markSigned(signing: signings):
  s = signings[signing] ! else NOT_FOUND
  require s.status = 'assigned' else BAD_STATUS 'Only assigned signings can be marked signed.'
  require s.notary = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_ASSIGNED 'Only the assigned notary or dispatch staff records the signing.'
  update signings[signing] { status: 'signed', signedAt: now }
  return null

-- Signed papers ship back within one day of signing; later returns refuse.
mutation markReturned(signing: signings):
  s = signings[signing] ! else NOT_FOUND
  require s.status = 'signed' else BAD_STATUS 'Only signed signings can be marked returned.'
  require s.signedAt != null else BAD_STATUS 'This signing has no signing time.'
  require now <= s.signedAt + 24h else RETURN_OVERDUE 'Signed papers must ship back within one day of signing.'
  require s.notary = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_ASSIGNED 'Only the assigned notary or dispatch staff records the return.'
  update signings[signing] { status: 'returned', returnedAt: now }
  return null

-- Dispatch staff adjust the fee charged to the title company. Only the
-- agency owner may change the agency billing notes; the dispatcher may
-- still read them but cannot change them.
mutation updateBilling(signing: signings, fee: money USD, agencyBillingNotes: text <=2000 ? alias billingNotes):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only dispatch staff edits billing.'
  s = signings[signing] ! else NOT_FOUND
  if agencyBillingNotes != s.agencyBillingNotes:
    require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER_NOTES 'Only the agency owner changes agency billing notes.'
  update signings[signing] { fee, agencyBillingNotes }
  return null

-- Live dispatch board: every caller sees exactly the rows (and columns)
-- their rules admit, newest arrivals last.
query board(c: cursor ?):
  return signings first 100 by .id after c

query signingDetail(signing: signings):
  return signings[signing]

-- Privacy intent, stated independently from the rules above.
invariant signings.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'notary'] or .titleCompany = viewer
invariant signings.fee read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
invariant signings.agencyBillingNotes read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
invariant signings.updateBilling only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher']
invariant signings.insert only exists roles[principal = viewer, role = 'title_company']
invariant notaryProfiles.approveNotary only exists roles[principal = viewer, role = 'owner']
invariant notaryProfiles.approvedOutOfState update only exists roles[principal = viewer, role = 'owner']
invariant signings.assignSigning only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
