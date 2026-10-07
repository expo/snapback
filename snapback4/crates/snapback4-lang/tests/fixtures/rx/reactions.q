table conversations:
  owner: principal
  immutable owner
  read <- .owner = viewer
  insert <- allow
  sync to .owner

table members:
  conversation: conversations
  principal: principal
  unique conversation, principal
  public
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  delete <- allow
  sync public

table messages:
  conversation: conversations
  deleted: bool default false
  until: time ?
  immutable conversation, until
  read <- exists members[.conversation, viewer]
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync to members[.conversation]

table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  immutable message, principal
  unique message, principal
  read through .message
  insert <- .principal = viewer and not .message.deleted and exists members[.message.conversation, viewer]
  update <- .principal = viewer and not .message.deleted and exists members[.message.conversation, viewer]
  delete <- .principal = viewer and exists members[.message.conversation, viewer]
  sync

table endorsements:
  reaction: reactions
  public
  insert <- exists members[.reaction.message.conversation, viewer] and .reaction.message.conversation.owner = viewer
  sync public

table obligations:
  message: messages
  public
  insert <- allow
  after insert <- exists members[.message.conversation, viewer]
  sync public

mutation room(id: id):
  insert conversations { id, owner: viewer }
  insert members { conversation: id, principal: viewer }
mutation join(conversation: conversations, principal: principal):
  insert members { conversation, principal }
mutation leave(conversation: conversations, principal: principal):
  delete members[conversation, principal]
mutation send(id: id, conversation: conversations):
  insert messages { id, conversation }
mutation remove(message: messages):
  update messages[message] { deleted: true }
mutation setReaction(message: messages, emoji: text 1..32):
  upsert reactions[message, viewer] { message, principal: viewer, emoji }
mutation endorse(id: id, reaction: reactions):
  insert endorsements { id, reaction }
mutation obligation(id: id, message: messages):
  insert obligations { id, message }
mutation joinAtEnd(id: id, message: messages, conversation: conversations):
  insert obligations { id, message }
  insert members { conversation, principal: viewer }
query reaction(message: messages):
  return reactions[message, viewer]
query endorsement(id: endorsements):
  return endorsements[id]
mutation react(id: id, message: messages):
  insert reactions { id, message, principal: viewer, emoji: 'like' }
