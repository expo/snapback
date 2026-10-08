table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer
  insert <- deny
  update (old, next) <- old.owner = viewer
  delete <- deny
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .tag after c
