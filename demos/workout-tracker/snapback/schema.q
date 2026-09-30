use server
use identity
use personas demo

-- @ref LLP 3000#2-the-bet-on-one-page — each guest receives a bounded local partition.
table workouts:
  owner: principal
  title: text 1..80
  startedAt: time default now
  finishedAt: time ?
  by byOwnerStarted: owner, startedAt, id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- deny
  immutable owner, startedAt
  sync to .owner last 200 by byOwnerStarted

table sets:
  owner: principal
  workoutId: workouts
  exercise: text 1..80
  reps: int
  weightKgX10: int
  completed: bool default false
  at: time default now
  by byWorkoutOwner: workoutId, owner, id
  by byOwnerAt: owner, at, id
  read <- .owner = viewer
  insert <- .owner = viewer and exists workouts[id = .workoutId, owner = viewer]
  update <- .owner = viewer
  delete <- .owner = viewer
  immutable owner, workoutId, at
  sync to .owner

query myWorkouts():
  return workouts where .owner = viewer last 100 by byOwnerStarted

query mySets():
  return sets where .owner = viewer last 1000 by byOwnerAt

mutation createWorkout(title: text 1..80):
  row = insert workouts { owner: viewer, title }
  return { id: row.id }

mutation addSet(workoutId: workouts, exercise: text 1..80, reps: int, weightKgX10: int):
  require reps > 0 and reps <= 1000 and weightKgX10 >= 0 else INVALID_SET
  require exists workouts[id = workoutId, owner = viewer] else NOT_OWNER
  row = insert sets { owner: viewer, workoutId, exercise, reps, weightKgX10 }
  return { id: row.id }

mutation setCompleted(setId: sets, completed: bool):
  row = sets[setId] ! else NOT_FOUND
  require row.owner = viewer else NOT_OWNER
  update sets[row] { completed }
  return null

mutation removeSet(setId: sets):
  row = sets[setId] ! else NOT_FOUND
  require row.owner = viewer else NOT_OWNER
  delete sets[row]
  return null

mutation finishWorkout(workoutId: workouts):
  row = workouts[workoutId] ! else NOT_FOUND
  require row.owner = viewer else NOT_OWNER
  update workouts[row] { finishedAt: now }
  return null
