table items:
  owner: principal
  bucket: int
  label: text <=64
  maybe: int ?
  read <- .owner = viewer
  insert <- deny
  update (old, next) <- old.owner = viewer
  delete <- .owner = viewer
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .maybe, .label after c
