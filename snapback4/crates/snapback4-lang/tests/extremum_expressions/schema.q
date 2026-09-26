table members:
  conversation: id
  joinedOrdinal: int
  seenOrdinal: int
  n: int ?
  cap 50 by conversation
  public
  sync public
query receipt(conversation: id, ordinal: int):
  m = { conversation, ordinal }
  return min(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
query fastest(conversation: id, ordinal: int):
  m = { conversation, ordinal }
  return max(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
query nullable(conversation: id, ordinal: int):
  return { low: min(members where .conversation = conversation, .n + ordinal if .n != null else null), high: max(members where .conversation = conversation, .n + ordinal if .n != null else null) }
query loop(conversation: id, ordinal: int):
  low = null if true else 0
  high = null if true else 0
  for member in members where .conversation = conversation:
    if member.n != null:
      value = member.n + ordinal
      if low = null or value < low:
        low = value
      if high = null or value > high:
        high = value
  return { low, high }
query defaulted(conversation: id, ordinal: int):
  return min(members where .conversation = conversation, .n + ordinal if .n != null else null) ?? 2
query page(conversation: id, ordinal: int):
  rows = members where .conversation = conversation first 2 by .id
  return max(rows, .n + ordinal if .n != null else null)
query list():
  rows = [{ n: null }, { n: 8 }, null, { n: -2 }]
  return { low: min(rows, .n + 1 if .n != null else null), high: max(rows, .n ?? 0), text: min([{ s: 'Z' }, { s: 'B' }], lower(.s)), bool: max([{ n: 0 }, { n: 1 }], .n > 0) }
query nested(conversation: id, ordinal: int):
  return max(members where .conversation = conversation, (min([{ n: 7 }], .n + 1) ?? 0) + .seenOrdinal)
