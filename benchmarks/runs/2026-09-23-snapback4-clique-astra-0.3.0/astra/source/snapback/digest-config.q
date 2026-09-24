-- Generated from digest JSON; server schedule, no client trigger.
fn digestBucket(t: time): bucket(t, 2m, 0m)
maintain periodPosts: count posts by authorId, bucket(.at, 2m, 0m)
  read <- allow
  online only
maintain periodFollowers: count follows by followedId, bucket(.at, 2m, 0m)
  read <- allow
  online only
schedule dailyDigest every 2m: digest.daily
