table notes:
  owner: principal
  title: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add(title: text):
  return insert notes { owner: viewer, title }
query spread(key: notes):
  p = notes[key] ! else NOT_FOUND
  return { ...p, extra: true }
query shaped(key: notes):
  p = notes[key] ! else NOT_FOUND
  return p { *, extra: true }
query reshaped(key: notes):
  p = notes[key] ! else NOT_FOUND
  s = p { * }
  return { ...s, ...{ extra: true } }
query nested(key: notes):
  p = notes[key] ! else NOT_FOUND
  return { row: { ...p, extra: true } }
query merged(first: notes, second: notes):
  p = notes[first] ! else NOT_FOUND
  q = notes[second] ! else NOT_FOUND
  return { ...p, ...q, extra: true }
table tags:
  owner: principal
  label: text
  read <- .owner = viewer
  sync to .owner
query tagged(key: notes, tag: tags):
  p = notes[key] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  return { ...p, ...q }
query taggedAgain(key: notes, tag: tags):
  p = notes[key] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  s = { ...p, ...q }
  return { ...s }
query taggedReplaced(key: notes, tag: tags):
  p = notes[key] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  return { ...p, ...q, title: 'override' }
query spreadThenShape(key: notes):
  p = notes[key] ! else NOT_FOUND
  s = { ...p }
  return s { title: 'override', * }
query spreadThenShapes(key: notes):
  p = notes[key] ! else NOT_FOUND
  s = { ...p } { * }
  return s { title: 'override', * }
query shapeThenShape(key: notes):
  p = notes[key] ! else NOT_FOUND
  s = p { * }
  return s { title: 'override', * }
