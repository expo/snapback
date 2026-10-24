use identity password
use personas alice, bob, breeder

table breeders:
  principal: principal
  unique principal
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops'
  online only

table litters:
  cap 30
  title: text 1..80
  breed: text 1..80
  bornOn: text 10..10
  description: text 1..1000
  phase: enum('upcoming', 'picking', 'complete') default 'upcoming'
  queuedCount: int 0..30 default 0
  currentPosition: int 0..31 default 0
  deadline: time ?
  read <- exists breeders[viewer] or exists families[.id, viewer, approved = true]
  insert <- exists breeders[viewer]
  update <- exists breeders[viewer] or exists families[.id, viewer, approved = true]
  online only

table families:
  litter: litters
  principal: principal
  name: text 1..80
  email: text 3..120
  deposit: enum('pending', 'received', 'partial', 'refunded') default 'pending'
  balanceOwed: int 0..1000000 default 0
  approved: bool default false
  position: int 0..30 default 0
  unique litter, principal
  immutable litter, principal
  read <- .principal = viewer or exists breeders[viewer] or viewer = 'service:ops'
  insert <- exists breeders[viewer] or viewer = 'service:ops'
  update <- exists breeders[viewer]
  cap 30 by litter
  online only

table puppies:
  litter: litters
  name: text 1..60
  collar: text 1..40
  sex: enum('female', 'male')
  photoUrl: text 1..500
  pickPosition: int 1..30 ?
  immutable litter
  read <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  insert <- exists breeders[viewer]
  update <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  cap 30 by litter
  online only

table updates:
  litter: litters
  week: int 1..12
  caption: text 1..500
  photoUrl: text 1..500
  at: time default now
  immutable litter, at
  unique litter, week
  read <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  insert <- exists breeders[viewer]
  cap 12 by litter
  online only

table weights:
  puppy: puppies
  litter: litters
  week: int 1..12
  grams: int 100..20000
  immutable litter, puppy, week
  unique puppy, week
  read <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  insert <- exists breeders[viewer]
  update <- exists breeders[viewer]
  cap 12 by puppy
  cap 360 by litter
  online only

table payments:
  family: families
  litter: litters
  amount: int 1..1000000
  balanceOwed: int 0..1000000
  note: text 1..200 ?
  at: time default now
  immutable family, litter, amount, balanceOwed, note, at
  read <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  insert <- exists breeders[viewer]
  cap 60 by family
  online only

table pickLogs:
  litter: litters
  position: int 1..30
  outcome: enum('picked', 'passed')
  puppy: puppies ?
  at: time default now
  unique litter, position
  immutable litter, position, outcome, puppy, at
  read <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  insert <- exists breeders[viewer] or exists families[.litter, viewer, approved = true]
  cap 30 by litter
  online only

query myRole():
  return exists breeders[viewer]
query litterList():
  return litters first 30 by .id
query myFamily(litter: litters):
  return families[litter, viewer]
query breederWaitlist(litter: litters):
  if not exists breeders[viewer]:
    return []
  return families where .litter = litter first 30 by .id
query puppyList(litter: litters):
  return puppies where .litter = litter first 30 by .id
query weeklyUpdates(litter: litters):
  return updates where .litter = litter last 12 by .week
query weightHistory(litter: litters):
  return weights where .litter = litter first 360 by .week
query pickHistory(litter: litters):
  return pickLogs where .litter = litter first 30 by .position
query paymentHistory(family: families):
  f = families[family] ! else NOT_FOUND
  require exists breeders[viewer] or (f.principal = viewer and f.approved) else NOT_AUTHORIZED
  return payments where .family = family first 60 by .at

mutation bootstrapbreeders(seat_principal: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert breeders { principal: seat_principal }
mutation bootstrapfamilies(seat_email: text <=120, seat_litter: litters, seat_name: text <=80, seat_principal: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  l = litters[seat_litter] ! else NOT_FOUND
  return insert families { email: seat_email, litter: l.id, name: seat_name, principal: seat_principal }
mutation createLitter(title: text 1..80, breed: text 1..80, bornOn: text 10..10, description: text 1..1000):
  require exists breeders[viewer] else BREEDER_ONLY
  return insert litters { title, breed, bornOn, description }
mutation addFamily(litter: litters, principal: principal, name: text 1..80, email: text 3..120):
  require exists breeders[viewer] else BREEDER_ONLY
  l = litters[litter] ! else NOT_FOUND
  require l.phase = 'upcoming' else WAITLIST_CLOSED
  return insert families { litter, principal, name, email }
mutation recordPayment(family: families, amount: int 1..1000000, balanceOwed: int 0..1000000, note: text 1..200 ?):
  require exists breeders[viewer] else BREEDER_ONLY
  f = families[family] ! else NOT_FOUND
  update families[f.id] { balanceOwed }
  return insert payments { family: f.id, litter: f.litter, amount, balanceOwed, note }
mutation setDeposit(family: families, deposit: enum('pending', 'received', 'partial', 'refunded')):
  require exists breeders[viewer] else BREEDER_ONLY
  update families[family] { deposit }
mutation approveFamily(family: families):
  require exists breeders[viewer] else BREEDER_ONLY
  f = families[family] ! else NOT_FOUND
  l = litters[f.litter] ! else NOT_FOUND
  require l.phase = 'upcoming' else WAITLIST_CLOSED
  require not f.approved else ALREADY_APPROVED
  position = l.queuedCount + 1
  update litters[l.id] { queuedCount: position }
  update families[f.id] { approved: true, position }
mutation addPuppy(litter: litters, name: text 1..60, collar: text 1..40, sex: enum('female', 'male'), photoUrl: text 1..500):
  require exists breeders[viewer] else BREEDER_ONLY
  l = litters[litter] ! else NOT_FOUND
  require l.phase = 'upcoming' else PICKS_STARTED
  return insert puppies { litter, name, collar, sex, photoUrl }
mutation postUpdate(litter: litters, week: int 1..12, caption: text 1..500, photoUrl: text 1..500):
  require exists breeders[viewer] else BREEDER_ONLY
  l = litters[litter] ! else NOT_FOUND
  return insert updates { litter: l.id, week, caption, photoUrl }
mutation recordWeight(puppy: puppies, week: int 1..12, grams: int 100..20000):
  require exists breeders[viewer] else BREEDER_ONLY
  p = puppies[puppy] ! else NOT_FOUND
  return upsert weights[puppy, week] { puppy, litter: p.litter, week, grams }
mutation startPicks(litter: litters):
  require exists breeders[viewer] else BREEDER_ONLY
  l = litters[litter] ! else NOT_FOUND
  require l.phase = 'upcoming' else PICKS_STARTED
  require l.queuedCount > 0 else NO_APPROVED_FAMILIES
  require count(puppies where .litter = litter) >= l.queuedCount else NOT_ENOUGH_PUPPIES
  update litters[litter] { phase: 'picking', currentPosition: 1, deadline: now + 15m }
mutation choosePuppy(puppy: puppies):
  p = puppies[puppy] ! else NOT_FOUND
  l = litters[p.litter] ! else NOT_FOUND
  f = families[p.litter, viewer] ! else FAMILY_ONLY
  require f.approved else NOT_APPROVED
  require l.phase = 'picking' else PICKS_NOT_OPEN
  require f.position = l.currentPosition else NOT_YOUR_TURN 'Please wait for your pick position.'
  require l.deadline != null and now < l.deadline else TURN_EXPIRED 'Your fifteen-minute turn has expired.'
  require p.pickPosition = null else PUPPY_TAKEN
  update puppies[p.id] { pickPosition: f.position }
  insert pickLogs { litter: l.id, position: f.position, outcome: 'picked', puppy: p.id }
  if l.currentPosition < l.queuedCount:
    update litters[l.id] { currentPosition: l.currentPosition + 1, deadline: now + 15m }
  else:
    update litters[l.id] { phase: 'complete', deadline: null }
  return p.id

job passExpiredTurns():
  for l in litters:
    if l.phase = 'picking' and l.deadline != null and l.deadline <= now:
      insert pickLogs { litter: l.id, position: l.currentPosition, outcome: 'passed', puppy: null }
      if l.currentPosition < l.queuedCount:
        update litters[l.id] { currentPosition: l.currentPosition + 1, deadline: now + 15m }
      else:
        update litters[l.id] { phase: 'complete', deadline: null }
schedule pickDeadline every 1m: passExpiredTurns
