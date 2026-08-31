const users = table("users");           // { id, name }
const rides = table("rides");           // { id, driverId, seats, departsAt }
const passengers = table("passengers"); // { id, rideId, userId, at }
                                        // unique index passengers.byRideUser: (rideId, userId)
                                        // index passengers.byRideAt: (rideId, at)

const passengerCounts = maintained("passengerCounts", passengers); // keyed by rideId: { count }

export const joinRide = mutation(
  { rideId: id(rides) },
  ({ db, ctx, args }) => {
    const existing = db.get(passengers.byRideUser, [args.rideId, ctx.viewer]);
    if (existing !== null) {
      return existing;
    }

    const ride = db.get(rides, args.rideId);
    db.require(ride !== null, "RIDE_NOT_FOUND");

    const occupancy = db.get(passengerCounts, args.rideId);
    const taken = occupancy === null ? 0 : occupancy.count;
    db.require(taken < ride.seats, "RIDE_FULL");

    const passenger = {
      id: ctx.newId(),
      rideId: args.rideId,
      userId: ctx.viewer,
      at: ctx.now(),
    };
    db.insert(passengers, passenger);
    return passenger;
  },
);
