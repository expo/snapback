mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[k2] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  upsert items[key] { owner: viewer, bucket, score: 1, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return false

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) last 1 by .label, .score after c
