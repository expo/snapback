use personas alice, bob

table counters:
  n: int
  public 'counters are public'
  insert <- allow
  update <- allow
  sync public

mutation bump(counterId: counters):
  c = counters[counterId] ! else NOT_FOUND
  update counters[counterId] { n: c.n + 1 }
