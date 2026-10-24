table items:
  owner: principal
  bucket: int
  label: text <=64
  maybe: int ?
  helper: principal ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update (old, next) <- next.owner = viewer
  delete <- deny
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.owner = viewer or .helper = viewer) and .bucket = bucket last 1 by .maybe, .label after c
