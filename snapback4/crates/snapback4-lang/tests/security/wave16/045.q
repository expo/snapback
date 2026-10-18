-- Instrument Loan Bank: youth orchestra season loans.
-- Auth: real password accounts. Roles live in the `roles` roster; the first
-- rows are seeded as the system (dev /seed); later changes go through
-- assignRole (manager) or the service:ops seat.
use identity password

table roles:
  principal: principal
  role: enum('student', 'parent', 'librarian', 'manager', 'luthier')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'manager']
  delete <- exists roles[viewer, role = 'manager']
  online only

table instruments:
  kind: text 1..80
  serial: text 1..40
  detail: text <=500 ?
  status: enum('available', 'loaned', 'written_off') default 'available'
  unique serial
  public 'the instrument catalog is public'
  insert <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  online only

table seasons:
  name: text 1..80
  endsAt: time
  immutable endsAt
  public 'season dates are public'
  insert <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager']
  online only

table loans:
  instrument: instruments
  borrower: principal
  season: seasons
  seasonEndsAt: time
  checkoutAt: time default now
  checkoutPhoto: image <=5000000 ?
  returnedAt: time ?
  returnPhoto: image <=5000000 ?
  status: enum('out', 'returned') default 'out'
  immutable instrument, borrower, season, seasonEndsAt, checkoutAt
  read <- .borrower = viewer or exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  online only

table deposits:
  family: principal
  season: seasons
  amount: money USD
  note: text <=200 ?
  at: time default now
  immutable family, season, amount
  read <- exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager']
  online only

table repairNotes:
  instrument: instruments
  author: principal
  note: text 1..2000
  at: time default now
  immutable instrument, author
  read <- exists roles[viewer, role = 'luthier'] or exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
  insert <- .author = viewer and exists roles[viewer, role = 'luthier']
  online only

query catalog(c: cursor ?):
  return instruments first 100 by .id after c

query seasonsList(c: cursor ?):
  return seasons first 50 by .endsAt after c

query myRole():
  return roles[principal = viewer]

query myLoans(c: cursor ?):
  return loans where .borrower = viewer last 50 by .checkoutAt after c

query myCurrent(c: cursor ?):
  return loans where .borrower = viewer and .status = 'out' and .seasonEndsAt > now last 50 by .checkoutAt after c

query myOverdue(c: cursor ?):
  return loans where .borrower = viewer and .status = 'out' and .seasonEndsAt < now - 14d last 50 by .seasonEndsAt after c

query myDeposits(c: cursor ?):
  return deposits where .family = viewer last 50 by .at after c

query allLoans(c: cursor ?):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return loans last 50 by .checkoutAt after c

query overdueLoans(c: cursor ?):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return loans where .status = 'out' and .seasonEndsAt < now - 14d last 50 by .seasonEndsAt after c

query depositRecords(c: cursor ?):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  return deposits last 50 by .at after c

query notesFor(instrument: instruments, c: cursor ?):
  return repairNotes where .instrument = instrument last 50 by .at after c

mutation assignRole(who: principal, role: enum('student', 'parent', 'librarian', 'manager', 'luthier')):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  return upsert roles[who] { role }

mutation createSeason(name: text 1..80, endsAt: time):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  require endsAt > now else BAD_END 'The season must end in the future.'
  return insert seasons { name, endsAt }

mutation addInstrument(kind: text 1..80, serial: text 1..40, detail: text <=500 ?):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return insert instruments { kind, serial, detail }

mutation checkout(instrument: instruments, borrower: principal, season: seasons, checkoutPhoto: image <=5000000 ?):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  i = instruments[instrument] ! else NOT_FOUND
  s = seasons[season] ! else NOT_FOUND
  require i.status = 'available' else NOT_AVAILABLE 'This instrument is not available.'
  require now <= s.endsAt else SEASON_ENDED 'The season has ended.'
  update instruments[instrument] { status: 'loaned' }
  return insert loans { instrument, borrower, season, seasonEndsAt: s.endsAt, checkoutPhoto }

mutation checkin(loan: loans, returnPhoto: image <=5000000 ?):
  require exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  l = loans[loan] ! else NOT_FOUND
  require l.status = 'out' else ALREADY_RETURNED 'This loan was already returned.'
  update instruments[l.instrument] { status: 'available' }
  update loans[loan] { status: 'returned', returnedAt: now, returnPhoto }
  return null

mutation writeOff(instrument: instruments):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  i = instruments[instrument] ! else NOT_FOUND
  require i.status != 'written_off' else ALREADY_WRITTEN_OFF 'This instrument is already written off.'
  require i.status != 'loaned' else LOANED_OUT 'Check the instrument back in first.'
  update instruments[instrument] { status: 'written_off' }
  return null

mutation recordDeposit(family: principal, season: seasons, amount: money USD, note: text <=200 ?):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  s = seasons[season] ! else NOT_FOUND
  require s.endsAt > 0 else BAD_SEASON
  return insert deposits { family, season, amount, note }

mutation addRepairNote(instrument: instruments, note: text 1..2000):
  require exists roles[viewer, role = 'luthier'] else NOT_LUTHIER
  i = instruments[instrument] ! else NOT_FOUND
  require i.kind != '' else BAD_INSTRUMENT
  return insert repairNotes { instrument, author: viewer, note }
