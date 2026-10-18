-- Boiler Room Rounds: hourly gauge rounds with photo readings, chief alerts,
-- shift-scoped engineers, per-equipment contractors and manager compliance.
-- Real password authentication only; no development personas.
use identity password

table roles:
  principal: principal
  role: enum('engineer', 'chief', 'contractor', 'manager')
  unique principal
  immutable principal
  cap 50
  read <- .principal = viewer or exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  insert <- (.principal = viewer and .role != 'chief') or exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  online only

table shifts:
  label: text 1..40
  startsAt: time
  endsAt: time
  immutable label, startsAt, endsAt
  cap 100
  read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'manager'] or exists shiftMembers[.id, viewer]
  insert <- exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'chief']
  online only

table shiftMembers:
  shift: shifts
  engineer: principal
  unique shift, engineer
  immutable shift, engineer
  cap 500
  read <- .engineer = viewer or exists roles[viewer, role = 'chief']
  insert <- exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  delete <- exists roles[viewer, role = 'chief']
  online only

table gauges:
  name: text 1..80
  location: text 1..120
  minPressure: int 0..2000
  maxPressure: int 0..2000
  minTemp: int -50..300
  maxTemp: int -50..300
  cap 100
  read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or exists assignments[.id, viewer]
  insert <- exists roles[viewer, role = 'chief']
  update <- exists roles[viewer, role = 'chief']
  delete <- exists roles[viewer, role = 'chief']
  online only

table assignments:
  gauge: gauges
  contractor: principal
  unique gauge, contractor
  immutable gauge, contractor
  cap 500
  read <- .contractor = viewer or exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer']
  insert <- exists roles[viewer, role = 'chief']
  delete <- exists roles[viewer, role = 'chief']
  online only

table rounds:
  shift: shifts
  scheduledAt: time
  status: enum('scheduled', 'completed', 'missed') default 'scheduled'
  completedAt: time ?
  unique shift, scheduledAt else DOUBLE_BOOKED
  immutable shift, scheduledAt
  cap 2000
  read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'manager'] or exists shiftMembers[shift = .shift, engineer = viewer]
  insert <- exists roles[viewer, role = 'chief'] or viewer = 'service:ops'
  update <- exists shiftMembers[shift = .shift, engineer = viewer] or exists roles[viewer, role = 'chief']
  online only

table readings:
  round: rounds
  gauge: gauges
  shift: shifts
  engineer: principal
  pressure: int 0..2000
  temp: int -50..300
  photo: image <=5000000
  loggedAt: time default now
  unique round, gauge else DUPLICATE_READING
  immutable round, gauge, shift, engineer
  cap 20000
  read <- exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or exists assignments[.gauge, viewer]
  insert <- .engineer = viewer and exists shiftMembers[shift = .shift, engineer = viewer]
  online only

table alerts:
  kind: enum('missed', 'out-of-range')
  round: rounds
  gauge: gauges ?
  pressure: int ?
  temp: int ?
  message: text 1..300
  at: time default now
  acknowledged: bool default false
  immutable kind, round, gauge
  cap 5000
  read <- exists roles[viewer, role = 'chief']
  insert <- exists roles[viewer, role = 'engineer'] or exists roles[viewer, role = 'chief']
  update <- exists roles[viewer, role = 'chief']
  online only

view readingsCount: count readings by .round
  read <- exists roles[viewer, role = 'engineer'] or exists roles[viewer, role = 'chief']
  online only

query myRole():
  return roles[principal = viewer]

query roster(c: cursor ?):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  return roles first 50 by .id after c

query myShifts(c: cursor ?):
  return shifts where exists shiftMembers[.id, viewer] first 50 by .startsAt after c

query shiftsList(c: cursor ?):
  require exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'manager'] else NOT_ALLOWED
  return shifts first 50 by .startsAt after c

query shiftRounds(shift: shifts, c: cursor ?):
  s = shifts[shift] ! else NOT_FOUND
  require exists shiftMembers[shift = s.id, engineer = viewer] or exists roles[viewer, role = 'chief'] else NOT_SHIFT_MEMBER
  return rounds where .shift = s.id first 50 by .scheduledAt after c { id, shift, scheduledAt, status, completedAt }

query roundReadings(roundId: rounds, c: cursor ?):
  r = rounds[roundId] ! else NOT_FOUND
  require exists shiftMembers[shift = r.shift, engineer = viewer] or exists roles[viewer, role = 'chief'] else NOT_SHIFT_MEMBER
  return readings where .round = r.id first 100 by .loggedAt after c

query gaugeHistory(gaugeId: gauges, c: cursor ?):
  g = gauges[gaugeId] ! else NOT_FOUND
  return readings where .gauge = g.id last 50 by .loggedAt after c

query gaugesList(c: cursor ?):
  if exists roles[viewer, role = 'contractor']:
    return gauges where exists assignments[.id, viewer] first 50 by .id after c
  return gauges first 50 by .id after c

query myAssignments(c: cursor ?):
  return assignments where .contractor = viewer first 50 by .id after c

query gaugeAssignments(gaugeId: gauges, c: cursor ?):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  g = gauges[gaugeId] ! else NOT_FOUND
  return assignments where .gauge = g.id first 50 by .id after c

query shiftMembersOf(shift: shifts, c: cursor ?):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  return shiftMembers where .shift = shift first 50 by .id after c

query compliance(from: time, to: time, c: cursor ?):
  require exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'manager'] else NOT_ALLOWED
  return rounds where .scheduledAt >= from and .scheduledAt < to first 100 by .scheduledAt after c { id, shift: shifts[.shift], scheduledAt, status, completedAt }

query alertsInbox(c: cursor ?):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  return alerts last 50 by .at after c

mutation joinAs(role: enum('engineer', 'chief', 'contractor', 'manager')):
  require role != 'chief' else CHIEF_BY_INVITE 'Chief accounts are created by another chief.'
  me = roles[viewer]
  require me = null else ALREADY_JOINED 'This account already has a role.'
  return insert roles { principal: viewer, role }

mutation assignRole(who: principal, role: enum('engineer', 'chief', 'contractor', 'manager')):
  require exists roles[viewer, role = 'chief'] or viewer = 'service:ops' else NOT_CHIEF
  return upsert roles[who] { role }

mutation addGauge(name: text 1..80, location: text 1..120, minPressure: int 0..2000, maxPressure: int 0..2000, minTemp: int -50..300, maxTemp: int -50..300):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  require minPressure < maxPressure else BAD_LIMITS 'Min pressure must be below max pressure.'
  require minTemp < maxTemp else BAD_LIMITS 'Min temperature must be below max temperature.'
  return insert gauges { name, location, minPressure, maxPressure, minTemp, maxTemp }

mutation setLimits(gaugeId: gauges, minPressure: int 0..2000, maxPressure: int 0..2000, minTemp: int -50..300, maxTemp: int -50..300):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  g = gauges[gaugeId] ! else NOT_FOUND
  require minPressure < maxPressure else BAD_LIMITS 'Min pressure must be below max pressure.'
  require minTemp < maxTemp else BAD_LIMITS 'Min temperature must be below max temperature.'
  update gauges[gaugeId] { minPressure, maxPressure, minTemp, maxTemp }
  return null

mutation assignContractor(gaugeId: gauges, contractor: principal):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  g = gauges[gaugeId] ! else NOT_FOUND
  c = roles[contractor]
  require c != null and c.role = 'contractor' else NOT_CONTRACTOR 'That account is not a contractor.'
  require not exists assignments[gauge = g.id, contractor = contractor] else ALREADY_ASSIGNED 'That contractor already services this gauge.'
  return insert assignments { gauge: g.id, contractor }

mutation unassignContractor(gaugeId: gauges, contractor: principal):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  g = gauges[gaugeId] ! else NOT_FOUND
  a = assignments[g.id, contractor] ! else NOT_ASSIGNED
  delete assignments[a.id]
  return null

mutation createShift(label: text 1..40, startsAt: time, endsAt: time):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  require startsAt < endsAt else BAD_SHIFT 'A shift must end after it starts.'
  return insert shifts { label, startsAt, endsAt }

mutation addShiftMember(shiftId: shifts, engineer: principal):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  s = shifts[shiftId] ! else NOT_FOUND
  e = roles[engineer]
  require e != null and e.role = 'engineer' else NOT_ENGINEER 'That account is not an engineer.'
  require not exists shiftMembers[shift = s.id, engineer = engineer] else ALREADY_MEMBER 'That engineer is already on this shift.'
  return insert shiftMembers { shift: s.id, engineer }

mutation scheduleRound(shiftId: shifts, scheduledAt: time):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  s = shifts[shiftId] ! else NOT_FOUND
  require scheduledAt >= s.startsAt and scheduledAt < s.endsAt else OFF_SHIFT 'Rounds must fall inside the shift.'
  return insert rounds { shift: s.id, scheduledAt }

mutation logReading(roundId: rounds, gaugeId: gauges, pressure: int 0..2000, temp: int -50..300, photo: image <=5000000):
  r = rounds[roundId] ! else NOT_FOUND
  g = gauges[gaugeId] ! else NOT_FOUND
  require exists shiftMembers[shift = r.shift, engineer = viewer] else NOT_SHIFT_MEMBER 'This round belongs to another shift.'
  require r.status = 'scheduled' else ROUND_DONE 'This round is already closed.'
  require r.scheduledAt - 15m <= now and now <= r.scheduledAt + 2h else ROUND_CLOSED 'Readings are accepted from 15 minutes before the hour until 2 hours after.'
  reading = insert readings { round: r.id, gauge: g.id, shift: r.shift, engineer: viewer, pressure, temp, photo }
  if pressure < g.minPressure or pressure > g.maxPressure or temp < g.minTemp or temp > g.maxTemp:
    insert alerts { kind: 'out-of-range', round: r.id, gauge: g.id, pressure, temp, message: 'A reading fell outside the gauge limits.' }
  return reading

mutation completeRound(roundId: rounds):
  r = rounds[roundId] ! else NOT_FOUND
  require exists shiftMembers[shift = r.shift, engineer = viewer] else NOT_SHIFT_MEMBER 'This round belongs to another shift.'
  require r.status = 'scheduled' else ROUND_DONE 'This round is already closed.'
  require (readingsCount[roundId] ?? 0) > 0 else NO_READINGS 'Log at least one gauge reading first.'
  update rounds[roundId] { status: 'completed', completedAt: now }
  return null

mutation acknowledgeAlert(alertId: alerts):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  a = alerts[alertId] ! else NOT_FOUND
  update alerts[alertId] { acknowledged: true }
  return null

job markMissed(periodStart: time, periodEnd: time):
  for r in rounds by .scheduledAt:
    if r.status = 'scheduled' and r.scheduledAt + 2h < periodEnd:
      update rounds[r.id] { status: 'missed' }
      insert alerts { kind: 'missed', round: r.id, message: 'Round missed: no readings were logged in time.' }

schedule missSweep every 1h: markMissed
