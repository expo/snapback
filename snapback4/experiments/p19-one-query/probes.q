
use personas p19owner, p19reader
query p19RawState(post: posts):
  return { liked: exists likes[post, viewer], reposted: exists reposts[viewer, post] }
query p19RawPost(id: posts):
  return posts[id] { *, authorProfile: profiles[principal = .author], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query p19SearchOrdinary(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query p19MyLikes(c: cursor ?):
  return likes where .principal = viewer first 100 by .id after c
