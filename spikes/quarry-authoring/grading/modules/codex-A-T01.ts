const users = table("users");        // { id, name }
const studios = table("studios");    // { id, name }
const classes = table("classes");    // { id, studioId, title, startsAt, instructorId }
                                     // index classes.byStudioStart: (studioId, startsAt)
const bookings = table("bookings");  // { id, classId, userId, at }
                                     // index bookings.byClassAt: (classId, at)

export const classDetail = query(
  { classId: id(classes) },
  ({ db, args }) => {
    const classRow = db.get(classes, args.classId);
    if (classRow === null) return null;

    const instructor = db.get(users, classRow.instructorId);
    const earliestBookings = db.scan(
      bookings.byClassAt,
      [args.classId],
      { order: "asc", take: 20 },
    );

    return {
      title: classRow.title,
      startsAt: classRow.startsAt,
      instructorName: instructor === null ? null : instructor.name,
      bookings: earliestBookings.map((booking) => {
        const booker = db.get(users, booking.userId);
        return {
          id: booking.id,
          at: booking.at,
          bookerName: booker === null ? null : booker.name,
        };
      }),
    };
  },
);
