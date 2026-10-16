use identity
use personas alice, bob

table posts:
  title: text <= 100
  read <- allow
  insert <- allow
  online only

table reactions:
  post: posts
  owner: principal
  emoji: text <= 20
  at: time default now
  immutable post, owner, at
  unique post, owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only

query mine(c: cursor ?):
  return reactions where .owner = viewer after c first 100 by .id

mutation addPost(title: text 1..100):
  return insert posts { title }

mutation react(post: posts, emoji: text 1..20):
  return upsert reactions[post, viewer] { post, owner: viewer, emoji, at: now }
