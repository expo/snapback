mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v1 = (items[key].score ?? 0)
  return b

table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return false
