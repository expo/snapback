const users = table("users");        // { id, name }
const studios = table("studios");    // { id, name }
const classes = table("classes");    // { id, studioId, title, startsAt, instructorId }
                                     // index classes.byStudioStart: (studioId, startsAt)
const bookings = table("bookings");  // { id, classId, userId, at }
                                     // index bookings.byClassAt: (classId, at)

export const classDetail = query({ classId: id(classes) }, ({ db, args }) => {
  let cls = db.get(classes, args.classId);
  db.require(cls, "NOT_FOUND");
  let instructor = db.get(users, cls.instructorId);
  let bookingList: any[] = [];
  for (const booking of db.scan(bookings.byClassAt, [args.classId], { order: "asc", take: 20 })) {
    let booker = db.get(users, booking.userId);
    bookingList.push({ booking, booker });
  }
  return {
    title: cls.title,
    startsAt: cls.startsAt,
    instructor,
    bookings: bookingList,
  };
});
