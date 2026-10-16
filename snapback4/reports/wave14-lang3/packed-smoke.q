table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table harvests:
  grower: principal
  read <- .grower = viewer or exists staff[viewer]
  sync
query mine(c: cursor ?):
  return harvests where .grower = viewer first 20 by .id after c
