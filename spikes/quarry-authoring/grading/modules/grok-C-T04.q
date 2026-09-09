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

maintain top = max entries of score by contest (readable: public)

query topScore(contestId: contests):
  top[contestId]
