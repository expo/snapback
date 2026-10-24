table items:
  owner: principal
  bucket: int
  score: int
  flag: bool
  read <- .owner = viewer or exists access[0, viewer]
  insert <- deny
  update <- exists access[.bucket, viewer]
  delete <- .owner = viewer
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  cap 16 by principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .flag, .score after c
