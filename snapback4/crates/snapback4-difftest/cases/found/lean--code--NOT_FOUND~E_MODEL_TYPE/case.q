table items:
  score: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v0 = (items[k2].score ?? 0)
  delete items[key]
  return false

query observe(key: id, k2: id):
  return [items[key], items[k2]]
