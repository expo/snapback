table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  update items[key] { score: 0 }
  return true

query observe(key: id):
  return items[key]
