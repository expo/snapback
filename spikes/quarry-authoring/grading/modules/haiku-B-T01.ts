const users = table("users");        // { id, name }
const studios = table("studios");    // { id, name }
const classes = table("classes");    // { id, studioId, title, startsAt, instructorId }
                                     // index classes.byStudioStart: (studioId, startsAt)
const bookings = table("bookings");  // { id, classId, userId, at }
                                     // index bookings.byClassAt: (classId, at)

export const classDetail = query({ classId: scalar() }, ({ db, args }) => {
  const classRow = db.get(classes, args.classId);
  if (!classRow) return null;
  
  const instructor = db.get(users, classRow.instructorId);
  
  const bookingsList: any[] = [];
  for (const booking of db.scan(bookings.byClassAt, [args.classId], { order: "asc", take: 20 })) {
    const booker = db.get(users, booking.userId);
    bookingsList.push({ booking, booker });
  }
  
  return {
    class: {
      title: classRow.title,
      startsAt: classRow.startsAt,
    },
    instructor,
    bookings: bookingsList,
  };
});
