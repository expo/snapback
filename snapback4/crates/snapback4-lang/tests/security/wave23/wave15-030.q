use identity
use personas alice, bob, owner, client, visitor

-- One salon; staff provisioning is an administrative fixture, not a public API.
table staff:
  insert <- viewer = 'service:ops'
  principal: principal
  name: text 1..80
  role: enum('stylist', 'owner')
  unique principal
  read <- (
 exists staff[viewer]
  ) or viewer = 'service:ops'
  online only

table clients:
  insert <- viewer = 'service:ops'
  principal: principal
  name: text 1..80
  unique principal
  read <- (
 .principal = viewer or exists staff[viewer]
  ) or viewer = 'service:ops'
  online only

table bookings:
  client: clients
  stylist: principal
  unique client, stylist
  read <- (
 .stylist = viewer or exists staff[viewer, role = 'owner']
  ) or viewer = 'service:ops'
  insert <- (
 exists staff[viewer, role = 'owner']
  ) or viewer = 'service:ops'
  delete <- exists staff[viewer, role = 'owner']
  online only

table formulas:
  client: clients
  author: principal
  formula: text 1..1000
  minutes: int 5..180
  notes: text <=1000
  outcome: enum('fresh', 'tweak', 'rework') default 'fresh'
  beforePhoto: image <=5000000 ?
  afterPhoto: image <=5000000 ?
  at: time default now
  immutable client, author, at
  read <- .author = viewer or exists staff[viewer, role = 'owner'] or exists bookings[.client, viewer] or exists clients[.client, principal = viewer] or exists shareReaders[.client, viewer]
  insert <- .author = viewer and exists staff[viewer] and exists clients[.client]
  update <- .author = viewer or exists staff[viewer, role = 'owner']
  online only

-- One private rating per formula. The client rates their own visit; the
-- author and the owner can read it. Share-link visitors never see feedback:
-- a link hands over formulas, not opinions.
table feedback:
  client: clients
  formula: formulas
  stars: int 1..5
  note: text <=500 ?
  at: time default now
  unique formula
  immutable client, formula, at
  read <- exists clients[.client, principal = viewer] or exists staff[viewer, role = 'owner'] or exists formulas[.formula, author = viewer]
  insert <- exists clients[.client, principal = viewer]
  online only

-- Token possession authorizes enrollment; no API lists these program-readable rows.
table shares:
  client: clients
  secret: text 32..100
  expiresAt: time
  unique secret
  immutable client, secret, expiresAt
  expire at .expiresAt
  read <- allow
  insert <- exists clients[.client, principal = viewer]
  online only

table shareReaders:
  client: clients
  principal: principal
  expiresAt: time
  unique client, principal
  immutable client, principal
  expire at .expiresAt
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

table shareViews:
  client: clients
  visitor: principal
  at: time default now
  immutable client, visitor, at
  read <- exists clients[.client, principal = viewer]
  insert <- .visitor = viewer and exists shareReaders[.client, viewer]
  online only

query whoAmI():
  return viewer
query myRole():
  return staff[principal = viewer]
query clientList(c: cursor ?):
  if exists staff[viewer]:
    return clients first 50 by .id after c
  return clients where .principal = viewer first 50 by .id after c
query history(client: clients, c: cursor ?):
  if exists staff[viewer, role = 'owner'] or exists bookings[client, viewer] or exists clients[client, principal = viewer] or exists shareReaders[client, viewer]:
    return formulas where .client = client last 50 by .at after c
  return formulas where .client = client and .author = viewer last 50 by .at after c
query viewLog(client: clients, c: cursor ?):
  return shareViews where .client = client last 50 by .at after c
query feedbackFor(formula: formulas):
  return feedback where .formula = formula first 10 by .id
query myBookings(c: cursor ?):
  if exists staff[viewer, role = 'owner']:
    return bookings first 50 by .id after c
  return bookings where .stylist = viewer first 50 by .id after c

mutation recordFormula(client: clients, formula: text 1..1000, minutes: int 5..180, notes: text <=1000, beforePhoto: image <=5000000 ?, afterPhoto: image <=5000000 ?):
  require exists staff[viewer] else STAFF_ONLY
  c = clients[client] ! else NOT_FOUND
  return insert formulas { client: c.id, author: viewer, formula, minutes, notes, beforePhoto, afterPhoto }
mutation bookClient(client: clients, stylist: principal):
  require exists staff[viewer, role = 'owner'] else OWNER_ONLY
  require exists staff[stylist] else NOT_STYLIST
  c = clients[client] ! else NOT_FOUND
  return insert bookings { client: c.id, stylist }
mutation cancelBooking(booking: bookings):
  require exists staff[viewer, role = 'owner'] else OWNER_ONLY
  delete bookings[booking]
  return null
mutation createShare(client: clients, secret: text 32..100, hours: int 1..168):
  require exists clients[client, principal = viewer] else CLIENT_ONLY
  return insert shares { client, secret, expiresAt: now + hours * 1h }
mutation setOutcome(formula: formulas, outcome: enum('fresh', 'tweak', 'rework')):
  require exists staff[viewer] else STAFF_ONLY
  f = formulas[formula] ! else NOT_FOUND
  require f.author = viewer or exists staff[viewer, role = 'owner'] else NOT_AUTHOR
  update f { outcome }
  return null
mutation leaveFeedback(formula: formulas, stars: int 1..5, note: text <=500 ?):
  f = formulas[formula] ! else NOT_FOUND
  c = clients[f.client] ! else NOT_FOUND
  require c.principal = viewer else CLIENT_ONLY
  return insert feedback { client: c.id, formula, stars, note }
mutation viewShare(secret: text 32..100): server
  s = shares[secret = secret] ! else BAD_LINK
  upsert shareReaders[s.client, viewer] { client: s.client, principal: viewer, expiresAt: s.expiresAt }
  require exists shareReaders[s.client, viewer] else BAD_LINK
  insert shareViews { client: s.client, visitor: viewer }
  return { client: s.client, expiresAt: s.expiresAt }

mutation bootstrapbookings(seat_client: clients, seat_stylist: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert bookings { client: seat_client, stylist: seat_stylist }

mutation bootstrapclients(seat_name: text <=80, seat_principal: principal):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert clients { name: seat_name, principal: seat_principal }

mutation bootstrapstaff(seat_name: text <=80, seat_principal: principal, seat_role: enum('stylist', 'owner')):
  require viewer = 'service:ops' else NOT_OPERATOR
  return insert staff { name: seat_name, principal: seat_principal, role: seat_role }
