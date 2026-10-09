table items:
  bucket: int
  score: int
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return min(items where .bucket = bucket, .score)
