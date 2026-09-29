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
query groupByTitle(title: text 1..50):
  return conversations where .title = title and .kind = 'group' first 1 by .id
query groupNamed(title: text 1..50, c: cursor ?):
  return conversations where .kind = 'group' and .title = title first 5 by .id after c
