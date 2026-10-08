table items:
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items[key]
