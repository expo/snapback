table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  tag: id
  until: time ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  expire at .until
  sync to .owner

table tags:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer last 5 by .label, .score after c { id, t: tags[.tag] }
