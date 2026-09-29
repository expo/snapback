table messages:
  body: text
  public
shape messageObject on messages = { body }
query message(id: messages):
  return messages[id] messageObject
