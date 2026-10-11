use personas coach, alice, bob

table coaches:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- exists coaches[principal = viewer]
  delete <- .principal = viewer
  online only

table plans:
  athlete: principal
  title: text 1..120
  weekStart: time
  targetKm: decimal 2
  note: text <=500 ?
  immutable athlete
  read <- .athlete = viewer or exists coaches[principal = viewer]
  insert <- exists coaches[principal = viewer]
  update <- exists coaches[principal = viewer]
  delete <- exists coaches[principal = viewer]
  online only

table runLogs:
  plan: plans
  athlete: principal
  loggedAt: time default now
  actualKm: decimal 2
  durationMin: int ?
  note: text <=280 ?
  immutable plan, athlete
  read through .plan
  insert <- .athlete = viewer
  update <- .athlete = viewer
  delete <- .athlete = viewer
  online only

query myPlans(c: cursor ?):
  return plans where .athlete = viewer first 50 by .weekStart after c

query athletePlans(athlete: principal, c: cursor ?):
  return plans where .athlete = athlete first 50 by .weekStart after c

query planRuns(plan: plans, c: cursor ?):
  return runLogs where .plan = plan first 50 by .id after c

query myRuns(c: cursor ?):
  return runLogs where .athlete = viewer first 50 by .loggedAt after c

query compliance(plan: plans):
  return count(runLogs where .plan = plan)

query coachOverview(c: cursor ?):
  return plans first 50 by .weekStart after c

mutation assignPlan(athlete: principal, title: text 1..120, weekStart: time, targetKm: decimal 2, note: text <=500 ?):
  return insert plans { athlete, title, weekStart, targetKm, note }

mutation logRun(plan: plans, actualKm: decimal 2, durationMin: int ?, note: text <=280 ?):
  p = plans[plan] ! else NOT_FOUND
  require p.athlete = viewer else NOT_YOUR_PLAN
  return insert runLogs { plan, athlete: viewer, actualKm, durationMin, note }
