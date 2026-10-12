table items:
  bucket: int
  read <- exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update <- exists access[.bucket, viewer]
  delete <- exists access[.bucket, viewer]
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int 0.., b: int):
  return (a = (b + b))

query observe(key: id, k2: id):
  return [items[key], items[k2]]
