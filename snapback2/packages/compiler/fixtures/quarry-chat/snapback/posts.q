mutation createPost(body: text <=500):
  require exists profiles[viewer] else PROFILE_REQUIRED
  row = +posts { author: viewer, body, at: now }
  return { id: row.id, author: viewer, body, at: row.at }
