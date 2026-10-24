table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  helper: principal ?
  read <- .owner = viewer
  insert <- exists access[.bucket, viewer]
  update (old, next) <- next.owner = viewer
  delete <- deny
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  cap 16 by principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table kids:
  item: items ? on delete cascade
  owner: principal
  cap 4 by item
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.owner = viewer or .helper = viewer) and .bucket = bucket last 1 by .label, .score after c
