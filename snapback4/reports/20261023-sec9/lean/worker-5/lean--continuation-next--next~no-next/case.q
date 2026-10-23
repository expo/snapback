table items:
  bucket: int
  score: int
  label: text <=64
  read <- allow
  insert <- exists access[.bucket, viewer]
  update <- exists access[.bucket, viewer]
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
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true and .score >= 0 last 1 by .label, .score after c
