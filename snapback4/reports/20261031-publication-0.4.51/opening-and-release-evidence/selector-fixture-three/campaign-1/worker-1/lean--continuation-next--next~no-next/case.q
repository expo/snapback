table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  tag: tags
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- allow
  update <- allow
  delete <- exists access[.bucket, viewer]
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

table tags:
  rank: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .tag.rank = 1 first 1 by .label, .score after c
