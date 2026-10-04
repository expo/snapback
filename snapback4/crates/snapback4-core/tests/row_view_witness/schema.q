
table rooms:
  public
table members:
  room: rooms
  until: time ?
  MEMBER_EXPIRY
  cap 100 by room
  public
table messages:
  room: rooms
  until: time ?
  expire at .until
  public
view unread: count messages by members m where .room = m.room
table permits:
  member: members
  slot: int default 0
  until: time ?
  expire at .until
  unique byMember: member, slot
  public
table gates:
  member: members
  immutable member
  read <- PREDICATE
table links:
  gate: gates
  immutable gate
  read through .gate
table leaves:
  link: links
  immutable link
  read through .link
query direct():
  return gates['g']
query linked():
  return links['l']
query leaf():
  return leaves['z']
query rows():
  return unread first 10
