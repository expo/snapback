effect notify
table profiles:
  principal: principal
  read <- true
  insert <- .principal = viewer
table members:
  principal: principal
  chat: text <=20
  unread: int
  read <- .principal = viewer
  insert <- .principal = viewer
fn unreadFor(p: profiles):
  total = 0
  for m in members where .principal = p.principal:
    total = total + m.unread
  return total
job digest():
  for p in profiles:
    n = unreadFor(p)
    if n > 0:
      emit notify { target: p.principal, unread: n }
