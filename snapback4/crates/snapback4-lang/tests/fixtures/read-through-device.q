table orgs:
  until: time ?
  immutable until
  expire at .until
  read <- exists members[.id, viewer]
  insert <- allow
  delete <- allow
  sync

table members:
  org: orgs
  principal: principal
  unique org, principal
  read <- .principal = viewer
  insert <- .principal = viewer and (created orgs[.org] or exists members[.org, viewer])
  delete <- .principal = viewer
  sync

table projects:
  org: orgs
  immutable org
  read through .org
  insert <- allow
  delete <- allow
  sync

table tasks:
  project: projects
  immutable project
  read through .project
  insert <- allow
  delete <- allow
  sync

table comments:
  task: tasks
  body: text <= 40
  at: int
  search body
  immutable task
  read through .task
  insert <- allow
  update <- allow
  delete <- allow
  sync

view totals: count comments by .task

mutation setup(org: orgs, project: projects, task: tasks, until: time ?):
  insert orgs {id: org, until}
  insert members {org, principal: viewer}
  insert projects {id: project, org}
  insert tasks {id: task, project}

mutation post(id: comments, task: tasks, body: text <= 40):
  insert comments {id, task, body, at: 1}

mutation newTask(id: tasks, project: projects):
  insert tasks {id, project}

mutation dropTask(id: tasks):
  delete tasks[id]

mutation put(id: comments, task: tasks):
  upsert comments[id] {body: 'upsert', at: 1}

mutation maybe(id: comments, task: tasks):
  insert comments {id, task, body: 'maybe', at: 1} if absent

query page(task: tasks):
  comments where .task = task first 10 by .at

query countFor(task: tasks):
  totals[task]

query allTasks():
  tasks first 10 by .id

query search(task: tasks):
  comments where .task = task matching 'old' first 10 by .at
