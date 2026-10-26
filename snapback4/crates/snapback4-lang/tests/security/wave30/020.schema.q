use identity password

table roles:
  principal: principal
  role: enum('rider', 'guide', 'office', 'owner')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table routes:
  title: text 1..100
  privateLand: bool
  permission: text 3..1000 ?
  approvedBy: principal ?
  approvedAt: time ?
  immutable title, privateLand
  read <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- (exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']) and .permission = null and .approvedBy = null
  update <- exists roles[viewer, role = 'owner']
  online only

table rides:
  rider: principal
  riderName: text 1..80
  route: routes
  routeTitle: text 1..100
  startsAt: time
  status: enum('booked', 'fitted', 'on_trail', 'back', 'cancelled') default 'booked'
  loggedBy: principal
  createdAt: time default now
  immutable rider, riderName, route, routeTitle, startsAt, loggedBy, createdAt
  read <- .rider = viewer or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'office']
  update <- .rider = viewer or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  online only

table receipts:
  ride: rides
  rider: principal
  priceCents: int 1..100000
  refundCents: int 0..100000 default 0
  permitFrom: time
  permitUntil: time
  permitPhoto: image <=5000000
  cancelledAt: time ?
  unique ride
  immutable ride, rider, priceCents, permitFrom, permitUntil, permitPhoto
  read <- .rider = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'office']
  update <- .rider = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  online only

invariant rides.read only .rider = viewer or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
invariant rides always exists receipts[ride = .id]
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
invariant routes.permission write only exists roles[viewer, role = 'owner']
invariant routes.approvedBy write only exists roles[viewer, role = 'owner']
invariant receipts.read only .rider = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
invariant receipts always .permitPhoto != null
invariant routes.update only exists roles[viewer, role = 'owner']

mutation provision(principal: principal, role: enum('rider', 'guide', 'office', 'owner'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[principal = viewer]

query riders(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NOT_OFFICE
  return roles where .role = 'rider' last 100 by .id after c

query routeList(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NOT_OFFICE
  return routes last 100 by .id after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return rides last 100 by .id after c

query myRides(c: cursor ?):
  return rides where .rider = viewer last 100 by .id after c

query rideDetail(ride: rides):
  return rides[ride]

query receipt(ride: rides):
  return receipts[ride = ride]

query serverTime():
  return now

mutation addRoute(title: text 1..100, privateLand: bool):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NOT_OFFICE
  return insert routes { title, privateLand }

mutation approveRoute(route: routes, permission: text 3..1000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  r = routes[route] ! else NOT_FOUND
  require r.privateLand else PUBLIC_ROUTE
  require r.approvedBy = null else ALREADY_APPROVED
  update routes[route] { permission, approvedBy: viewer, approvedAt: now }
  return null

mutation bookRide(rider: principal, route: routes, startsAt: time, priceCents: int 1..100000, permitFrom: time, permitUntil: time, permitPhoto: image <=5000000):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  person = roles[principal = rider] ! else UNKNOWN_RIDER
  require person.role = 'rider' else NOT_RIDER
  path = routes[route] ! else NOT_FOUND
  require not path.privateLand or path.approvedBy != null else LAND_PERMISSION_REQUIRED
  require startsAt > now else RIDE_IN_PAST
  require permitFrom <= startsAt and permitUntil >= startsAt and permitFrom <= permitUntil else PERMIT_INVALID 'The signed permit must be valid on the ride date.'
  ride = insert rides { rider, riderName: person.name, route, routeTitle: path.title, startsAt, loggedBy: viewer }
  insert receipts { ride: ride.id, rider, priceCents, permitFrom, permitUntil, permitPhoto }
  return ride

mutation advanceRide(ride: rides):
  require exists roles[viewer, role = 'guide'] else NOT_GUIDE
  r = rides[ride] ! else NOT_FOUND
  require r.status = 'booked' or r.status = 'fitted' or r.status = 'on_trail' else BAD_STATUS
  if r.status = 'booked':
    update rides[ride] { status: 'fitted' }
  elif r.status = 'fitted':
    update rides[ride] { status: 'on_trail' }
  else:
    update rides[ride] { status: 'back' }
  return null

mutation cancelRide(ride: rides):
  r = rides[ride] ! else NOT_FOUND
  require r.rider = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NOT_YOUR_RIDE
  require r.status = 'booked' else BAD_STATUS
  require now < r.startsAt else TOO_LATE
  bill = receipts[ride = ride] ! else NOT_FOUND
  refund = bill.priceCents if r.startsAt - now > 10d else 0
  update receipts[bill.id] { refundCents: refund, cancelledAt: now }
  update rides[ride] { status: 'cancelled' }
  return { refundCents: refund }
