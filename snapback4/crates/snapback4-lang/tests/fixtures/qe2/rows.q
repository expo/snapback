table conversations:
  owner: principal
  setting: enum('off', '24h', '7d') default 'off'
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner

table messages:
  conversation: conversations
  photo: image <=1000 ?
  edited: bool default false
  at: time default now
  immutable conversation
  read through .conversation
  insert <- allow
  update <- allow
  delete <- allow
  sync

table reactions:
  message: messages
  principal: principal
  emoji: text <=10 default 'like'
  immutable message, principal
  read through .message
  insert <- .principal = viewer and .message.conversation != null
  update (old, next) <- old.principal = viewer and old.message.conversation = next.message.conversation
  delete <- .principal = viewer and .message.conversation != null
  sync

fn label(setting: text <=3): setting
mutation room(id: id):
  return insert conversations { id, owner: viewer }
mutation send(id: id, conversation: conversations):
  require exists conversations[conversation] else NOT_FOUND
  setting = label(conversations[conversation].setting)
  m = insert messages { id, conversation }
  return { id: m.id, photo: m.photo, edited: m.edited, at: m.at, setting }
mutation patch(message: messages):
  m = update messages[message] { edited: true }
  return { photo: m.photo, edited: m.edited, at: m.at }
mutation react(id: id, message: messages):
  return insert reactions { id, message, principal: viewer }
mutation editReaction(id: reactions):
  return update reactions[id] { emoji: 'new' }
mutation dropReaction(id: reactions):
  delete reactions[id]
query message(id: messages):
  return messages[id]
