-- Operator-only staging data: no credential for this service enters the app.
mutation completedRental(renter: principal, attendant: principal, pavilion: enum('Willow', 'Lakeside', 'Oak'), date: time, label: text 3..100):
  require viewer = 'service:provision' else PROVISION_ONLY
  require date = day(date) * 1d and date < day(now) * 1d and date >= (day(now) - 6) * 1d else FIXTURE_DATE
  s = upsert availability[pavilion, date] { pavilion, date, occupied: true }
  b = insert bookings { renter, attendant, slot: s.id, label, pavilion, date, endsAt: date + 1d, placedAt: date - 5d, state: 'confirmed', damage: false }
  insert payments { booking: b.id, renter, amountCents: 10000, receipt: 'Staging deposit ledger', paidAt: date - 4d, status: 'paid', decidedAt: null, decidedBy: null, reason: null }
  return b
