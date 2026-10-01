-- @ref LLP 3000.022#14 — compiler-owned recipe, executed by the ordinary metered interpreter.
table @RUNS@:
  @RUN_GROUP@: @SCOPE@
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique @RUN_GROUP@, principal, fromOrdinal
  cap 64 by @RUN_GROUP@, principal
  cap 3200 by @RUN_GROUP@
  read <- exists @MEMBERS@[@MEMBER_GROUP@ = .@RUN_GROUP@, @PRINCIPAL@ = viewer]
  insert <- .principal = viewer and exists @MEMBERS@[@MEMBER_GROUP@ = .@RUN_GROUP@, @PRINCIPAL@ = viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to @MEMBERS@[.@RUN_GROUP@] by .@PRINCIPAL@

fn @RECEIPT@($m: @MESSAGES@):
  if not receiptBuiltinSettled($m):
    return null
  $state = 'read'
  $remaining = 0
  for $member in @MEMBERS@ where .@MEMBER_GROUP@ = $m.@GROUP@:
    if receiptBuiltinSettled($member) and $member.@PRINCIPAL@ != $m.@SENDER@ and $member.@FLOOR@ < $m.@POSITION@:
      $remaining = $remaining + 1
      if $m.@POSITION@ > $member.@DELIVERED_FIELD@:
        $run = receiptBuiltinFirst(@RUNS@[@RUN_GROUP@ = $m.@GROUP@, principal = $member.@PRINCIPAL@, fromOrdinal <= $m.@POSITION@] last 1 by .fromOrdinal)
        if $run = null or $run.throughOrdinal < $m.@POSITION@:
          return 'sent'
      if $member.@SEEN_FIELD@ < $m.@POSITION@:
        $state = 'delivered'
  return $state if $remaining > 0 or $m.@COUNT@ > 0 else 'sent'

query @MEMBER@(@ARG@: @SCOPE@):
  $me = @MEMBERS@[@MEMBER_GROUP@ = @ARG@, @PRINCIPAL@ = viewer]
  return $me if $me != null and receiptBuiltinSettled($me) else null

query @PROGRESS@(@ARG@: @SCOPE@, @CURSOR@: cursor ?):
  $me = @MEMBERS@[@MEMBER_GROUP@ = @ARG@, @PRINCIPAL@ = viewer] ! else NOT_MEMBER
  if not receiptBuiltinSettled($me):
    return null
  $delivered = receiptBuiltinMax($me.@DELIVERED_FIELD@, $me.@FLOOR@)
  return { member: $me, runs: @RUNS@ where .@RUN_GROUP@ = @ARG@ and .principal = viewer, ahead: @MESSAGES@ where .@GROUP@ = @ARG@ and .@POSITION@ > $delivered and .@POSITION@ <= $delivered + 100 and receiptBuiltinSettled(.) last 100 by .@POSITION@ after @CURSOR@ }

mutation @DELIVERED@(@ARG@: @SCOPE@, @FROM@: int, @THROUGH@: int)
  reports delivery of @MESSAGES@ by .@GROUP@, .@POSITION@: server
  $me = @MEMBERS@[@MEMBER_GROUP@ = @ARG@, @PRINCIPAL@ = viewer] ! else NOT_MEMBER
  $chat = @SCOPE@[id = @ARG@] ! else NOT_FOUND
  require 0 < @FROM@ and @FROM@ <= @THROUGH@ else NOT_A_RUN
  require @THROUGH@ <= $chat.@COUNTER@ else PAST_LAST_MESSAGE
  $initial = receiptBuiltinMax($me.@DELIVERED_FIELD@, $me.@FLOOR@)
  $folded = @FOLD@(@ARG@, $initial, @FROM@, @THROUGH@)
  if $folded.prefix > $initial:
    update @MEMBERS@[$me] { @DELIVERED_FIELD@: $folded.prefix }
  return null

-- Maintenance commits partial progress without acknowledging any new live position.
mutation @COMPACT@(@ARG@: @SCOPE@): server
  $me = @MEMBERS@[@MEMBER_GROUP@ = @ARG@, @PRINCIPAL@ = viewer] ! else NOT_MEMBER
  $chat = @SCOPE@[id = @ARG@] ! else NOT_FOUND
  $initial = receiptBuiltinMax($me.@DELIVERED_FIELD@, $me.@FLOOR@)
  $folded = @FOLD@(@ARG@, $initial, $chat.@COUNTER@ + 1, $chat.@COUNTER@)
  if $folded.prefix > $initial:
    update @MEMBERS@[$me] { @DELIVERED_FIELD@: $folded.prefix }
  return $folded.changed or $folded.prefix > $initial

-- Normalize at most 65 sorted intervals with one shared 1024-position allowance.
-- A live blocker ends one interval; later intervals still get their own turn.
fn @FOLD@(@ARG@: @SCOPE@, $initial: int, $low: int, $high: int):
  $all = @RUNS@ where .@RUN_GROUP@ = @ARG@ and .principal = viewer first 64 by .fromOrdinal
  $ordered = []
  $added = false
  for $run in $all:
    if not $added and $low < $run.fromOrdinal:
      $ordered = $ordered + [{ low: $low, high: $high }]
      $added = true
    $ordered = $ordered + [{ low: $run.fromOrdinal, high: $run.throughOrdinal }]
  if not $added:
    $ordered = $ordered + [{ low: $low, high: $high }]
  $start = 0
  $end = $initial
  $prefix = $initial
  $probes = 0
  $merged = []
  for $interval in $ordered:
    for $i in receiptBuiltinRange(0, 1024):
      if $end + 1 >= $interval.low or $probes >= 1024:
        break
      $probes = $probes + 1
      if exists @MESSAGES@[@GROUP@ = @ARG@, @POSITION@ = $end + 1]:
        break
      $end = $end + 1
    if $end + 1 >= $interval.low:
      $end = receiptBuiltinMax($end, $interval.high)
    else:
      if $start = 0:
        $prefix = $end
      else:
        $merged = $merged + [{ low: $start, high: $end }]
      $start = $interval.low
      $end = $interval.high
  if $start = 0:
    $prefix = $end
  else:
    if $start <= $end:
      $merged = $merged + [{ low: $start, high: $end }]
  require receiptBuiltinCount($merged) <= 64 else RUNS_FULL
  -- Reuse each surviving start's row; only the input can add a new start.
  $changed = false
  $newHigh = $low - 1
  for $interval in $merged:
    if $interval.low = $low:
      $newHigh = $interval.high
  for $run in $all:
    $end = $run.fromOrdinal - 1
    for $interval in $merged:
      if $interval.low = $run.fromOrdinal:
        $end = $interval.high
    if $run.fromOrdinal = $low:
      $newHigh = $low - 1
    if $end < $run.fromOrdinal:
      delete @RUNS@[$run]
      $changed = true
    else:
      if $end != $run.throughOrdinal:
        update @RUNS@[$run] { throughOrdinal: $end }
        $changed = true
  if $newHigh >= $low:
    insert @RUNS@ { @RUN_GROUP@: @ARG@, principal: viewer, fromOrdinal: $low, throughOrdinal: $newHigh }
    $changed = true
  return { prefix: $prefix, changed: $changed }

mutation @SEEN@(@ARG@: @SCOPE@, @THROUGH@: int): server
  $me = @MEMBERS@[@MEMBER_GROUP@ = @ARG@, @PRINCIPAL@ = viewer] ! else NOT_MEMBER
  $chat = @SCOPE@[id = @ARG@] ! else NOT_FOUND
  require @THROUGH@ <= $chat.@COUNTER@ else PAST_LAST_MESSAGE
  if @THROUGH@ > $me.@SEEN_FIELD@:
    update @MEMBERS@[$me] { @SEEN_FIELD@: @THROUGH@ }
  return null
