-- M8 attribution upgrade for existing nested replies and their likes.
fn replyIdFor(postId: id): replies[postId].id
job backfillReplyTargets():
  chunk r in replies first 100 by byId:
    target = replyIdFor(r.postId)
    if r.replyTarget = null and target != null:
      update replies[r.id] { replyTarget: target }
  chunk l in likes first 100 by byId:
    target = replyIdFor(l.postId)
    if l.replyTarget = null and target != null:
      update likes[l.id] { replyTarget: target }
