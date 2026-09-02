const users = table("users");
const rides = table("rides");
const passengers = table("passengers");
// unique index passengers.byRideUser: (rideId, userId)
// index passengers.byRideAt: (rideId, at)

const passengerCounts = maintained("passengerCounts", passengers);

export const joinRide = mutation(
  { rideId: id(rides) },
  ({ db, ctx, args }) => {
    const userId = ctx.viewer;
    
    // Return existing passenger (idempotent)
    const existing = db.get(passengers.byRideUser, [args.rideId, userId]);
    if (existing) {
      return existing;
    }
    
    // Verify ride exists
    const ride = db.get(rides, args.rideId);
    db.require(ride, "RIDE_NOT_FOUND");
    
    // Check capacity via maintained aggregate
    const counts = db.get(passengerCounts, args.rideId);
    const currentCount = counts?.count ?? 0;
    db.require(currentCount < ride.seats, "RIDE_FULL");
    
    // Insert new passenger
    const id = ctx.newId();
    const now = ctx.now();
    db.insert(passengers, { id, rideId: args.rideId, userId, at: now });
    
    return { id, rideId: args.rideId, userId, at: now };
  },
);
