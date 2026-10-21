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
  read <- .owner = viewer or (not .flag and exists access[0, viewer])
  insert <- .owner = viewer or (not .flag and exists access[0, viewer])
  update <- .owner = viewer or (not .flag and exists access[0, viewer])
  delete <- .owner = viewer or (not .flag and exists access[0, viewer])
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  cap 16 by principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .flag = false last 1 by .label, .score after c
