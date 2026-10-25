-- Brass Instrument Repairs: a band instrument shop.
-- Roles: customer (instrument owner), clerk (counter), technician (bench), shop_owner.
-- Customers see only their own instruments; staff see the bench board.
-- Quotes expire after 21 days; leak warranty runs 90 days after pickup.
-- Only the shop owner may approve replacing an original valve set, with
-- the instrument owner's written consent recorded.
use identity password

table roles:
  principal: principal
  role: enum('customer','clerk','technician','shop_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'customer')
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('customer','clerk','technician','shop_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation registerAsCustomer():
  return insert roles { principal: viewer, role: 'customer' } if absent

query myRole():
  return roles[viewer]

table instruments:
  owner: principal
  kind: enum('trumpet','trombone','tuba')
  serial: text 1..60
  bellPhoto: image <=5000000
  valvesPhoto: image <=5000000
  slidesPhoto: image <=5000000
  stampPhoto: image <=5000000
  quotePrice: money USD
  quoteCreatedAt: time default now
  quoteStatus: enum('pending','approved','expired') default 'pending'
  benchStatus: enum('opened','dent_work','soldering','polished','picked_up','returned_unrepaired') default 'opened'
  pickedUpAt: time ?
  leakReportedAt: time ?
  leakFreeRepair: bool default false
  valveReplacement: bool default false
  valveConsent: text 1..500 ?
  valveApprovedAt: time ?
  immutable owner, kind, serial, bellPhoto, valvesPhoto, slidesPhoto, stampPhoto, quotePrice, quoteCreatedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner']
  insert <- exists roles[principal = viewer, role = 'clerk']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner']
  delete <- deny
  cap 500 by owner
  online only

query myInstruments(c: cursor ?):
  return instruments where .owner = viewer last 50 by .id after c

query benchBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner'] else NOT_STAFF
  return instruments last 50 by .id after c

query instrumentDetail(instrument: instruments):
  return instruments[instrument]

mutation logInstrument(owner: principal, kind: enum('trumpet','trombone','tuba'), serial: text 1..60, bellPhoto: image <=5000000, valvesPhoto: image <=5000000, slidesPhoto: image <=5000000, stampPhoto: image <=5000000, quotePrice: money USD):
  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK
  return insert instruments { owner, kind, serial, bellPhoto, valvesPhoto, slidesPhoto, stampPhoto, quotePrice }

mutation approveQuote(instrument: instruments):
  i = instruments[instrument] ! else NOT_FOUND
  require i.owner = viewer else NOT_OWNER
  require i.quoteStatus = 'pending' else ALREADY_DECIDED 'This quote is already decided.'
  require now <= i.quoteCreatedAt + 21d else QUOTE_EXPIRED 'The 21-day quote window has passed.'
  update instruments[instrument] { quoteStatus: 'approved' }
  return null

mutation advanceBench(instrument: instruments, to: enum('dent_work','soldering','polished')):
  require exists roles[principal = viewer, role = 'technician'] else NOT_TECHNICIAN
  i = instruments[instrument] ! else NOT_FOUND
  require i.quoteStatus = 'approved' else QUOTE_NOT_APPROVED 'The quote must be approved before bench work.'
  require (i.benchStatus = 'opened' and to = 'dent_work') or (i.benchStatus = 'dent_work' and to = 'soldering') or (i.benchStatus = 'soldering' and to = 'polished') else BAD_TRANSITION 'Bench work moves opened to dent work to soldering to polished.'
  update instruments[instrument] { benchStatus: to }
  return null

mutation markPickedUp(instrument: instruments):
  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK
  i = instruments[instrument] ! else NOT_FOUND
  require i.quoteStatus = 'approved' else QUOTE_NOT_APPROVED 'The quote must be approved before pickup.'
  require i.benchStatus = 'polished' else NOT_READY 'The instrument is not polished yet.'
  update instruments[instrument] { benchStatus: 'picked_up', pickedUpAt: now }
  return null

mutation reportLeak(instrument: instruments):
  i = instruments[instrument] ! else NOT_FOUND
  require i.owner = viewer else NOT_OWNER
  require i.pickedUpAt != null else NOT_PICKED_UP 'The instrument has not been picked up yet.'
  require i.leakReportedAt = null else ALREADY_REPORTED 'A leak has already been reported for this instrument.'
  require now <= i.pickedUpAt + 90d else WARRANTY_EXPIRED 'The 90-day leak warranty has passed.'
  update instruments[instrument] { leakReportedAt: now, leakFreeRepair: true }
  return null

mutation approveValveReplacement(instrument: instruments, consent: text 1..500):
  require exists roles[principal = viewer, role = 'shop_owner'] else NOT_SHOP_OWNER
  i = instruments[instrument] ! else NOT_FOUND
  require i.benchStatus != 'returned_unrepaired' and i.benchStatus != 'picked_up' else BAD_STATUS 'Valve work is closed for this instrument.'
  update instruments[instrument] { valveReplacement: true, valveConsent: consent, valveApprovedAt: now }
  return null

job expireQuotes(periodStart: time, periodEnd: time):
  for i in instruments by .id:
    if i.quoteStatus = 'pending' and i.quoteCreatedAt < periodEnd - 21d:
      update instruments[i.id] { quoteStatus: 'expired', benchStatus: 'returned_unrepaired' }

schedule expireQuotesSweep every 1d at 03:00: expireQuotes

-- Privacy intent, stated separately from enforcement.
invariant instruments.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant instruments.insert only exists roles[viewer, role = 'clerk']
invariant instruments.logInstrument only exists roles[viewer, role = 'clerk']
invariant instruments.approveValveReplacement only exists roles[viewer, role = 'shop_owner']
invariant roles.insert only viewer = 'service:operator' or (.principal = viewer and .role = 'customer')
invariant roles.provision only viewer = 'service:operator'
