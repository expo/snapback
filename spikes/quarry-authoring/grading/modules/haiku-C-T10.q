table users:
  name: text <=80

table rides:
  driver: users
  seats: int
  departsAt: time

table passengers:
  ride: rides
  user: users
  at: time
  by byRideAt: ride, at
  unique byRideUser: ride, user

maintain passengerCount = count passengers by ride

mutation joinRide(rideId: rides) -> passengers:
  ride = rides[rideId]! else RIDE_NOT_FOUND
  existing = passengers[ride, viewer]
  p = existing
  if p != null:
    p
  else:
    require passengerCount[ride] < ride.seats else RIDE_FULL
    +passengers { ride: ride, user: viewer, at: now }
