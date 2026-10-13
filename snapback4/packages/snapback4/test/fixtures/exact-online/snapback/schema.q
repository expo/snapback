use identity
use personas alice

table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  online only

query list():
  return notes[viewer] first 100 by byOwner

mutation add(body: text <=200):
  row = insert notes {owner: viewer, body}
  return {id: row.id}
