use personas alice, bob

effect notify

table notes:
  body: text <=200
  at: time
  by byTime: at, id
  public 'notes are public'
  insert <- allow

mutation push(p: principal):
  if not exists connected[p]:
    emit notify { to: p }
  return null

query latest():
  return notes first 5 by byTime
