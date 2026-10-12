table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer or exists access[0, viewer]
  insert <- deny
  update <- allow
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

table kids:
  item: items ?
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .tag after c
