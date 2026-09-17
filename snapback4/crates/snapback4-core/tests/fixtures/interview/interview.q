query people(c: cursor ?):
  return people[] after c first 100 by byId

query feed(c: cursor ?):
  return questions[] after c last 100 by byCreated

query answers(question: questions, c: cursor ?):
  return answers[question] after c first 30 by byQuestion

query votes(c: cursor ?):
  return votes[viewer] after c first 1000 by byPrincipal

query comments(question: questions, c: cursor ?):
  return comments[question] after c first 100 by byQuestion

query session(digest: text <=64):
  return sessions[digest]

mutation join(name: text <=60, initials: text <=4, digest: text <=64):
  person = insert people { name, initials, bio: "A curious mind.", sample: false }
  insert sessions { digest, person: person.id, created: now }
  return person

mutation logout(digest: text <=64):
  delete sessions[digest]

mutation profile(person: people, name: text <=60, bio: text <=240, initials: text <=4):
  update people[person] { name, bio, initials }

mutation ask(title: text <=300, details: text <=2000, author: people, claude: text <=120, openai: text <=120, gemini: text <=120):
  question = insert questions { title, details, author, topic: "Open question", created: now, sample: false }
  insert aiJobs { question: question.id, provider: "Claude", model: claude, status: 'pending', message: "" }
  insert aiJobs { question: question.id, provider: "ChatGPT", model: openai, status: 'pending', message: "" }
  insert aiJobs { question: question.id, provider: "Gemini", model: gemini, status: 'pending', message: "" }
  return question

mutation answer(question: questions, author: people, summary: text <=1200, body: text <=6000, provider: text <=30):
  return insert answers { question, author, summary, body, provider, created: now, sample: false }

mutation vote(answer: answers, person: people, principal: principal, direction: int):
  require principal = viewer else INVALID_VOTER
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  previous = votes[answer, person]
  oldDirection = previous.direction if previous != null else 0
  total = voteTotals[answer]
  oldScore = total.score if total != null else 0
  upsert votes[answer, person] { principal, direction }
  upsert voteTotals[answer] { score: oldScore - oldDirection + direction }
  if direction = 1:
    upsert publicUpvotes[answer, person] { answer, person }
  else:
    if publicUpvotes[answer, person] != null:
      delete publicUpvotes[answer, person]
  return null

mutation comment(question: questions, answer: answers, author: people, body: text <=1500):
  return insert comments { question, answer, author, body, created: now }

mutation seedPerson(id: people, name: text <=60, bio: text <=240, initials: text <=4):
  upsert people[id] { name, bio, initials, sample: true }

mutation seedQuestion(id: questions, title: text <=300, details: text <=2000, author: people, topic: text <=40, created: time):
  upsert questions[id] { title, details, author, topic, created, sample: true }

mutation seedAnswer(id: answers, question: questions, author: people, summary: text <=1200, body: text <=6000, provider: text <=30, created: time):
  upsert answers[id] { question, author, summary, body, provider, created, sample: true }

query aiJobs(c: cursor ?):
  return aiJobs[] after c first 200 by byId

mutation queueAI(question: questions, provider: text <=30, model: text <=120):
  upsert aiJobs[question, provider] { model, status: 'pending', message: "" }

mutation failAI(question: questions, provider: text <=30, message: text <=500):
  update aiJobs[question, provider] { status: 'error', message }

mutation finishAI(question: questions, provider: text <=30, author: people, summary: text <=1200, body: text <=6000):
  job = aiJobs[question, provider] ! else JOB_NOT_FOUND
  require job.status = 'pending' else ALREADY_FINISHED
  insert answers { question, author, summary, body, provider, created: now, sample: false }
  update aiJobs[question, provider] { status: 'done', message: "" }

query phoneAccount(phoneDigest: text <=64):
  return phoneAccounts[phoneDigest]

mutation phoneSession(phoneDigest: text <=64, name: text <=60, initials: text <=4, digest: text <=64):
  existing = phoneAccounts[phoneDigest]
  if existing != null:
    insert sessions { digest, person: existing.person, created: now }
    return people[existing.person] ! else MEMBER_NOT_FOUND
  person = insert people { name, initials, bio: "A curious mind.", sample: false }
  insert phoneAccounts { phoneDigest, person: person.id }
  insert sessions { digest, person: person.id, created: now }
  return person

query allAnswers(c: cursor ?):
  return answers[] after c first 100 by byId

query allComments(c: cursor ?):
  return comments[] after c first 100 by byId

query voteTotals(c: cursor ?):
  return voteTotals[] after c first 1000 by byId

query publicUpvotes(c: cursor ?):
  return publicUpvotes[] after c first 1000 by byId

query myVotes(c: cursor ?):
  return votes[viewer] after c first 1000 by byPrincipal

query person(id: people):
  return people[id]
