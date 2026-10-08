table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer
  insert <- deny
  update <- .owner = viewer
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .label, .score after c
