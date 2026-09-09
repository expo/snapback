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
  passenger = passengers[rideId, viewer]
  if passenger != null:
    passenger
  else:
    ride = rides[rideId]! else NO_RIDE
    require ride.seats > passengerCount[ride] else RIDE_FULL
    +passengers { ride, user: viewer, at: now }
