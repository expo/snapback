table records:
  owner: principal
  note: text <=5000000 default '' written by .owner
  public
  insert <- allow
  sync public
mutation add():
  r = insert records { id: 'r', owner: viewer }
  return r.id
