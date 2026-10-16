table projects:
  owner: principal
  read <- .owner = viewer
  insert <- allow
  update <- allow
  sync
table tasks:
  project: projects
  body: text <=80
  immutable project
  cap 2 by project
  read through live .project
  insert <- allow
  update <- allow
  delete <- allow
  sync
mutation transfer(project: projects, owner: principal):
  update projects[project] { owner }
mutation transferAndFail(project: projects, owner: principal):
  update projects[project] { owner }
  require false else STOP
query all(project: projects):
  return tasks where .project = project first 10 by .id

query one(task: tasks):
  return tasks[task]
mutation add(project: projects, body: text <=80):
  return insert tasks { project, body }
mutation transferAndRead(project: projects, owner: principal, task: tasks):
  update projects[project] { owner }
  return tasks[task]
mutation removeProject(project: projects):
  delete projects[project]
