table groups:
  peers: [principal] 1..49
  public
  insert <- allow
  update <- allow
  sync public
shape roster = { id, peers }
mutation createGroup(peers: [principal] 1..49):
  return insert groups { peers }
mutation built(n: int):
  peers = []
  for i in range(0, 50):
    if i < n:
      peers = peers + [viewer]
  return insert groups { peers }
mutation edit(id: groups, n: int):
  peers = []
  for i in range(0, 50):
    if i < n:
      peers = peers + [viewer]
  return update groups[id] { peers }
mutation put(id: groups, n: int):
  peers = []
  for i in range(0, 50):
    if i < n:
      peers = peers + [viewer]
  return upsert groups[id] { peers }
mutation guarded(peers: [principal] <=49):
  require count(peers) >= 1 else MEMBERS_REQUIRED
  return peers
query one(id: groups):
  return groups[id] roster
