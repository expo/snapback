table items:
  bucket: int
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .score >= 0 last 4 by .score after c
