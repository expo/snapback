table notes:
  owner: principal
  read <- allow
  online only
query page():
  return notes first 50 by .id
invariant notes.read only .owner = viewer
