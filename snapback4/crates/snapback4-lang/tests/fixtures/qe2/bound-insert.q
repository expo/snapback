table records:
  payload: text <=3000000
  optional: bool ?
  public
  insert <- allow
  sync public
mutation add(payload: text <=3000000):
  r = insert records { id: 'r', payload }
  return r.optional
