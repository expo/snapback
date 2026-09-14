table members:
  room: id
  principal: principal
  by byRoom: room, id
  public 'roster'
query roster(room: id, p: principal):
  return members[room = room, principal = p] first 20
