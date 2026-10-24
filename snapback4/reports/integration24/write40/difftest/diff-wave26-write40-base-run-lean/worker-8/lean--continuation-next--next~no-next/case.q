table items:
  bucket: int
  score: int
  label: text <=64
  tag: tags
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

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
  online only

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket and .tag.rank = 1 last 1 by .label, .score after c
