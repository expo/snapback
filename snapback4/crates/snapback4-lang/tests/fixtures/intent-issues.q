use identity password
table orgs:
  name: text <=80
  owner: principal
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
table members:
  org: orgs
  principal: principal
  role: enum('admin', 'member')
  unique org, principal
  read <- exists members[.org, viewer]
  insert <- exists members[.org, viewer, role = 'admin'] or created orgs[.org]
table issues:
  org: orgs
  title: text
  status: enum('todo', 'doing', 'done')
  assignee: principal ?
  due: time ?
  priority: int
  at: time
  immutable org
  search title
  read <- exists members[.org, viewer]
  insert <- exists members[.org, viewer]
  update <- exists members[.org, viewer]
table issueLabels:
  issue: issues
  label: text <=40
  org: orgs
  unique issue, label
  read <- exists members[.org, viewer]
  insert <- exists members[.org, viewer]
view statusCounts: count issues by .org, .status
query board(org: orgs, status: enum('todo', 'doing', 'done') ?, assignee: principal ?, c: cursor ?):
  return issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c
query overdue(org: orgs, c: cursor ?):
  return issues where .org = org and .due < now and .status != 'done' first 50 by .due after c
query counts(org: orgs):
  return { todo: statusCounts[org, 'todo'], doing: statusCounts[org, 'doing'], done: statusCounts[org, 'done'] }
query withLabel(org: orgs, label: text <=40, c: cursor ?):
  return issues where .org = org and exists issueLabels[.id, label] last 50 by .at after c
query find(org: orgs, q: text <=100, c: cursor ?):
  return issues matching q where .org = org last 20 by .at after c
query card(id: issues):
  i = issues[id] ! else NOT_FOUND
  return { ...i, labels: issueLabels where .issue = id first 20 by .label }
