effect notify
table notes:
  n: int
  public 'test'
  sync public
  insert <- allow

mutation complementary(p: principal):
  insert notes { n: 7 }
  online = exists connected[p]
  if not online:
    emit notify {}
  if online:
    emit notify {}
  return 7

mutation sharedPayload(p: principal):
  insert notes { n: 7 }
  online = exists connected[p]
  if not online:
    emit notify { online: online and true }
  return 7
