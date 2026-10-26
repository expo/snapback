use identity password

-- Roles are assigned by the filesystem operator, never by a signing-up user.
table roles:
  principal: principal
  role: enum('office', 'companyOwner', 'driver', 'vehicleOwner')
  label: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

fn office(): exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
fn staff(): office() or exists roles[viewer, role = 'driver']

mutation provision(principal: principal, role: enum('office', 'companyOwner', 'driver', 'vehicleOwner'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

query sessionInfo():
  require exists roles[viewer] else NO_ROLE
  return { profile: roles[viewer], now: now }

query directory(c: cursor ?):
  require office() else OFFICE_ONLY
  return roles last 100 by .id after c

table shipments:
  vehicleOwner: principal
  car: text 2..100
  pickup: text 2..120
  destination: text 2..120
  routePlan: text 5..2000
  overnightStops: text 2..1000
  driver: principal
  secondDriver: principal ?
  photos: [image <=10000000] 1..6
  titleScan: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  ownerPhone: text 7..25
  insuredValue: int 100..1000000000
  quotedFee: int 100..10000000
  scheduledAt: time
  createdAt: time default now
  status: enum('booked', 'loaded', 'delivered', 'weatherDelayed') default 'booked'
  delayedAt: time ?
  beforeDelay: enum('booked', 'loaded') ?
  weatherReason: text 5..500 ?
  soloReason: text 10..500 ?
  soloApprovedBy: principal ?
  soloApprovedAt: time ?
  read <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner'] or exists roles[viewer, role = 'driver'] or (.vehicleOwner = viewer and exists roles[viewer, role = 'vehicleOwner'])
  read (titleScan, ownerPhone, insuredValue, quotedFee) <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  insert <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  update <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner'] or (.driver = viewer and exists roles[viewer, role = 'driver']) or (.secondDriver = viewer and exists roles[viewer, role = 'driver'])
  immutable vehicleOwner, car, pickup, destination, routePlan, overnightStops, driver, secondDriver, photos, titleScan, ownerPhone, insuredValue, quotedFee, createdAt
  online only

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  if staff():
    return shipments last 100 by .id after c
  return shipments where .vehicleOwner = viewer last 100 by .id after c

query shipment(shipment: shipments):
  require exists roles[viewer] else NO_ROLE
  return shipments[shipment] ! else NOT_FOUND

mutation createShipment(vehicleOwner: principal, car: text 2..100, pickup: text 2..120, destination: text 2..120, routePlan: text 5..2000, overnightStops: text 2..1000, driver: principal, secondDriver: principal ?, photos: [image <=10000000] 1..6, titleScan: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png'), ownerPhone: text 7..25, insuredValue: int 100..1000000000, quotedFee: int 100..10000000, scheduledAt: time):
  require office() else OFFICE_ONLY
  require exists roles[vehicleOwner, role = 'vehicleOwner'] else INVALID_OWNER
  require exists roles[driver, role = 'driver'] else INVALID_DRIVER
  require secondDriver = null or secondDriver != driver else DISTINCT_DRIVERS
  if secondDriver != null:
    require exists roles[secondDriver, role = 'driver'] else INVALID_DRIVER
  require scheduledAt >= now and scheduledAt <= now + 365d else BAD_DATE
  return insert shipments { vehicleOwner, car, pickup, destination, routePlan, overnightStops, driver, secondDriver, photos, titleScan, ownerPhone, insuredValue, quotedFee, scheduledAt }

mutation approveSolo(shipment: shipments, reason: text 10..500):
  require exists roles[viewer, role = 'companyOwner'] else COMPANY_OWNER_ONLY
  s = shipments[shipment] ! else NOT_FOUND
  require s.secondDriver = null else HAS_SECOND_DRIVER
  require s.status = 'booked' else BAD_STATUS
  require s.soloApprovedBy = null else ALREADY_APPROVED
  update shipments[shipment] { soloReason: reason, soloApprovedBy: viewer, soloApprovedAt: now }

fn mayDispatch(shipment: shipments):
  s = shipments[shipment] ! else NOT_FOUND
  require office() or (exists roles[viewer, role = 'driver'] and (s.driver = viewer or s.secondDriver = viewer)) else NOT_ASSIGNED

mutation loadShipment(shipment: shipments):
  mayDispatch(shipment)
  s = shipments[shipment] ! else NOT_FOUND
  require s.status = 'booked' else BAD_STATUS
  require s.secondDriver != null or s.soloApprovedBy != null else SECOND_DRIVER_REQUIRED
  update shipments[shipment] { status: 'loaded' }

mutation deliverShipment(shipment: shipments):
  mayDispatch(shipment)
  s = shipments[shipment] ! else NOT_FOUND
  require s.status = 'loaded' else BAD_STATUS
  update shipments[shipment] { status: 'delivered' }

mutation delayWeather(shipment: shipments, reason: text 5..500):
  mayDispatch(shipment)
  s = shipments[shipment] ! else NOT_FOUND
  require s.status = 'booked' or s.status = 'loaded' else BAD_STATUS
  update shipments[shipment] { status: 'weatherDelayed', delayedAt: now, beforeDelay: s.status, weatherReason: reason }

mutation reschedule(shipment: shipments, scheduledAt: time):
  require office() else OFFICE_ONLY
  s = shipments[shipment] ! else NOT_FOUND
  require s.status = 'weatherDelayed' and s.delayedAt != null else NOT_WEATHER_DELAYED
  require now <= s.delayedAt + 60d else RESCHEDULE_EXPIRED
  require scheduledAt >= now and scheduledAt <= s.delayedAt + 60d else OUTSIDE_WINDOW
  update shipments[shipment] { status: s.beforeDelay ?? 'booked', scheduledAt }

-- Independently state the product's sensitive audiences.
invariant shipments.read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner'] or exists roles[viewer, role = 'driver'] or (.vehicleOwner = viewer and exists roles[viewer, role = 'vehicleOwner'])
invariant shipments.titleScan read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant shipments.ownerPhone read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant shipments.insuredValue read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant shipments.quotedFee read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant shipments.soloApprovedBy update only exists roles[viewer, role = 'companyOwner']
invariant shipments.soloReason update only exists roles[viewer, role = 'companyOwner']
