use personas alice, bob
table conversations:
  read <- exists members[.id, viewer]
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
table messages:
  conversation: conversations
  bucket: text <=10
  ordinal: int
  body: text <=100
  search body
  unique byOrder: conversation, bucket, ordinal
  read <- exists members[.conversation, viewer]
  sync to members[.conversation]
query named(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 2 by byOrder after c
query columns(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 2 by .bucket, .ordinal after c
query ascending(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q first 2 by byOrder after c
query suffix(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] where .bucket = 'A' matching q last 2 by byOrder after c
query suffixColumns(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] where .bucket = 'A' matching q last 2 by .ordinal after c
