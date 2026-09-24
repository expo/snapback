-- A server-serialized order distinct from display timestamps. Safe integer range
-- covers current Unix milliseconds multiplied by 1000; no client clock is used.
table messageClocks:
  conversationId: conversations
  last: time
  unique byConversation: conversationId
  immutable conversationId
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  update <- exists members[.conversationId, viewer]
  sync to members[.conversationId]

fn nextArrival(conversationId: conversations):
  previous = messageClocks[conversationId = conversationId]
  value = max(now * 1000, previous.last + 1) if previous != null else now * 1000
  upsert messageClocks[conversationId = conversationId] { last: value }
  return value

job backfill():
  chunk m in messages first 100 by byId:
    if m.arrival = null:
      update messages[m.id] { arrival: m.at * 1000 }
