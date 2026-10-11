-- Author Q&A Sessions.
-- Authors (hosts) schedule sessions, run them live and highlight the current
-- question. Readers submit questions beforehand and upvote them.
-- Cast: alice is an author/host; bob and carol are readers.
use personas alice, bob, carol

table sessions:
  host: principal
  title: text 1..120
  book: text 1..120
  status: enum('scheduled', 'live', 'ended') default 'scheduled'
  current: id ?
  at: time default now
  immutable host
  public 'sessions are discoverable by everyone'
  insert <- .host = viewer
  update <- .host = viewer
  delete <- .host = viewer
  cap 50 by host
  sync last 100 by .at

table questions:
  session: sessions
  asker: principal
  text: text 1..500
  answered: bool default false
  at: time default now
  immutable session, asker
  public 'questions are visible to everyone'
  insert <- .asker = viewer
  update <- .asker = viewer or .session.host = viewer
  delete <- .asker = viewer or .session.host = viewer
  cap 200 by session
  sync last 500 by .at

table upvotes:
  question: questions
  voter: principal
  immutable question, voter
  unique question, voter
  public 'upvotes are visible to everyone'
  insert <- .voter = viewer
  delete <- .voter = viewer
  cap 500 by question
  sync last 1000 by .id

view voteCount: count upvotes by .question

query listSessions(c: cursor ?):
  return sessions last 20 by .at after c

query sessionQuestions(session: sessions, c: cursor ?):
  return questions where .session = session first 50 by .at after c { *, votes: voteCount[.id] }

query questionById(question: questions):
  return questions[question] { *, votes: voteCount[.id] }

query votesFor(question: questions):
  return voteCount[question]

mutation scheduleSession(title: text 1..120, book: text 1..120):
  return insert sessions { host: viewer, title, book }

mutation startSession(session: sessions):
  s = sessions[session] ! else NOT_FOUND
  require s.host = viewer else NOT_HOST 'Only the host can start this session.'
  require s.status = 'scheduled' else BAD_STATUS 'Only a scheduled session can start.'
  update sessions[session] { status: 'live' }
  return null

mutation endSession(session: sessions):
  s = sessions[session] ! else NOT_FOUND
  require s.host = viewer else NOT_HOST 'Only the host can end this session.'
  require s.status = 'live' else BAD_STATUS 'Only a live session can end.'
  update sessions[session] { status: 'ended' }
  return null

mutation askQuestion(session: sessions, text: text 1..500):
  s = sessions[session] ! else NOT_FOUND
  require s.status != 'ended' else SESSION_ENDED 'This session has ended.'
  return insert questions { session, asker: viewer, text }

mutation retractQuestion(question: questions):
  q = questions[question] ! else NOT_FOUND
  require q.asker = viewer or q.session.host = viewer else NOT_YOURS 'Only the asker or the host can remove this question.'
  delete questions[question]
  return null

mutation upvote(question: questions):
  q = questions[question] ! else NOT_FOUND
  return insert upvotes { question, voter: viewer } if absent

mutation unvote(question: questions):
  delete upvotes[question, viewer]
  return null

mutation highlight(question: questions):
  q = questions[question] ! else NOT_FOUND
  s = sessions[q.session] ! else NOT_FOUND
  require s.host = viewer else NOT_HOST 'Only the host can highlight a question.'
  require s.status = 'live' else NOT_LIVE 'Only a live session can highlight a question.'
  update sessions[s.id] { current: q.id }
  return null

mutation markAnswered(question: questions):
  q = questions[question] ! else NOT_FOUND
  require q.session.host = viewer else NOT_HOST 'Only the host can mark a question answered.'
  update questions[question] { answered: true }
  return null
