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
  item: items on delete restrict
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  sync public

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return 0

query observe(key: id, k2: id):
  return { item: [items[key], items[k2]], kids: kids where .item = key and .owner = viewer first 10 by .id }
