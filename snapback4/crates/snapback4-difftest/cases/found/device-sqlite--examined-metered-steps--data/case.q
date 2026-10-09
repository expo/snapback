table items:
  bucket: int
  score: int
  label: text <=64
  tag: id
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

table tags:
  owner: principal
  rank: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  total = 0
  for row in items where .bucket = bucket last 5 by .label, .score:
    t = tags[row.tag]
    if t != null:
      total = total + t.rank
  return total
