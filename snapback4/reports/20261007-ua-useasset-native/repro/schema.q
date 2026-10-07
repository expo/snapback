use identity password
use personas alice

table messages:
  owner: principal
  body: text <=4000
  photo: image <=5000000
  at: time
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 100 by .at

mutation send(photo: image <=5000000):
  return insert messages { owner: viewer, body: 'Native ordinary', photo, at: now }
query history():
  return messages[owner = viewer] last 10 by .at
