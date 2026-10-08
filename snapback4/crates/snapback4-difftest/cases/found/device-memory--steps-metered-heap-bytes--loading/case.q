table items:
  bucket: int
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  unused = 5
  return sum(items where .bucket = bucket, .score)
