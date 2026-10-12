table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

table kids:
  item: items ? on delete set null
  owner: principal
  cap 4 by item
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) and .owner = viewer first 6 by .label, .score after c
