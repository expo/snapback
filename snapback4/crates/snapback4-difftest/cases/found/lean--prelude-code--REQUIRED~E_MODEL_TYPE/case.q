mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  require ((items[key].score ?? 0) = 7) else REQUIRED
  return 0

table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return false
