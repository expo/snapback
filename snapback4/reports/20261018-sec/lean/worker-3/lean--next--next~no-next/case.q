table items:
  owner: principal
  bucket: int
  score: int
  flag: bool
  helper: principal ?
  read <- .owner = viewer or .helper = viewer
  insert <- .owner = viewer or .helper = viewer
  update <- .owner = viewer or .helper = viewer
  delete <- .owner = viewer or .helper = viewer
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .flag = true last 1 by .flag, .score after c
