table items:
  bucket: int
  score: int
  label: text <=64
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where (.bucket = bucket or .bucket = 1) first 1 by .label, .score after c
