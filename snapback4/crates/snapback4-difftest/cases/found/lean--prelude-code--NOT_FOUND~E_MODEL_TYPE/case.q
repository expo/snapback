mutation prep0(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  update items[key] { score: (items[key].score ?? 0) }
  return b

table items:
  score: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

query run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return 0
