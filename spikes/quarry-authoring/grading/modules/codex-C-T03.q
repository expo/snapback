table users:
  name: text <=80

table postings:
  employer: users
  title: text <=200
  createdAt: time
  by employer, createdAt

table applications:
  posting: postings
  applicant: users
  at: time
  by posting, at
  read a <- a.applicant = viewer or postings[a.posting].employer = viewer

maintain applicationCount = count applications by posting (readable: public)

query dashboard():
  postings[employer = viewer] last 20 {
    *,
    applicationCount: #applicationCount[.]
  }
