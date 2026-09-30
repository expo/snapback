-- @ref LLP 3000.022#14 — compiler-owned recipe, executed by the ordinary metered interpreter.
table @RUNS@:
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
  sync to @MEMBERS@[.@GROUP@] by .@PRINCIPAL@


fn @RECEIPT@(m: @MESSAGES@):
  state = 'read'
  remaining = 0
  for member in @MEMBERS@ where .@MEMBER_GROUP@ = m.@GROUP@:
    if member.@PRINCIPAL@ != m.@SENDER@ and member.@FLOOR@ < m.@POSITION@:
      remaining = remaining + 1
      if m.@POSITION@ > member.@DELIVERED_FIELD@:
        run = first(@RUNS@[@GROUP@ = m.@GROUP@, principal = member.@PRINCIPAL@, fromOrdinal <= m.@POSITION@] last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.@POSITION@:
          return 'sent'
      if member.@SEEN_FIELD@ < m.@POSITION@:
        state = 'delivered'
  return state if remaining > 0 or m.@COUNT@ > 0 else 'sent'


query @MEMBER@(@GROUP@: @SCOPE@):
  return @MEMBERS@[@GROUP@, viewer]

query @PROGRESS@(@GROUP@: @SCOPE@, c: cursor ?):
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  delivered = max(me.@DELIVERED_FIELD@, me.@FLOOR@)
  return { member: me, runs: @RUNS@ where .@GROUP@ = @GROUP@ and .principal = viewer, ahead: @MESSAGES@ where .@GROUP@ = @GROUP@ and .@POSITION@ > delivered and .@POSITION@ <= delivered + 100 last 100 by .@POSITION@ after c }


mutation @DELIVERED@(@GROUP@: @SCOPE@, from: int, through: int)
  reports delivery of @MESSAGES@ by .@GROUP@, .@POSITION@: server
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  chat = @SCOPE@[@GROUP@] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.@COUNTER@ else PAST_LAST_MESSAGE
  prefix = max(me.@DELIVERED_FIELD@, me.@FLOOR@)
  low = from
  high = through
  all = @RUNS@ where .@GROUP@ = @GROUP@ and .principal = viewer first 64 by .fromOrdinal
  for run in all:
    if run.fromOrdinal <= high + 1 and run.throughOrdinal + 1 >= low:
      low = min(low, run.fromOrdinal)
      high = max(high, run.throughOrdinal)
  prefix = @FOLD@(@GROUP@, prefix, low, high)
  covered = through <= prefix
  remaining = 0
  for run in all:
    if run.throughOrdinal <= prefix or (run.fromOrdinal <= high + 1 and run.throughOrdinal + 1 >= low):
      if run.throughOrdinal > prefix and run.fromOrdinal <= from and run.throughOrdinal >= through:
        covered = true
      else:
        delete @RUNS@[run]
    else:
      remaining = remaining + 1
  if not covered:
    require remaining < 64 else RUNS_FULL
    insert @RUNS@ { @GROUP@, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > max(me.@DELIVERED_FIELD@, me.@FLOOR@):
    update @MEMBERS@[me] { @DELIVERED_FIELD@: prefix }
  return null

-- The maintenance transaction can commit partial progress even at the run cap.
mutation @COMPACT@(@GROUP@: @SCOPE@): server
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  chat = @SCOPE@[@GROUP@] ! else NOT_FOUND
  initial = max(me.@DELIVERED_FIELD@, me.@FLOOR@)
  prefix = @FOLD@(@GROUP@, initial, chat.@COUNTER@ + 1, chat.@COUNTER@)
  for run in @RUNS@ where .@GROUP@ = @GROUP@ and .principal = viewer:
    if run.throughOrdinal <= prefix:
      delete @RUNS@[run]
  if prefix > max(me.@DELIVERED_FIELD@, me.@FLOOR@):
    update @MEMBERS@[me] { @DELIVERED_FIELD@: prefix }
  return prefix > initial

-- At most 1024 unique message probes, shared across all 64 runs and the input.
fn @FOLD@(@GROUP@: @SCOPE@, initial: int, low: int, high: int):
  prefix = initial
  probes = 0
  for run in @RUNS@ where .@GROUP@ = @GROUP@ and .principal = viewer first 64 by .fromOrdinal:
    for i in range(0, 1024):
      if low <= prefix + 1:
        prefix = max(prefix, high)
      if prefix + 1 >= run.fromOrdinal or probes >= 1024:
        break
      probes = probes + 1
      if exists @MESSAGES@[@GROUP@ = @GROUP@, @POSITION@ = prefix + 1]:
        return prefix
      prefix = prefix + 1
    if run.fromOrdinal <= prefix + 1:
      prefix = max(prefix, run.throughOrdinal)
    else:
      return prefix
  for i in range(0, 1024):
    if prefix + 1 >= low or probes >= 1024:
      break
    probes = probes + 1
    if exists @MESSAGES@[@GROUP@ = @GROUP@, @POSITION@ = prefix + 1]:
      return prefix
    prefix = prefix + 1
  if low <= prefix + 1:
    prefix = max(prefix, high)
  return prefix

mutation @SEEN@(@GROUP@: @SCOPE@, through: int):
  me = @MEMBERS@[@GROUP@, viewer] ! else NOT_MEMBER
  chat = @SCOPE@[@GROUP@] ! else NOT_FOUND
  require through <= chat.@COUNTER@ else PAST_LAST_MESSAGE
  if through > me.@SEEN_FIELD@:
    update @MEMBERS@[me] { @SEEN_FIELD@: through }
  return null
