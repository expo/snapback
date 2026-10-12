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
  online only

table kids:
  item: items
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: a, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return 0

query observe(key: id, k2: id):
  return { item: [items[key], items[k2]], kids: kids where .item = key and .owner = viewer first 10 by .id }
