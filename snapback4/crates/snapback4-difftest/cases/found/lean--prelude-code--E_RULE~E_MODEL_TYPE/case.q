mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  insert items { id: key, owner: viewer, bucket, score: (items[k2].score ?? 0), label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return true

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return 0
