table records:
  payload: text <=10000000
  optional: bool ?
  public
  insert <- allow
  sync public
mutation seed(payload: text <=10000000):
  insert records { id: 'r', payload }
  return true
