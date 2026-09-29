table conversations:
  title: text 1..50
  kind: enum('group', 'dm')
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
table messages:
  conversation: conversations
  immutable conversation
  read <- exists members[.conversation, viewer]
  sync to members[.conversation] last 500 by .id
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
view reactionCounts: count reactions by .message, .emoji
fn digestCounts(reader: principal):
  total = 0
  for member in members where .principal = reader:
    total = total + 1
  return total
job digest():
  for member in members:
    result = digestCounts(member.principal)
query digestPreview():
  return digestCounts(viewer)
