table chats:
  name: text <=40
  public

table messages:
  chat: chats
  ordinal: int
  text: text <=80
  owner: principal
  quote: messages ?
  immutable chat, ordinal
  unique chat, ordinal
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  cap 100 by chat
  online only

mutation delivered(group: chats, low: int, high: int)
  reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
mutation ordinary():
  return null
mutation edit():
  update messages['m1'] {text: 'changed'}
  return null
query raw():
  return messages['m1']
query page():
  return messages where .chat = 'c1' first 20 by .ordinal
query fields():
  return messages['m1'] {text}
query alias():
  return messages['m1'] {alias: .text} {alias}
query removed():
  return messages['m1'] {text: .text, ordinal: 0} {ordinal}
query empty():
  return messages['m1'] {}
query replaced():
  return messages['m1'] {text: 'x'}
query copiedPosition():
  return messages['m1'] {ordinal: .ordinal}
query replacedAndPosition():
  return messages['m1'] {text: 'x', ordinal: .ordinal}
query scalar():
  return messages['m1'].text
query countOnly():
  return count(messages where .chat = 'c1')
query filtered():
  return messages where .chat = 'c1' and .ordinal > 1 first 20 by .ordinal {text}
query nested():
  return {first: messages['m1'] {text}, again: messages['m1'], deep: {items: [messages['m2']]}}
query quoteOnly():
  m = messages['m1'] ! else MISSING
  quote = messages[m.quote] ! else MISSING
  return m {preview: quote.text}
query quoteImage():
  m = messages['m1'] ! else MISSING
  return m {quoteRow: messages[m.quote] {text}}
query spread():
  m = messages['m1'] {alias: .text} ! else MISSING
  return {...m, replaced: 1}
query overwrittenSpread():
  m = messages['m1'] {alias: .text} ! else MISSING
  return {...m, alias: 'x'}
query variable():
  m = messages['m1'] ! else MISSING
  text = m.text
  return m {text: text}
query replacedVariable():
  m = messages['m1'] ! else MISSING
  text = m.text
  text = 'replaced'
  return m {text: text}
query unrelated():
  return chats['c1']
