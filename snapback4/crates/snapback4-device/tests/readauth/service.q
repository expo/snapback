table groups:
  public 'authorization groups'
  insert <- allow
  delete <- allow
  sync public
table seats:
  groupId: groups
  principal: principal
  unique byGroupPrincipal: groupId, principal
  by byPrincipal: principal, groupId, id
  read <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal
table members:
  groupId: groups
  principal: principal
  unique byGroupPrincipal: groupId, principal
  by byPrincipal: principal, groupId, id
  immutable groupId, principal
  until: time
  by byUntil: until
  expire at .until
  read <- exists members[.groupId, viewer] or viewer = 'service:admin'
  update <- .principal = viewer
  insert <- .principal = viewer and created groups[.groupId]
  delete <- .principal = viewer
  sync to members[.groupId] by .principal
table notes:
  groupId: groups
  owner: principal
  immutable owner, groupId
  body: text <=100
  unique byGroupOwner: groupId, owner
  by byOwner: owner, groupId, id
  by byGroup: groupId, id
  read <- exists members[.groupId, viewer]
  insert <- .owner = viewer and created groups[.groupId]
  update <- .owner = viewer
  sync to members[.groupId] by .principal
table checks:
  groupId: groups
  by byGroup: groupId, id
  read <- exists notes[.groupId, viewer]
  insert <- allow
  sync to notes[.groupId] by .owner
table ticks:
  public 'replay evidence'
  insert <- allow
  sync public
mutation tick():
  insert ticks { id: new }
mutation publish():
  insert groups { id: 'group' }
  insert notes { id: 'note', groupId: 'group', owner: viewer, body: 'private' }
  insert checks { id: 'check', groupId: 'group' }
  insert members { id: 'grant', groupId: 'group', principal: viewer, until: 4102444800000 }
mutation noteOnly():
  delete groups['group']
  insert groups { id: 'group' }
  insert notes { id: 'note', groupId: 'group', owner: viewer, body: 'private' }
  insert checks { id: 'check', groupId: 'group' }
mutation grant():
  delete groups['group']
  insert groups { id: 'group' }
  insert members { id: 'grant', groupId: 'group', principal: viewer, until: 4102444800000 }
mutation revoke():
  delete members['grant']
mutation readOwnHidden():
  insert groups { id: 'group' }
  insert notes { id: 'note', groupId: 'group', owner: viewer, body: 'private' }
  require exists notes['note'] else HIDDEN
query point():
  return notes['note']
query scan():
  return notes['group'] first 100 by byGroup
query merged():
  return merge notes first 100 by byGroup:
    ['group']
    ['other']
query page(c: cursor ?):
  return notes['group'] after c first 100 by byGroup
query total():
  rows = notes['group'] first 100 by byGroup
  return count(rows)
query probe():
  return exists notes['note']
query ruleProbe():
  return checks['check']
query grantRow():
  return members['grant']
query ticksRead():
  return ticks[] first 100 by byId

query group():
  return groups['group']
mutation readLater():
  require exists notes['note'] else HIDDEN
  rows = notes['group'] first 100 by byGroup
  require count(rows) = 1 else HIDDEN
  insert ticks { id: 'read-succeeded' }

query member():
  return members['grant']
mutation renew():
  update members['grant'] { until: 4102444801000 }
  return null
