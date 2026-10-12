table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  helper: principal ?
  read <- .owner = viewer
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
  sync public

table kids:
  item: items on delete keep
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.owner = viewer or .helper = viewer) and .bucket = bucket first 1 by .label, .score after c
