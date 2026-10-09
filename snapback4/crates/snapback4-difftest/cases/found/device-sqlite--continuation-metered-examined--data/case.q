table items:
  bucket: int
  score: int
  label: text <=64
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .label, .score after c
