table items:
  score: int
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny
  online only

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  update items[key] { score: (a + b) }
  return true

query observe(key: id):
  return items[key]
