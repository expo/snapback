table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  opensAt: time ?
  unique byTag: tag
  read <- exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update <- exists access[.bucket, viewer]
  delete <- exists access[.bucket, viewer]
  not before .opensAt
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

table kids:
  item: items ?
  owner: principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

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
  return { item: [items[key], items[k2]], kids: kids where .item = key first 10 by .id }
