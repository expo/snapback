table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- allow
  update <- exists access[.bucket, viewer]
  delete <- allow
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

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .label, .score after c
