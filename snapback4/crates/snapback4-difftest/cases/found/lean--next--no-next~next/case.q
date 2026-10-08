table items:
  bucket: int
  tag: id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .tag
