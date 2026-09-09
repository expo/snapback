table users:
  name: text <=80

table contests:
  title: text <=200
  endsAt: time

table entries:
  contest: contests
  baker: users
  score: int
  at: time
  by byContestScore: contest, score
  read e <- e.baker = viewer          -- private to the baker until the contest closes

maintain topScore = max entries of score by contest (readable: public)

query topScore(contestId: contests):
  topScore[contestId]
