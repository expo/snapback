table sessions:
  owner: principal
  expiresAt: time
  by byOwner: owner, id
  by byExpiry: expiresAt, id
  expire at .expiresAt
  public 'live sessions'
  sync public
maintain liveCounts: count sessions by owner
  read <- allow
table actions:
  owner: principal
  cap 100
  public 'actions'
  insert <- exists liveCounts[.owner]
  sync public
mutation act():
  insert actions { owner: viewer }
