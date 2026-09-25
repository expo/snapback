table members:
  org: id
  principal: principal
  unique org, principal
  read <- .principal = viewer
  insert <- allow
table orgs:
  owner: principal
  immutable owner
  read <- exists members[.id, viewer] or viewer = 'service:search'
  insert <- allow
table projects:
  org: orgs
  immutable org
  read through .org
  insert <- allow
table tasks:
  project: projects
  immutable project
  read through .project
  insert <- allow
table comments:
  task: tasks
  author: principal
  body: text <=100
  at: time
  immutable task
  read through .task
  insert <- .author = viewer
  delete <- .author = viewer
view totals: count comments by .task
mutation setup(owner: principal):
  insert members { id: 'member', org: 'o', principal: owner }
  insert orgs { id: 'o', owner }
  insert projects { id: 'p', org: 'o' }
  insert tasks { id: 't', project: 'p' }
mutation add():
  insert comments { id: 'c', task: 't', author: viewer, body: 'captured', at: 10 }
query one():
  return comments['c']
query page(c: cursor ?):
  return comments where .task = 't' first 20 by .at after c
query total():
  return totals['t']
