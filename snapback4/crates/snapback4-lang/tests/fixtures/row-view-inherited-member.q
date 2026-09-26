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
  immutable room
  read through .room
  insert <- allow
  update <- allow
table messages:
  room: rooms
  ordinal: int
  immutable room
  public
  insert <- allow
  sync public
view unread: count messages by members m
  where .room = m.room and .ordinal > m.mark
table secrets:
  member: members
  body: text <=20
  read <- exists unread[member = .member]
  insert <- allow
  online only
mutation seed():
  insert rooms { id: 'r', until: 2000 }
  insert members { id: 'm', room: 'r' }
  insert messages { id: 'x', room: 'r', ordinal: 1 }
  insert secrets { id: 's', member: 'm', body: 'secret' }
query countFor():
  return unread['m']
query message():
  return members['m']
query secret():
  return secrets['s']

mutation mark():
  update members['m'] { mark: 0 }
