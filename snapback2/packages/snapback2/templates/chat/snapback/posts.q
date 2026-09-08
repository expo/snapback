mutation createPost(body: text <=500):
  require exists profiles[viewer] else PROFILE_REQUIRED
  row = insert posts { author: viewer, body, at: now }
  return row
