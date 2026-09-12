-- Shared projections are expanded and certified in each importing operation.
shape authorCard = { displayName, handle }

shape feedCard = {
  id, kind, at, ord, actor, post,
  reposter: users[principal = .actor] authorCard,
  item: .post {
    id, author, body, parent, at, likeCount, replyCount, repostCount,
    authorProfile: users[principal = .author] authorCard,
  },
}
