mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return true

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- .owner = viewer or exists access[.bucket, viewer]
  update <- .owner = viewer or exists access[.bucket, viewer]
  delete <- .owner = viewer or exists access[.bucket, viewer]
  online only

table access:
  bucket: int ?
  principal: principal
  unique byMember: bucket, principal
  unique byPrincipalOnly: principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

table kids:
  item: items on delete cascade
  owner: principal
  cap 4 by item
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true first 1 by .label, .score after c
