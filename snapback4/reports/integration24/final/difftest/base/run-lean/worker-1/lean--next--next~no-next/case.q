table items:
  bucket: int
  score: int
  flag: bool
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table kids:
  item: items ? on delete restrict
  owner: principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) first 1 by .flag, .score after c
