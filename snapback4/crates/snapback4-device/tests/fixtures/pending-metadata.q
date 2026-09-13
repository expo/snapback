table people:
  name: text <=60
  bio: text <=240
  read <- allow
  update <- allow
  sync public

table votes:
  person: people
  answer: text <=60
  direction: int
  unique byAnswerPerson: answer, person
  cap 10 by answer
  read <- allow
  insert <- allow
  update <- allow
  sync public

maintain voteTotals: sum votes of direction by answer
  read <- allow

query person(person: people):
  return people[person] ! else NOT_FOUND

query voteRows():
  return votes[] first 10 by byId

query voteTotal(answer: text <=60):
  return voteTotals[answer] by byGroup

mutation profile(person: people, name: text <=60, bio: text <=240):
  update people[person] { name, bio }

mutation vote(person: people, answer: text <=60, direction: int):
  upsert votes[answer, person] { direction }

mutation updateVote(person: people, answer: text <=60, direction: int):
  vote = votes[answer, person] ! else NOT_FOUND
  update votes[vote] { direction }

mutation scanVote(direction: int):
  for vote in votes['answer'] first 10 by byAnswerPerson:
    update votes[vote] { direction }
