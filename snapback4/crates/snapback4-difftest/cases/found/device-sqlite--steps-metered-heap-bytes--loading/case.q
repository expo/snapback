table items:
  owner: principal
  bucket: int
  score: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  unused = 6
  return sum(items where .bucket = bucket and .owner = viewer, .score)
