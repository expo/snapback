table messages:
  tombstone: bool
  public 'messages'
query history():
  return messages first 20 by byId { *, tombstone }
