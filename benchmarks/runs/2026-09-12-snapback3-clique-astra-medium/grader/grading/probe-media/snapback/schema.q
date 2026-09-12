use identity password

table profiles:
  owner: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  avatar: image <=10000000 ?
  unique byOwner: owner
  unique byHandle: handle
  read <- allow
  insert <- .owner = viewer
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- deny
