
table conversations:
  title: text <=80
  public 'count experiment'
table messages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  replyTo: messages ?
  recipients: [principal] <=50
  at: time
  by byConversation: conversationId, at, id
  by byExpires: expiresAt
  expire at .expiresAt
  public 'count experiment'
query countPeriod(conversationId: conversations, principal: principal, periodStart: time, periodEnd: time, readAt: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 10000 by byConversation where .at > readAt and .senderId != principal and not .tombstone)
query countAll(principal: principal, periodStart: time, periodEnd: time, readAt: time):
  total = 0
  for c in conversations first 1000 by byId:
    total = total + count(messages[c.id, at >= periodStart, at < periodEnd] first 10000 by byConversation where .at > readAt and .senderId != principal and not .tombstone)
  return total

effect measuredCount
job streamPeriod(principal: principal, periodStart: time, periodEnd: time, readAt: time):
  for c in conversations:
    n = count(messages[c.id, at >= periodStart, at < periodEnd] by byConversation where .at > readAt and .senderId != principal and not .tombstone)
    emit measuredCount { n } once [c.id, periodEnd]
