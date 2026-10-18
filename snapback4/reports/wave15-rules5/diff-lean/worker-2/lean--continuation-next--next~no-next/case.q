table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- allow
  online only

table kids:
  item: items
  owner: principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .label, .score after c
