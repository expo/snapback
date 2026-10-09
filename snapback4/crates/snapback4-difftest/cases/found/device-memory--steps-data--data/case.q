table items:
  owner: principal
  bucket: int
  score: int
  until: time ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  expire at .until
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  unused = 4
  return sum(items where .bucket = bucket and .owner = viewer, .score)
