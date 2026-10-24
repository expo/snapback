table items:
  owner: principal
  tag: id
  read <- .owner = viewer
  insert <- allow
  update (old, next) <- old.owner = viewer
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true last 1 by .tag after c
