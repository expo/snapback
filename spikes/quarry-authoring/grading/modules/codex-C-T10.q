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
  by ride, at
  unique ride, user

maintain passengerCount = count passengers by ride

mutation joinRide(rideId: rides) -> passengers:
  match passengers[rideId, viewer]:
    some passenger:
      passenger
    none:
      ride = rides[rideId]! else NO_RIDE
      require ride.seats > #passengerCount[ride] else RIDE_FULL
      +passengers { ride, user: viewer, at: now }
