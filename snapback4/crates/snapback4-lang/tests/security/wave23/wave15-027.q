-- Agility Trial Run Order: weekend trial, many classes and rings.
-- alice: secretary (builds run order, closes classes).
-- bob: handler who also scribes (runs his own dogs, records times/faults).
-- carol: judge (corrects scores with a logged reason).
use personas alice, bob, carol

-- One row per official. Handlers hold no row.
table staff:
  principal: principal
  role: enum('secretary', 'scribe', 'judge')
  unique principal, role
  read <- .principal = viewer
  online only

table classes:
  name: text 1..60
  ring: text 1..20
  status: enum('open', 'closed') default 'open'
  public 'the trial schedule is posted for every handler'
  insert <- exists staff[principal = viewer, role = 'secretary']
  update <- exists staff[principal = viewer, role = 'secretary']
  delete <- exists staff[principal = viewer, role = 'secretary']
  cap 50
  online only

table dogs:
  name: text 1..40
  breed: text <=40 ?
  owner: principal
  public 'run orders name every dog'
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  immutable owner
  cap 20 by owner
  online only

-- One row per run. dogName is copied at entry so the run order renders
-- without a join. Position is unique per class; the secretary reorders.
table entries:
  class: classes
  dog: dogs
  dogName: text 1..40
  handler: principal
  position: int 1..500
  state: enum('scheduled', 'running', 'done') default 'scheduled'
  public 'the posted run order is visible to every handler'
  unique class, position
  immutable class, dog, dogName, handler
  insert <- .handler = viewer
  update <- exists staff[principal = viewer, role = 'secretary'] or exists staff[principal = viewer, role = 'scribe']
  delete <- exists staff[principal = viewer, role = 'secretary']
  cap 500 by class
  online only

-- One score per run. A handler reads only their own scores until the class
-- closes; officials read everything.
table scores:
  entry: entries
  class: classes
  dog: dogs
  dogName: text 1..40
  handler: principal
  timeMillis: int 1..600000
  faults: int 0..50
  eliminated: bool default false
  unique entry
  immutable entry, class, dog, dogName, handler
  read <- .handler = viewer or exists staff[principal = viewer, role = 'secretary'] or exists staff[principal = viewer, role = 'scribe'] or exists staff[principal = viewer, role = 'judge'] or exists classes[.class, status = 'closed']
  insert <- exists staff[principal = viewer, role = 'scribe']
  update <- exists staff[principal = viewer, role = 'scribe'] or exists staff[principal = viewer, role = 'judge']
  delete <- deny
  cap 500 by class
  online only

-- Every judge correction is logged with its reason.
table corrections:
  entry: entries
  class: classes
  oldTime: int ?
  oldFaults: int ?
  newTime: int 1..600000
  newFaults: int 0..50
  reason: text 1..280
  judge: principal
  at: time default now
  read <- exists staff[principal = viewer, role = 'secretary'] or exists staff[principal = viewer, role = 'judge']
  insert <- exists staff[principal = viewer, role = 'judge']
  update <- deny
  delete <- deny
  cap 500 by class
  online only

query classesList(c: cursor ?):
  return classes first 50 by .id after c

query runOrder(classId: classes, c: cursor ?):
  return entries where .class = classId first 200 by .position after c

-- Live "how many dogs are ahead of me" for one run.
query aheadOf(entryId: entries):
  e = entries[entryId]
  return count(entries where .class = e.class and .position < e.position and .state != 'done') if e != null else 0

-- Full board for officials and once the class closes; otherwise your own.
query leaderboard(classId: classes, c: cursor ?):
  cl = classes[classId] ! else NOT_FOUND
  if cl.status = 'closed' or exists staff[principal = viewer, role = 'secretary'] or exists staff[principal = viewer, role = 'scribe'] or exists staff[principal = viewer, role = 'judge']:
    return scores where .class = classId first 500 by .id after c
  return scores where .class = classId and .handler = viewer first 500 by .id after c

query myScores(c: cursor ?):
  return scores where .handler = viewer first 200 by .id after c

query myDogs(c: cursor ?):
  return dogs where .owner = viewer first 100 by .id after c

query correctionsFor(entryId: entries, c: cursor ?):
  return corrections where .entry = entryId first 50 by .id after c

mutation createClass(name: text 1..60, ring: text 1..20):
  require exists staff[principal = viewer, role = 'secretary'] else NOT_SECRETARY 'Only the trial secretary creates classes.'
  return insert classes { name, ring }

mutation closeClass(classId: classes):
  require exists staff[principal = viewer, role = 'secretary'] else NOT_SECRETARY 'Only the trial secretary closes a class.'
  update classes[classId] { status: 'closed' }
  return null

mutation registerDog(name: text 1..40, breed: text <=40 ?):
  return insert dogs { name, breed, owner: viewer }

mutation enterRun(classId: classes, dogId: dogs):
  d = dogs[dogId] ! else NOT_FOUND
  require d.owner = viewer else NOT_YOUR_DOG 'Enter only your own dog.'
  cl = classes[classId] ! else NOT_FOUND
  require cl.status = 'open' else CLASS_CLOSED 'This class is closed to new entries.'
  return insert entries { class: classId, dog: dogId, dogName: d.name, handler: viewer, position: count(entries where .class = classId) + 1, state: 'scheduled' }

-- Secretary reorders. A swap parks the occupant on a free slot first:
-- each statement checks unique class, position, so two keys rotate through
-- a free value (the writes guide's swap pattern).
mutation setPosition(entryId: entries, position: int 1..500):
  require exists staff[principal = viewer, role = 'secretary'] else NOT_SECRETARY 'Only the trial secretary orders runs.'
  e = entries[entryId] ! else NOT_FOUND
  old = e.position
  other = entries[e.class, position]
  if other != null and other.id != e.id:
    free = 0
    for cand in range(1, 501):
      if free != 0:
        break
      if not exists entries[e.class, cand]:
        free = cand
    require free != 0 else CLASS_FULL 'The class is full; cannot reorder.'
    update other { position: free }
    update entries[entryId] { position }
    update other { position: old }
  if other = null or other.id = e.id:
    update entries[entryId] { position }
  return null

mutation startRun(entryId: entries):
  require exists staff[principal = viewer, role = 'scribe'] else NOT_SCRIBE 'Only the scribe runs the ring.'
  e = entries[entryId] ! else NOT_FOUND
  require e.state = 'scheduled' else BAD_STATE 'This run already started.'
  update entries[entryId] { state: 'running' }
  return null

mutation recordScore(entryId: entries, timeMillis: int 1..600000, faults: int 0..50, eliminated: bool):
  require exists staff[principal = viewer, role = 'scribe'] else NOT_SCRIBE 'Only the scribe records scores.'
  e = entries[entryId] ! else NOT_FOUND
  require e.state = 'running' else BAD_STATE 'Start the run before scoring it.'
  s = insert scores { entry: entryId, class: e.class, dog: e.dog, dogName: e.dogName, handler: e.handler, timeMillis, faults, eliminated }
  update entries[entryId] { state: 'done' }
  return s

mutation correctScore(entryId: entries, timeMillis: int 1..600000, faults: int 0..50, eliminated: bool, reason: text 1..280):
  require exists staff[principal = viewer, role = 'judge'] else NOT_JUDGE 'Only the judge corrects scores.'
  e = entries[entryId] ! else NOT_FOUND
  s = scores[entry = entryId] ! else NOT_FOUND
  update s { timeMillis, faults, eliminated }
  insert corrections { entry: entryId, class: e.class, oldTime: s.timeMillis, oldFaults: s.faults, newTime: timeMillis, newFaults: faults, reason, judge: viewer }
  return null
