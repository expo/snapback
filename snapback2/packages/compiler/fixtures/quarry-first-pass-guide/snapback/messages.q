fn editWindowMs from config

mutation send(body: text <=500, digest: text <=64):
  return insert messages { body, caption: slice(body, 0, 80), digest, author: viewer, at: now }

query display(messageId: messages):
  row = messages[messageId] ! else NOT_FOUND
  return { body: row.body, caption: row.caption }

query byDigest(digest: text <=64):
  return messages[digest] by byDigest

query searchBatch(terms: [text <=128] <=20):
  return terms

query canEdit(messageId: messages):
  row = messages[messageId] ! else NOT_FOUND
  return now - row.at <= editWindowMs()

mutation clearDigest(digest: text <=64):
  row = messages[digest] by byDigest
  if row != null:
    delete messages[row]
  return null
