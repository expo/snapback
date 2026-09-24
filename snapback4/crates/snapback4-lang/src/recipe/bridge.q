-- Generated public model bridge. Call these fn helpers inside app mutations.
-- Insert the profile/post/repost in that transaction before passing its reference.
-- Publish only a new card or an initial-adoption backfill; never republish a
-- removed card after tombstone purge. Retry original writes with their write ID.
-- Initial backfill: pause app writes, register authors, publish events/reposts,
-- then follow edges with bounded calls/checkpoints before switching Following.
-- Media and bodies stay in the app card. Removal retains that card for reposts.

fn @PREFIX@AppRegister(profileId: @PROFILES@):
  profile = @PROFILES@[id = profileId] ! else FEED_APP_NOT_FOUND
  require profile.@PRINCIPAL@ = viewer else FEED_APP_OWNER
  return @PREFIX@Register()

fn @PREFIX@AppPublish(postId: @POSTS@):
  post = @POSTS@[postId] ! else FEED_APP_NOT_FOUND
  require post.@AUTHOR@ = viewer else FEED_APP_OWNER
  profile = @PROFILES@[@PRINCIPAL@ = viewer] ! else FEED_APP_NOT_FOUND
  author = @PREFIX@Authors[principal = viewer] ! else FEED_AUTHOR_NOT_FOUND
  existing = @PREFIX@Posts[viewer, post.id, false]
  if existing != null:
    require existing.authorId = post.@AUTHOR@ and existing.at = post.@POST_TIME@ else FEED_APP_EVENT
    return existing.id
  require not exists @PREFIX@RemovedEvents[eventId = post.id] else FEED_EVENT_REMOVED
  event = insert @PREFIX@Posts { id: post.id, postId: post.id, actorId: viewer, authorId: post.@AUTHOR@, repost: false, at: post.@POST_TIME@, shared: author.shared }
  @PREFIX@Deliver(event)
  return event.id

fn @PREFIX@AppRemove(postId: @POSTS@):
  post = @POSTS@[postId] ! else FEED_APP_NOT_FOUND
  require post.@AUTHOR@ = viewer else FEED_APP_OWNER
  event = @PREFIX@Posts[viewer, post.id, false]
  if event != null:
    require event.authorId = post.@AUTHOR@ and event.at = post.@POST_TIME@ else FEED_APP_EVENT
    @PREFIX@RemoveEvent(event)
  return null

fn @PREFIX@AppRepost(repostId: @REPOSTS@):
  repost = @REPOSTS@[repostId] ! else FEED_APP_NOT_FOUND
  require repost.@ACTOR@ = viewer else FEED_APP_OWNER
  post = @POSTS@[repost.@ORIGINAL@] ! else FEED_APP_NOT_FOUND
  profile = @PROFILES@[@PRINCIPAL@ = viewer] ! else FEED_APP_NOT_FOUND
  author = @PREFIX@Authors[principal = viewer] ! else FEED_AUTHOR_NOT_FOUND
  existing = @PREFIX@Posts[viewer, post.id, true]
  if existing != null:
    require existing.authorId = post.@AUTHOR@ and existing.at = repost.@REPOST_TIME@ else FEED_APP_EVENT
    return existing.id
  original = @PREFIX@Posts[post.@AUTHOR@, post.id, false] ! else FEED_POST_NOT_FOUND
  require original.authorId = post.@AUTHOR@ and original.at = post.@POST_TIME@ else FEED_APP_EVENT
  event = insert @PREFIX@Posts { postId: post.id, actorId: viewer, authorId: post.@AUTHOR@, repost: true, at: repost.@REPOST_TIME@, shared: author.shared }
  @PREFIX@Deliver(event)
  return event.id

fn @PREFIX@AppUnrepost(repostId: @REPOSTS@):
  repost = @REPOSTS@[repostId]
  if repost = null:
    return null
  require repost.@ACTOR@ = viewer else FEED_APP_OWNER
  event = @PREFIX@Posts[viewer, repost.@ORIGINAL@, true]
  if event != null:
    post = @POSTS@[repost.@ORIGINAL@] ! else FEED_APP_NOT_FOUND
    require event.authorId = post.@AUTHOR@ and event.at = repost.@REPOST_TIME@ else FEED_APP_EVENT
    @PREFIX@RemoveEvent(event)
  delete @REPOSTS@[repost.id]
  return null

fn @PREFIX@AppFollow(authorId: principal):
  profile = @PROFILES@[@PRINCIPAL@ = authorId] ! else FEED_APP_NOT_FOUND
  reader = @PROFILES@[@PRINCIPAL@ = viewer] ! else FEED_APP_NOT_FOUND
  insert @FOLLOWS@ { @FOLLOWER@: viewer, @FOLLOWED@: authorId } if absent
  return @PREFIX@AddFollow(authorId)

fn @PREFIX@AppUnfollow(authorId: principal):
  delete @FOLLOWS@[@FOLLOWER@ = viewer, @FOLLOWED@ = authorId]
  return @PREFIX@DropFollow(authorId)
