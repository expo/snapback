use personas alice
table notes:
  text: text <=100
  principal: principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  sync to .principal
query mine():
  return notes[viewer] first 20 by byPrincipal
mutation add(text: text <=100):
  insert notes { text, principal: viewer }
