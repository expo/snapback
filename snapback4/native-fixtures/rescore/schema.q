-- Interview's feed-relevant subset (LLP 3000.004 §5) with the scoring job
-- and the personalizer native (LLP 3000.005), plus two jobs that misbehave
-- on purpose. Both the sim and the device tests compile this file.
use identity
use personas alice, bob, marc

table prompts:
  title: text 1..300
  authorId: principal
  at: time
  by byTime: at, id
  immutable authorId, at
  read <- allow
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- deny
  sync public last 500 by byTime

table posts:
  promptId: prompts
  authorId: principal
  provider: text <=30 ?
  summary: text <=1200
  at: time
  by byTime: at, id
  by byPromptTime: promptId, at, id
  immutable promptId, authorId, at
  read <- allow
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- deny
  sync public last 2000 by byTime

table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal                     -- no horizon: a miss on the device is definitive (LLP 3000.005 §9)

table comments:
  postId: posts
  authorId: principal
  body: text 1..1500
  at: time
  by byTime: at, id
  immutable postId, authorId, at
  read <- allow
  insert <- .authorId = viewer
  update <- .authorId = viewer
  delete <- deny
  sync public last 2000 by byTime

maintain postScore: sum votes of direction by postId
  read <- allow

maintain commentCount: count comments by postId
  read <- allow

table ranked:
  postId: posts
  score: int
  at: time
  unique byPost: postId
  by byScore: score, id
  read <- allow
  insert <- deny
  update <- deny
  delete <- deny
  sync public last 500 by byScore

table seen:
  readerId: principal
  postId: posts
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .readerId = viewer
  update <- deny
  delete <- deny
  sync to .readerId                      -- no horizon: the viewer's own rows, bounded by the viewer

table affinity:
  readerId: principal
  postId: posts
  score: int
  at: time
  unique byReaderPost: readerId, postId
  by byReaderScore: readerId, score, id
  read <- .readerId = viewer
  insert <- allow
  update <- allow
  delete <- deny
  sync to .readerId                      -- no horizon, as above

job rescore(): native
job overflow(): native
job clash(): native
job boom(): native

query personalize(first: int): native

schedule rescoreEvery every 5m: rescore

query home(c: cursor ?):
  return ranked[] after c last 50 by byScore { *, post: posts[.postId], mine: votes[.postId, viewer] }

mutation createPrompt(title: text 1..300):
  return insert prompts { title, authorId: viewer, at: now }

mutation writePost(promptId: prompts, summary: text <=1200, provider: text <=30 ?):
  require exists prompts[promptId] else PROMPT_NOT_FOUND
  return insert posts { promptId, authorId: viewer, provider, summary, at: now }

mutation vote(postId: posts, direction: int):
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  upsert votes[postId, viewer] { direction }

mutation comment(postId: posts, body: text 1..1500):
  return insert comments { postId, authorId: viewer, body, at: now }

mutation markSeen(postId: posts):
  return insert seen { readerId: viewer, postId, at: now } if absent

mutation setAffinity(readerId: principal, postId: posts, score: int):
  upsert affinity[readerId, postId] { score, at: now }
