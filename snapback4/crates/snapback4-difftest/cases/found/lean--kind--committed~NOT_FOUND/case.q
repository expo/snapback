table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return true

query observe(key: id):
  return items[key]
