mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: a, label: '𐀀', flag: true, maybe: n, tag: 'tag0' }
  return a

table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: tags
  unique byTag: tag
  read <- .owner = viewer or (exists access[.bucket, viewer] and .flag = true)
  insert <- .owner = viewer or (exists access[.bucket, viewer] and .flag = true)
  update <- .owner = viewer or (exists access[.bucket, viewer] and .flag = true)
  delete <- .owner = viewer or (exists access[.bucket, viewer] and .flag = true)
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal

table tags:
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true last 1 by .label, .score after c
