use identity password
table roles:
  principal: principal
  role: enum('member')
  unique principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member')):
  return insert roles {principal,role}
table rows:
  owner: principal
  title: text <=80
  color: text <=20 default 'blue'
  cap 1 by owner
  read <- .owner = viewer
  insert <- .owner = viewer and exists roles[principal = viewer]
  online only
mutation add(title: text <=80):
  return insert rows {owner:viewer,title}
query list():
  return rows where .owner = viewer first 20 by .id
