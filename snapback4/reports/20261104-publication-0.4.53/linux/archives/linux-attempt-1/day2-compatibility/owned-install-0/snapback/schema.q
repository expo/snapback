use identity password

table roles:
  principal: principal
  role: enum('member', 'admin')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member', 'admin')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}

table notes:
  title: text <=200
  done: bool
  ownerId: principal
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer and exists roles[viewer]
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  online only

query list(c: cursor ?):
  return notes where .ownerId = viewer after c last 100 by .id

mutation add(title: text 1..200):
  return insert notes { title, done: false, ownerId: viewer }

mutation toggle(noteId: notes):
  note = notes[noteId] ! else NOT_FOUND
  update notes[note] { done: not note.done }
  return null

mutation remove(noteId: notes):
  delete notes[noteId]
  return null

-- Spec: only the owner may toggle completion, regardless of how reads are implemented.
-- Target this action instead of copying its table read rule; add app privacy intent from the spec.
invariant notes.toggle only .ownerId = viewer
