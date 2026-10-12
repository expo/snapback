table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- allow
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- deny
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) last 1 by .label, .score after c
