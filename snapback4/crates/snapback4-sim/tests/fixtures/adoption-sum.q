table sources:
  amount: int
  until: time ?
  by byExpiry: until
  expire at .until
  read <- allow
  delete <- allow
  sync public
mutation remove():
  delete sources['third']
