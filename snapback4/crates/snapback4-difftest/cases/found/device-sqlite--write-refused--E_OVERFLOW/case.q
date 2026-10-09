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

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: k2, owner: viewer, bucket, score: b, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  v1 = (b * (items[k2].score ?? 0))
  return 0

query observe(key: id, k2: id):
  return [items[key], items[k2]]
