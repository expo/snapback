table users:
  name: text <=80

table studios:
  name: text <=100

table classes:
  studio: studios
  title: text <=200
  startsAt: time
  instructor: users
  by studio, startsAt

table bookings:
  class: classes
  user: users
  at: time
  by class, at

query classDetail(classId: classes):
  classId {
    title,
    startsAt,
    instructor: users[.instructor] { name },
    bookings: bookings[classId] first 20 {
      *,
      user: users[.user] { name }
    }
  }
