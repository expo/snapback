table listings:
  owner: principal
  title: text
  city: text
  read <- .owner = viewer
  sync to .owner last 500 by .id
table bookings:
  guest: principal
  listing: listings
  start: time
  read <- .guest = viewer
  sync to .guest last 500 by .start

query page(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c { *, listing: listings[.listing] { title, city } }

shape booking = { *, listing: listings[.listing] { title, city } }
shape stored = { * }
query named(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c booking
query spreadShape(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c { ...stored, listing: listings[.listing] { title, city } }

query replaced(c: cursor ?):
  return bookings where .guest = viewer first 2 by .start after c { *, start: 'display', id: { value: .id }, guest: 'display', listing: listings[.listing] { title, city } }

query explicit(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c { id, guest, start, listing: listings[.listing] { title, city } }
query explicitReplaced(c: cursor ?):
  return bookings where .guest = viewer first 2 by .start after c { start: 'display', id: { value: .id }, guest: 'display', listing: listings[.listing] { title, city } }
