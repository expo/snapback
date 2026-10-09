table items:
  owner: principal
  score: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  v0 = (items[k2].score ?? 0)
  v1 = b
  return (0 < (v1 * b))

query observe(key: id, k2: id):
  return [items[key], items[k2]]
