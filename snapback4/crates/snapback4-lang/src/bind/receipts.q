-- @ref LLP 3000.022#14 — compiler-owned recipe, executed by the ordinary metered interpreter.
table runs:
  @GROUP@: @SCOPE@
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique @GROUP@, principal, fromOrdinal
  cap 64 by @GROUP@, principal
  cap 3200 by @GROUP@
  read <- exists @MEMBERS@[.@GROUP@, viewer]
  insert <- .principal = viewer and exists @MEMBERS@[.@GROUP@, viewer]
  delete <- .principal = viewer
  sync to @MEMBERS@[.@GROUP@]


fn receipt(m: @MESSAGES@):
  state = 'read'
  remaining = 0
  for member in @MEMBERS@ where .@GROUP@ = m.@GROUP@:
    if member.principal != m.@SENDER@ and member.joinedOrdinal < m.@POSITION@:
      remaining = remaining + 1
      if m.@POSITION@ > member.deliveredOrdinal:
        run = first(runs[@GROUP@ = m.@GROUP@, principal = member.principal, fromOrdinal <= m.@POSITION@] last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.@POSITION@:
          return 'sent'
      if member.seenOrdinal < m.@POSITION@:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'


query receiptMember(@GROUP@: @SCOPE@):
  return @MEMBERS@[@GROUP@, viewer]

query progress(@GROUP@: @SCOPE@, c: cursor ?):
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .@GROUP@ = @GROUP@ and .principal = viewer, ahead: @MESSAGES@ where .@GROUP@ = @GROUP@ and .@POSITION@ > delivered and .@POSITION@ <= delivered + 100 last 100 by .@POSITION@ after c }


mutation delivered(@GROUP@: @SCOPE@, from: int, through: int)
  reports delivery of @MESSAGES@ by .@GROUP@, .@POSITION@: server
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  chat = @SCOPE@[@GROUP@] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  if through <= prefix:
    return null
  low = from
  high = through
  held = runs where .@GROUP@ = @GROUP@ and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from
  for run in held:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
  if prefix + 1 < low:
    blocker = first(@MESSAGES@ where .@GROUP@ = @GROUP@ and .@POSITION@ > prefix and .@POSITION@ < low first 1 by .@POSITION@)
    prefix = blocker.@POSITION@ - 1 if blocker != null else low - 1
  if prefix = max(me.deliveredOrdinal, me.joinedOrdinal):
    for run in held:
      if run.fromOrdinal <= from and run.throughOrdinal >= through:
        return null
  for run in held:
    delete runs[run]
  if low <= prefix + 1:
    prefix = max(prefix, high)
  else:
    require count(runs where .@GROUP@ = @GROUP@ and .principal = viewer) < 64 else RUNS_FULL
    insert runs { @GROUP@, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > me.deliveredOrdinal:
    update @MEMBERS@[me] { deliveredOrdinal: prefix }
  return null

mutation seen(@GROUP@: @SCOPE@, through: int):
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  chat = @SCOPE@[@GROUP@] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update @MEMBERS@[me] { seenOrdinal: through }
  return null
