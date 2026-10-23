table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  tag: tags
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

table tags:
  rank: int
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table kids:
  item: items on delete cascade
  owner: principal
  cap 4 by item
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .owner = viewer and .tag.rank = 1 first 1 by .label, .score after c
