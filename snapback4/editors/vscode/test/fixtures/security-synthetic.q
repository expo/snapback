table notes:
  owner: principal
  body: text 1..80
  read <- allow
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
invariant notes.read only .owner = viewer
