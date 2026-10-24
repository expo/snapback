table items:
  owner: principal
  bucket: int
  score: int
  flag: bool
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- allow
  online only

table kids:
  item: items ? on delete keep
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .flag, .score after c
