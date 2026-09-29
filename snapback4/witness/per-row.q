use personas alice, bob
table cards:
  owner: principal
  slot: int
  label: text
  read <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
query point(id: cards):
  return cards[id]
query page(slot: int):
  return cards where .slot = slot first 2 by .id
query list(n: int):
  return cards where .owner = viewer and .slot < n first 1000 by .id
mutation edit(id: cards, label: text):
  update cards[id] { label }
table notes:
  owner: principal
  body: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation unrelated():
  insert notes { owner: viewer, body: 'unrelated' }
