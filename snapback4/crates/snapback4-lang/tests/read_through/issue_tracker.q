table members:
  org: id
  principal: principal
  unique org, principal
  read <- .principal = viewer
  insert <- allow
table issues:
  org: id
  title: text <=100
  comments: count comments by .issue
  immutable org
  read <- exists members[.org, viewer]
  insert <- allow
  delete <- allow
table comments:
  issue: issues
  author: principal
  body: text <=100
  immutable issue
  read through .issue
  insert <- .author = viewer
  delete <- .author = viewer
table issueLabels:
  issue: issues
  label: text <=20
  immutable issue
  read through .issue
  insert <- allow
  delete <- allow
mutation setup():
  insert members { id: 'member', org: 'org', principal: viewer }
  insert issues { id: 'i', org: 'org', title: 'A bug' }
  insert comments { id: 'c', issue: 'i', author: viewer, body: 'reported' }
  insert issueLabels { id: 'l', issue: 'i', label: 'bug' }
query issue():
  return issues['i']
query labels(c: cursor ?):
  return issueLabels where .issue = 'i' first 20 by .label after c
mutation erase():
  delete issues['i']
mutation clear():
  delete comments['c']
  delete issueLabels['l']
  delete issues['i']
