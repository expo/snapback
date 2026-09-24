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
