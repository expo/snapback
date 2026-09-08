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

maintain seatCount = count passengers by ride

mutation joinRide(rideId: rides) -> passengers:
  ride = rides[rideId]! else NO_RIDE
  p = passengers[rideId, viewer]
  if p != null:
    p
  else:
    require ride.seats > seatCount[rideId] else RIDE_FULL
    +passengers { ride: rideId, user: viewer, at: now }
