-- This is a thread read: k has exactly the type of replies.postId.
-- It does not open a reply by the reply's identity, despite t[k] syntax.
query positionalPostReference(k: posts):
  return replies[k]

-- Preserve that meaning explicitly: bind k to postId and name its index.
-- No conversion from a posts reference to a replies reference is involved.
query explicitPostReference(k: posts):
  return replies[postId = k] by byPostId

-- Opening one reply requires a reply identity supplied by the caller.
query explicitReplyReference(k: replies):
  return replies[id = k] by byId
