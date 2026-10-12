mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[k2] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return 0

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

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

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 4 by .label, .score after c
