mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: a, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return b

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update <- .owner = viewer
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

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return 0
