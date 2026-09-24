table orgs:
  public 'organizations'
  sync public
table members:
  org: orgs
  principal: principal
  unique org, principal
  cap 100 by org
  read <- exists members[.org, viewer]
  sync to members[.org]
table issues:
  org: orgs
  cap 100 by org
  status: enum('todo', 'doing', 'done')
  assignee: principal ?
  at: time
  read <- exists members[.org, viewer]
  sync to members[.org]
table labels:
  public 'labels'
  sync public
table issueLabels:
  issue: issues
  label: labels
  org: orgs
  unique issue, label
  read <- exists members[.org, viewer]
  sync to members[.org]
table profiles:
  owner: principal
  handle: text <=40
  bio: text <=100
  search handle, bio
  read <- .owner = viewer
  sync to .owner

query board(org: orgs, status: enum('todo', 'doing', 'done') ?, assignee: principal ?, c: cursor ?):
  return issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 1 by .at after c
query total(org: orgs, status: enum('todo', 'doing', 'done') ?):
  return count(issues where .org = org and (status = null or .status = status))
query window(org: orgs, start: time ?, c: cursor ?):
  return issues where .org = org and (start = null or .at >= start) last 1 by .at after c
query local(org: orgs, status: enum('todo', 'doing', 'done') ?, c: cursor ?):
  selected = status
  return issues where .org = org and (.status = selected or null = selected) last 1 by .at after c
query withLabel(org: orgs, label: labels, c: cursor ?):
  return issues where .org = org and exists issueLabels[.id, label] last 1 by .at after c
query withNamedLabel(org: orgs, label: labels, c: cursor ?):
  return issues where .org = org and exists issueLabels[issue = .id, label = label] last 1 by .at after c
query people(q: text <=100, c: cursor ?):
  return profiles where .owner = viewer matching q first 1 by .handle after c
