mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: key, owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  insert items { id: key, owner: viewer, bucket, score: (items[k2].score ?? 0), label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return a

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
  return items where .bucket = bucket last 1 by .label, .score after c
