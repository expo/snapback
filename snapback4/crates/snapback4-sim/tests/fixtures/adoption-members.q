table members:
  principal: principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal

table messages:
  roomId: id
  body: text <=100
  by byRoom: roomId, id
  read <- allow

query all(room: id):
  return messages[room] first 10 by byRoom
mutation leave():
  delete members['member']
