table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer
  insert <- allow
  update (old, next) <- old.owner = viewer
  delete <- deny
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .label, .score after c
