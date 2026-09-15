table archive:
  at: time
  by byTime: at, id
  by byTimeOther: at, id
  public 'archive'
  sync public
table copies:
  at: time
  public 'copies'
  insert <- allow
  sync public
mutation copyArchive():
  page = archive first 20 by byTime
  for i in range(0, 20):
    row = at(page, i)
    if row != null:
      insert copies { at: row.at }
query archives():
  return archive first 50 by byTime
query copied():
  return copies first 50 by byId
