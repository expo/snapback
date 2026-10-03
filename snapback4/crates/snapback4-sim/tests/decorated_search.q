table members:
  room: rooms
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table rooms:
  title: text
  read <- exists members[.id, viewer]
  retain delivered-history
  sync to members[.id]
table profiles:
  principal: principal
  name: text
  unique principal
  public
table messages:
  room: rooms
  author: principal
  body: text
  at: time
  search body
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 100 by .at
query decorated(q: text, c: cursor ?):
  return messages matching q last 20 by .at after c { *, title: rooms[.room].title, sender: profiles[principal = .author].name }
query bare(q: text, c: cursor ?):
  return messages matching q last 20 by .at after c
query pinned(room: rooms, q: text, c: cursor ?):
  return messages[room = room] matching q last 20 by .at after c { *, title: rooms[.room].title, sender: profiles[principal = .author].name }
query pinnedBare(room: rooms, q: text, c: cursor ?):
  return messages[room = room] matching q last 20 by .at after c
query projection(q: text, c: cursor ?):
  return messages matching q last 20 by .at after c { text: .body, title: rooms[.room].title }
query profile(author: principal):
  return profiles[principal = author].name
query roomTitle(room: rooms):
  return rooms[room].title
