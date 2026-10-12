table items:
  bucket: int
  score: int
  label: text <=64
  flag: bool
  read <- exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update <- exists access[.bucket, viewer]
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

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) and (.score > 0 or .flag = false) first 1 by .label, .score after c
