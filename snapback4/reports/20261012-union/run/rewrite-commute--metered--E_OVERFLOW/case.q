table items:
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return ((b * a) = b)

query observe(key: id, k2: id):
  return [items[key], items[k2]]
