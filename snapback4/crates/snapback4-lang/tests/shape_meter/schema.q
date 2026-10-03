table conversations:
  title: text
  public 'reproduction'
table members:
  conversation: conversations
  principal: principal
  seenOrdinal: int
  joinedOrdinal: int
  cap 100 by principal
  cap 100 by conversation
  unique conversation, principal
  public 'reproduction'
table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  at: time
  tombstone: bool
  public 'reproduction'
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, unread: count(messages[conversation = .conversation] where .ordinal > 0 and .sender != viewer and not .tombstone) }
fn unreadIn(conversation: conversations, reader: principal, seenOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and .ordinal > seenOrdinal and .sender != reader and not .tombstone)
query unreadPreview(periodStart: time, periodEnd: time, c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, unread: unreadIn(.conversation, viewer, .seenOrdinal, periodStart, periodEnd) }
