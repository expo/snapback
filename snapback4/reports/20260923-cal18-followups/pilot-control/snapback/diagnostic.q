-- k is a posts reference. Exact-type resolution selects byPostId.
-- This is a whole reply group, not an open-reply-by-ID operation.
query inferredThread(k: posts):
  return replies[k]

-- Spell both the column and index to make that same intent explicit.
-- k stays a posts reference; there is no reference conversion.
query explicitThread(k: posts):
  return replies[postId = k] by byPostId
