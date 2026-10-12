table items:
  owner: principal
  bucket: int
  maybe: int ?
  read <- .owner = viewer
  insert <- deny
  update <- allow
  delete <- .owner = viewer
  online only

table kids:
  item: items on delete restrict
  owner: principal
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
  return items where .bucket = bucket first 1 by .maybe after c
