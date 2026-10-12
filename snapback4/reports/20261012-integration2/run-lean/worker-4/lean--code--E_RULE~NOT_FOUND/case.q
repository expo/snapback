table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  unique byTag: tag
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

table kids:
  item: items on delete keep
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
  upsert items[key] { owner: viewer, bucket, score: b, label: '𐀀', flag: true, maybe: n, tag: 'tag1' }
  return false

query observe(key: id, k2: id):
  return { item: [items[key], items[k2]], kids: kids where .item = key first 10 by .id }
