use identity

table items:
  owner: principal
  label: text <=100
  by owner
  by byOwnerLabel: owner, label
  read r <- r.owner = viewer
  insert r <- r.owner = viewer

table other:
  owner: principal
  public
