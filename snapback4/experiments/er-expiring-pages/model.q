table messages:
  conversation: principal
  ordinal: int
  expiresAt: time ?
  body: text <=2000
  unique byOrdinal: conversation, ordinal
  read <- .conversation = viewer
  insert <- .conversation = viewer
  update <- allow
  delete <- .conversation = viewer
  expire at .expiresAt
  sync to .conversation

query page(conversation: principal, low: int, high: int):
  return messages where .conversation = conversation and .ordinal >= low and .ordinal <= high first 1 by .ordinal

query has(conversation: principal, low: int, high: int):
  return exists messages where .conversation = conversation and .ordinal >= low and .ordinal <= high

query total(conversation: principal, low: int, high: int):
  return count(messages where .conversation = conversation and .ordinal >= low and .ordinal <= high)

query point(conversation: principal, ordinal: int):
  return exists messages[conversation, ordinal]

mutation probes(conversation: principal, low: int): server
  prefix = low - 1
  for i in range(0, 1024):
    if exists messages[conversation, prefix + 1]:
      break
    prefix = prefix + 1
  return prefix

mutation add(id: id, ordinal: int, expiresAt: time):
  insert messages { id, conversation: viewer, ordinal, expiresAt, body: '' }
  return null
