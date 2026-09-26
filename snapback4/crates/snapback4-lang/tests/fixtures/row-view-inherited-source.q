table rooms:
  until: time
  expire at .until
  immutable until
  public
  insert <- allow
  sync public
table members:
  room: rooms
  mark: int default 0
  cap 100 by room
  public
  insert <- allow
  update <- allow
  sync public
table messages:
  room: rooms
  ordinal: int
  immutable room
  read through .room
  insert <- allow
  delete <- allow
view unread: count messages by members m
  where .room = m.room and .ordinal > m.mark
mutation seed():
  insert rooms { id: 'r', until: 2000 }
  insert members { id: 'm', room: 'r' }
  insert messages { id: 'x', room: 'r', ordinal: 1 }
query countFor():
  return unread['m']
query message():
  return messages['x']

mutation mark():
  update members['m'] { mark: 0 }

mutation erase():
  delete messages['x']
