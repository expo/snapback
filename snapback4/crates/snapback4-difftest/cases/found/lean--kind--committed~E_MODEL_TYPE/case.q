table items:
  score: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return (items[k2].score ?? 0)

query observe(key: id, k2: id):
  return [items[key], items[k2]]
