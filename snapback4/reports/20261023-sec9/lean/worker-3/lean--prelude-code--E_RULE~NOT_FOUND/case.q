mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: b, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
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
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  online only

table kids:
  item: items ? on delete set null
  owner: principal
  cap 4 by item
  read <- .owner = viewer
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
