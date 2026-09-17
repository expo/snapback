-- The authenticated Interview adapter serves public conversation records to members.
-- Sessions and phone mappings never sync; each member holds only their own votes.
table people:
  name: text 1..60
  bio: text <=240
  initials: text 1..4
  sample: bool
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table questions:
  title: text 1..300
  details: text <=2000
  author: people
  topic: text <=40
  created: time
  sample: bool
  by byCreated: created, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table answers:
  question: questions
  author: people
  provider: text <=30
  summary: text <=1200
  body: text <=6000
  created: time
  sample: bool
  by byQuestion: question, created, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table votes:
  principal: principal
  answer: answers
  person: people
  direction: int
  unique byAnswerPerson: answer, person
  by byAnswer: answer, id
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal

table comments:
  question: questions
  answer: answers
  author: people
  body: text 1..1500
  created: time
  by byQuestion: question, created, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table sessions:
  digest: text 1..64
  person: people
  created: time
  unique byDigest: digest
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow

table aiJobs:
  question: questions
  provider: text 1..30
  model: text 1..120
  status: enum('pending', 'done', 'error')
  message: text <=500
  unique byQuestionProvider: question, provider
  by byQuestion: question, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- deny

-- Private phone-to-member mapping. Never projected into public profiles.
  sync public

table phoneAccounts:
  phoneDigest: text 1..64
  person: people
  unique byPhone: phoneDigest
  read <- allow
  insert <- allow
  update <- deny
  delete <- deny

table voteTotals:
  answer: answers
  score: int
  unique byAnswer: answer
  read <- allow
  insert <- allow
  update <- allow
  delete <- deny
  sync public

table publicUpvotes:
  answer: answers
  person: people
  unique byAnswerPerson: answer, person
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public
