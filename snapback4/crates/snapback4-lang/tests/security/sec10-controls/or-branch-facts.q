table trips:
  status: enum('draft','done') default 'draft'
  read <- allow
  update <- allow
  online only
table bookings:
  trip: trips
  approved: bool default false
  read <- allow
  update <- allow
  online only
table waivers:
  booking: bookings
  read <- allow
  insert <- allow
  online only
mutation approve(booking: bookings):
  update bookings[booking] {approved:true}
mutation waiver(booking: bookings):
  return insert waivers {booking}
mutation finish(trip: trips,flag: bool):
  for b in bookings first 10 by .id:
    require flag or opaque(flag) else CHOICE
    if flag:
      continue
    require b.approved else APPROVAL
  update trips[trip] {status:'done'}
fn opaque(flag: bool):
  if flag:
    return true
  return true
