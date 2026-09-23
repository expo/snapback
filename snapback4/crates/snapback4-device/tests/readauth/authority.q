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
table grants:
  groupId: groups
  principal: principal
  unique byGroupPrincipal: groupId, principal
  by byPrincipal: principal, groupId, id
  read <- .principal = viewer
  insert <- .principal = viewer and created groups[.groupId]
  delete <- .principal = viewer
  sync to .principal
table notes:
  groupId: groups
  owner: principal
  immutable owner, groupId
  body: text <=100
  unique byGroupOwner: groupId, owner
  by byOwner: owner, groupId, id
  by byGroup: groupId, id
  read <- exists grants[.groupId, viewer]
  insert <- .owner = viewer and created groups[.groupId]
  update <- .owner = viewer
  sync to grants[.groupId] by .principal
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
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
mutation noteOnly():
  delete groups['group']
  insert groups { id: 'group' }
  insert notes { id: 'note', groupId: 'group', owner: viewer, body: 'private' }
  insert checks { id: 'check', groupId: 'group' }
mutation grant():
  delete groups['group']
  insert groups { id: 'group' }
  insert grants { id: 'grant', groupId: 'group', principal: viewer }
mutation revoke():
  delete grants['grant']
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
  return grants['grant']
query ticksRead():
  return ticks[] first 100 by byId
