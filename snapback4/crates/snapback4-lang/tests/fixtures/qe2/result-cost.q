table parents:
  owner: principal
  value: int
  read <- .owner = viewer
  sync to .owner
table kids:
  parent: parents
  n: int
  photo: text <=20 ?
  edited: bool default false
  label: text <=20 default ''
  public
  insert <- .parent.value = 1
  sync public
mutation bound():
  k = insert kids { id: 'k', parent: 'p', n: 1 }
  return { photo: k.photo, edited: k.edited, label: k.label }
mutation discarded():
  insert kids { id: 'k', parent: 'p', n: 1 }
  return true
