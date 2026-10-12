table items:
  owner: principal
  bucket: int
  score: int
  read <- .owner = viewer or exists access[0, viewer]
  insert <- allow
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- exists access[.bucket, viewer]
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) last 1 by .score after c
