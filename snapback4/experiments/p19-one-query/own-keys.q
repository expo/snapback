-- A lower-level feasibility experiment, not proposed application boilerplate.
-- The RFC proposes the platform supplies equivalent partition coverage.
table p19LikeKeys:
  post: id
  owner: principal
  unique post, owner
  immutable post, owner
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync
table p19RepostKeys:
  post: id
  owner: principal
  unique post, owner
  immutable post, owner
  read <- .owner = viewer
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync
query p19OwnedState(post: id):
  return { liked: exists p19LikeKeys[post, viewer], reposted: exists p19RepostKeys[post, viewer] }
mutation p19RemoveLike(post: id):
  delete p19LikeKeys[post, viewer]
