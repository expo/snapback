table reports:
  writer: principal
  reader: principal
  body: text <=100
  by byReader: reader, id
  read <- .reader = viewer
  insert <- .writer = viewer
  update <- .writer = viewer
  sync to .reader

table ticks:
  public 'reconnect witness'
  insert <- allow
  sync public

mutation tick():
  insert ticks {}
mutation submit(reader: principal):
  insert reports { id: 'report', writer: viewer, reader, body: 'private' }
mutation hide():
  update reports['report'] { reader: 'moderator', body: 'changed' }
  return null
mutation upsertHide():
  upsert reports['report'] { reader: 'moderator', body: 'changed' }
  return null
mutation change():
  update reports['report'] { body: 'changed' }
mutation upsertChange():
  upsert reports['report'] { body: 'changed' }
mutation mixed():
  insert reports { id: 'own', writer: viewer, reader: viewer, body: 'own' }
  insert reports { id: 'report', writer: viewer, reader: 'moderator', body: 'private' }
query ticksRead():
  return ticks[] first 100 by byId
query page(reader: principal, c: cursor ?):
  return reports[reader] after c first 100 by byReader
query point(id: reports):
  return reports[id]
query scan(reader: principal):
  return reports[reader] first 100 by byReader
query merged():
  return merge reports first 100 by byReader:
    [viewer]
    ['moderator']
query probe(id: reports):
  return exists reports[id]
query total(reader: principal):
  rows = reports[reader] first 100 by byReader
  return count(rows)

mutation mixedAhead():
  insert reports { id: 'a-hidden', writer: viewer, reader: 'moderator', body: 'private' }
  insert reports { id: 'z-visible', writer: viewer, reader: viewer, body: 'visible' }
query wide():
  return reports[] first 1 by byId
query widePage(c: cursor ?):
  return reports[] after c first 1 by byId
query wideMerge():
  return merge reports first 1 by byId:
    []
    []
query wideCount():
  rows = reports[] first 100 by byId
  return count(rows)
