const users = table("users");        // { id, name }
const studios = table("studios");    // { id, name }
const classes = table("classes");    // { id, studioId, title, startsAt, instructorId }
                                     // index classes.byStudioStart: (studioId, startsAt)
const bookings = table("bookings");  // { id, classId, userId, at }
                                     // index bookings.byClassAt: (classId, at)

export const classDetail = query({ classId: id(classes) }, ({ db, args }) => {
  const cls = db.get(classes, args.classId);
  if (cls === null) {
    return null;
  }
  const instructor = db.get(users, cls.instructorId);
  let instructorName = null;
  if (instructor !== null) {
    instructorName = instructor.name;
  }
  let earliest: any[] = [];
  for (const booking of db.scan(bookings.byClassAt, [args.classId], { order: "asc", take: 20 })) {
    const booker = db.get(users, booking.userId);
    let bookerName = null;
    if (booker !== null) {
      bookerName = booker.name;
    }
    earliest.push({ booking, bookerName });
  }
  return {
    title: cls.title,
    startsAt: cls.startsAt,
    instructorName,
    bookings: earliest,
  };
});
