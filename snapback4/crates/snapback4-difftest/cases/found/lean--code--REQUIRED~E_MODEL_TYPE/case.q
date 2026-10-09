table items:
  score: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  require ((items[key].score ?? 0) = 2) else REQUIRED
  return 1

query observe(key: id, k2: id):
  return [items[key], items[k2]]
