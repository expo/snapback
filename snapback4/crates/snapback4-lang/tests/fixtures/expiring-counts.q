table receipts:
  chat: id
  principal: principal
  state: int
  visible: bool
  weight: int
  at: time
  expiresAt: time ?
  expire at .expiresAt
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal
view unreadWeight: sum receipts of .weight where .state < 2 and .visible by .chat, .principal
  online only
view dailyUnread: count receipts where .state < 2 and .visible by .chat, .principal, day(.at)
  online only
view dailyWeight: sum receipts of .weight where .state < 2 and .visible by .chat, .principal, day(.at)
  online only
mutation add(id: id, expiresAt: time ?, weight: int):
  insert receipts { id, chat: 'chat', principal: viewer, state: 0, visible: true, weight, at: 0, expiresAt }
mutation change(id: receipts, expiresAt: time ?, state: int, visible: bool, weight: int, at: time):
  update receipts[id] { expiresAt, state, visible, weight, at }
mutation remove(id: receipts):
  delete receipts[id]
query unread():
  return unreadCounts['chat', viewer]
query weight():
  return unreadWeight['chat', viewer]
query dayCount(day: int):
  return dailyUnread['chat', viewer, day]
query dayWeight(day: int):
  return dailyWeight['chat', viewer, day]
query groups(c: cursor ?):
  return unreadCounts where .principal = viewer first 20 after c
