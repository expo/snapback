table items:
  owner: principal
  bucket: int
  score: int
  flag: bool
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- allow
  update <- exists access[.bucket, viewer]
  delete <- deny
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

table kids:
  item: items on delete restrict
  owner: principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .flag, .score after c
