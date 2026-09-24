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
  insert <- .owner = viewer
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
mutation addTag(label: text):
  return insert tags { owner: viewer, label }
query taggedReverse(key: notes, tag: tags):
  p = notes[key] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  return { ...q, ...p }
query flattened(first: notes, tag: tags, third: notes):
  p = notes[first] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  r = notes[third] ! else NOT_FOUND
  return { ...p, ...q, ...r }
query composed(first: notes, tag: tags, third: notes):
  p = notes[first] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  r = notes[third] ! else NOT_FOUND
  s = { ...p, ...q }
  return { ...s, ...r }
query composedRight(first: notes, tag: tags, third: notes):
  p = notes[first] ! else NOT_FOUND
  q = tags[tag] ! else NOT_FOUND
  r = notes[third] ! else NOT_FOUND
  s = { ...q, ...r }
  return { ...p, ...s }
query shapedArms(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  return ({ ...p } { title: 'override', * }) if flag else (p { * } { title: 'override', * })
query shapedConditional(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  return ({ ...p } if flag else p { * }) { title: 'override', * }
query shapedReassignment(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  s = p { * } { title: 'override', * }
  if flag:
    s = { ...p } { title: 'override', * }
  return s
query joinedField(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  s = { ...p } if flag else p { * }
  return s.title
query reassignedField(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  s = p { * }
  if flag:
    s = { ...p }
  return s.title
query spreadJoined(key: notes, flag: bool):
  p = notes[key] ! else NOT_FOUND
  s = { ...p } if flag else p { * }
  return { ...s } { title: 'override', * }
query sameTableFlat(first: notes, middle: notes, last: notes):
  p = notes[first] ! else NOT_FOUND
  q = notes[middle] ! else NOT_FOUND
  r = notes[last] ! else NOT_FOUND
  return { ...p, ...q, ...r }
query sameTableLeft(first: notes, middle: notes, last: notes):
  p = notes[first] ! else NOT_FOUND
  q = notes[middle] ! else NOT_FOUND
  r = notes[last] ! else NOT_FOUND
  s = { ...p, ...q }
  return { ...s, ...r }
query sameTableRight(first: notes, middle: notes, last: notes):
  p = notes[first] ! else NOT_FOUND
  q = notes[middle] ! else NOT_FOUND
  r = notes[last] ! else NOT_FOUND
  s = { ...q, ...r }
  return { ...p, ...s }
