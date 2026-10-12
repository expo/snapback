table metas:
  ok: bool
  public
  sync public

table tasks:
  owner: principal
  meta: metas
  at: int
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner

query flagged(c: cursor ?):
  return tasks where .owner = viewer and .meta.ok = true last 2 by .at after c
query ascending(c: cursor ?):
  return tasks where .owner = viewer and .meta.ok = true first 2 by .at after c
query single(c: cursor ?):
  return tasks where .owner = viewer and .meta.ok = true last 1 by .at after c
