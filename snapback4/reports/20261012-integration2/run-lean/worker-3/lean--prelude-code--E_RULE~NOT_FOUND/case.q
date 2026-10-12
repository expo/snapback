mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[k2] { owner: viewer, bucket, score: b, label: '𐀀', flag: true, maybe: n, tag: 'tag1' }
  return a

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  unique byTag: tag
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

table kids:
  item: items on delete cascade
  owner: principal
  cap 4 by item
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return 0
