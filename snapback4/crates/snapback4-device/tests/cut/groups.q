table access:
  bucket: int
  principal: principal
  unique bucket, principal
  read <- .principal = viewer
  insert <- deny
  sync to .principal

table items:
  bucket: int
  score: int
  read <- exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  sync to access[.bucket]

query one(c: cursor ?):
  return items where .bucket = 1 last 1 by .score after c
query two(c: cursor ?):
  return items where .bucket = 1 or .bucket = 2 last 1 by .score after c
