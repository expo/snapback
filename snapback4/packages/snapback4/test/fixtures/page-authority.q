use personas alice, bob
table groups:
  public
  insert <- allow
  sync public
table members:
  group: groups
  principal: principal
  unique group, principal
  unique principal
  public
  insert <- created groups[.group]
  delete <- allow
  sync public
table secrets:
  group: groups
  body: text <=100
  read <- exists members[.group, viewer]
  insert <- allow
  retain until-revoked
  sync to members[.group]
table controls:
  key: int
  unique key
  grow: bool
  public
  insert <- allow
  update <- allow
  sync public
table online:
  public
  online only
mutation setup(): server
  group = insert groups {}
  insert members { group: group.id, principal: 'dev:alice' }
  insert members { group: group.id, principal: 'dev:bob' }
  insert secrets { group: group.id, body: 'private' }
  insert controls { key: 1, grow: false }
mutation setCost(grow: bool): server
  for c in controls first 1:
    update controls[id = c.id] { grow }
mutation revoke():
  delete members[principal = 'dev:alice']
fn expensive():
  c = controls[key = 1]
  text = ''
  for n in range(0, 10000 if c.grow = true else 1):
    text = text + 'an allocation that stays bounded by the heap meter'
  return text
query visible():
  return secrets first 50
query privatePage():
  cost = expensive()
  return secrets first 50
query heldPage() held:
  cost = expensive()
  return secrets first 50
query serverPage():
  extra = online first 1
  cost = expensive()
  return secrets first 50
