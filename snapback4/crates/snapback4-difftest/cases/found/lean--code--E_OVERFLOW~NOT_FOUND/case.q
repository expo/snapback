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

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v0 = b
  upsert items[key] { owner: viewer, bucket, score: 1, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  insert items { id: key, owner: viewer, bucket, score: (v0 + 1), label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
