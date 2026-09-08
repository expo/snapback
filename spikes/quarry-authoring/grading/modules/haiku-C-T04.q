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
  read e <- e.baker = viewer

maintain topScore = max entries of score by contest (readable: public)

query topScore(contestId: contests) -> int:
  topScore[contestId]
