mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return 0

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

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer first 1 by .label, .score after c
