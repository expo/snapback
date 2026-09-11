-- Witness-only caller-invoked expiry mirrors the template schedule's direct
-- deletion. The engine derives the removed delivery/tombstone for every
-- original recipient; applications cannot write the generated log.
mutation expire(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  delete messages[msg]
  return null
