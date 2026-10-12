table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- allow
  update (old, next) <- old.owner = viewer
  delete <- exists access[.bucket, viewer]
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table kids:
  item: items on delete cascade
  owner: principal
  cap 4 by item
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
  return items where (.bucket = bucket or .bucket = 1) first 1 by .label, .score after c
