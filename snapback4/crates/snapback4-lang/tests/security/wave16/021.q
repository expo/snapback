-- Moot Court Scoring.
-- Roles: tournament directors, judges, coaches, students (team members).
-- Every privacy rule below is a backend row rule or a role-gated query, never
-- UI-only. All tables are online only: scoring is staff-operated and online.
use identity password

-- One tournament row carries the brief deadline. Its creator becomes the
-- first director (see createTournament + the directors insert rule).
table tournaments:
  code: text 1..40
  name: text 1..120
  briefDeadline: time
  director: principal
  immutable code
  unique code
  read <- exists directors[viewer] or exists judges[viewer] or exists coaches[viewer] or exists members[viewer]
  insert <- .director = viewer
  update <- exists directors[viewer]
  online only

-- Director roster. Bootstrap: the mutation that creates a tournament also
-- inserts its creator here (created-probe arm). Afterwards only directors
-- can add directors.
table directors:
  tournament: tournaments
  principal: principal
  immutable tournament, principal
  unique principal
  read <- .principal = viewer
  insert <- exists directors[viewer] or created tournaments[.tournament]
  delete <- exists directors[viewer]
  online only

table judges:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

table coaches:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

-- Team membership doubles as the student roster: a student is a member.
-- Composite key so rule probes can pin (team, student) positionally.
table members:
  team: teams
  student: principal
  immutable team, student
  unique team, student
  unique student
  read <- .student = viewer or exists teams[.team, coach = viewer] or exists directors[viewer]
  insert <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

-- Bracket assignment and disqualification live here; only directors write.
table teams:
  name: text 1..80
  coach: principal ?
  bracket: text 1..80
  disqualified: bool default false
  immutable name
  unique name
  read <- exists directors[viewer] or exists judges[viewer] or exists coaches[viewer] or exists members[viewer]
  insert <- exists directors[viewer]
  update <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

table rounds:
  name: text 1..80
  status: enum('open', 'closed')
  bracket: text 1..80
  immutable name
  unique name
  read <- exists directors[viewer] or exists judges[viewer] or exists coaches[viewer] or exists members[viewer]
  insert <- exists directors[viewer]
  update <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

table roundTeams:
  round: rounds
  team: teams
  immutable round, team
  unique round, team
  read <- exists directors[viewer] or exists judges[viewer] or exists coaches[viewer] or exists members[viewer]
  insert <- exists directors[viewer]
  delete <- exists directors[viewer]
  online only

-- Written briefs. Uploads/edits lock at the tournament brief deadline.
-- Readers: own-team students, the team's coach, judges, directors.
table briefs:
  team: teams
  title: text 1..120
  body: text 1..20000
  uploader: principal
  uploadedAt: time default now
  immutable team, uploader
  unique team
  read <- exists directors[viewer] or exists judges[viewer] or exists members[.team, viewer] or exists teams[.team, coach = viewer]
  insert <- exists members[.team, viewer]
  update <- exists members[.team, viewer]
  online only

-- Oral-argument scores. A judge always reads their own rows; everyone else
-- (other judges, students of the team, the team's coach) reads a row only
-- after its round closes. Directors read everything.
table scores:
  round: rounds
  team: teams
  judge: principal
  argument: int 1..10
  presence: int 1..10
  comment: text <=2000
  immutable round, team, judge
  unique round, team, judge
  read <- .judge = viewer or exists directors[viewer] or (exists rounds[.round, status = 'closed'] and (exists judges[viewer] or exists members[.team, viewer] or exists teams[.team, coach = viewer]))
  insert <- .judge = viewer and exists judges[viewer]
  update <- .judge = viewer and exists judges[viewer]
  delete <- exists directors[viewer]
  online only

-- Public directory so a director can discover a new user's principal in the
-- UI in order to grant them a role. (Acceptance reads principals from the
-- signup session instead.)
table profiles:
  owner: principal
  name: text 1..80
  immutable owner
  unique owner
  read <- exists directors[viewer] or exists judges[viewer] or exists coaches[viewer] or exists members[viewer]
  insert <- .owner = viewer
  update <- .owner = viewer
  online only

-- Identity and role introspection.
query whoAmI():
  return viewer

query myRoles():
  return { director: exists directors[viewer], judge: exists judges[viewer], coach: exists coaches[viewer], student: exists members[viewer] }

query myTeams(c: cursor ?):
  return members where .student = viewer first 50 by .id after c { id, team }

-- Listings (row rules already restrict these to signed-in role holders).
query tournamentsList(c: cursor ?):
  return tournaments first 50 by .id after c

query teamsList(c: cursor ?):
  return teams first 50 by .id after c

query roundsList(c: cursor ?):
  return rounds first 50 by .id after c

query roundTeamsList(round: rounds, c: cursor ?):
  return roundTeams where .round = round first 50 by .id after c

query profilesList(c: cursor ?):
  require exists directors[viewer] else NOT_DIRECTOR
  return profiles first 50 by .id after c

query teamDetail(team: teams):
  return teams[team]

query tournamentDetail(tournament: tournaments):
  return tournaments[tournament]

query roundDetail(round: rounds):
  return rounds[round]

-- Briefs.
query briefFor(team: teams):
  return briefs[team = team]

-- Scores. Students get numbers only (no judges' comments); coaches, judges
-- (after close, via the row rule) and directors get comments too.
query studentScores(team: teams, c: cursor ?):
  require exists members[team, viewer] else NOT_ON_TEAM
  return scores where .team = team first 50 by .id after c { id, round, judge, argument, presence }

query coachScores(team: teams, c: cursor ?):
  t = teams[team] ! else NOT_FOUND
  require t.coach = viewer or exists directors[viewer] else NOT_YOUR_TEAM
  return scores where .team = team first 50 by .id after c { id, round, judge, argument, presence, comment }

query judgeScores(team: teams, c: cursor ?):
  require exists judges[viewer] else NOT_JUDGE
  return scores where .team = team first 50 by .id after c { id, round, judge, argument, presence, comment }

query directorScores(team: teams, c: cursor ?):
  require exists directors[viewer] else NOT_DIRECTOR
  return scores where .team = team first 50 by .id after c { id, round, judge, argument, presence, comment }

-- Point lookup without the judges' comment, so it is safe for students of the
-- team (row rule still hides other teams' and open-round rows: null there).
query scoreDetail(score: scores):
  return scores[score] { id, round, team, judge, argument, presence }

-- Tournament setup (directors only, except tournament creation which makes
-- the caller the first director).
mutation createTournament(code: text 1..40, name: text 1..120, briefDeadline: time):
  t = insert tournaments { code, name, briefDeadline, director: viewer }
  insert directors { tournament: t.id, principal: viewer }
  return t

mutation grantDirector(tournament: tournaments, who: principal):
  require exists directors[viewer] else NOT_DIRECTOR
  t = tournaments[tournament] ! else NOT_FOUND
  require t.briefDeadline > 0 else NOT_FOUND
  return insert directors { tournament, principal: who }

mutation grantJudge(who: principal):
  require exists directors[viewer] else NOT_DIRECTOR
  return insert judges { principal: who }

mutation grantCoach(who: principal):
  require exists directors[viewer] else NOT_DIRECTOR
  return insert coaches { principal: who }

mutation addMember(team: teams, who: principal):
  require exists directors[viewer] else NOT_DIRECTOR
  tm = teams[team] ! else NOT_FOUND
  require not tm.disqualified else DISQUALIFIED
  return insert members { team, student: who }

mutation register(name: text 1..80):
  return insert profiles { owner: viewer, name }

mutation createTeam(name: text 1..80, bracket: text 1..80, coach: principal ?):
  require exists directors[viewer] else NOT_DIRECTOR
  return insert teams { name, bracket, coach }

mutation setBracket(team: teams, bracket: text 1..80):
  require exists directors[viewer] else NOT_DIRECTOR
  update teams[team] { bracket }
  return null

mutation disqualifyTeam(team: teams, disqualified: bool):
  require exists directors[viewer] else NOT_DIRECTOR
  update teams[team] { disqualified }
  return null

mutation createRound(name: text 1..80, bracket: text 1..80):
  require exists directors[viewer] else NOT_DIRECTOR
  return insert rounds { name, status: 'open', bracket }

mutation addTeamToRound(round: rounds, team: teams):
  require exists directors[viewer] else NOT_DIRECTOR
  r = rounds[round] ! else NOT_FOUND
  require r.status = 'open' else ROUND_CLOSED
  tm = teams[team] ! else NOT_FOUND
  require not tm.disqualified else DISQUALIFIED
  return insert roundTeams { round, team }

mutation closeRound(round: rounds):
  require exists directors[viewer] else NOT_DIRECTOR
  update rounds[round] { status: 'closed' }
  return null

-- Briefs: own-team students only, before the deadline.
mutation uploadBrief(tournament: tournaments, team: teams, title: text 1..120, body: text 1..20000):
  t = tournaments[tournament] ! else NOT_FOUND
  require now < t.briefDeadline else BRIEF_LOCKED
  tm = teams[team] ! else NOT_FOUND
  require not tm.disqualified else DISQUALIFIED
  require exists members[team, viewer] else NOT_ON_TEAM
  return insert briefs { team, title, body, uploader: viewer }

mutation updateBrief(tournament: tournaments, team: teams, title: text 1..120, body: text 1..20000):
  t = tournaments[tournament] ! else NOT_FOUND
  require now < t.briefDeadline else BRIEF_LOCKED
  b = briefs[team = team] ! else NOT_FOUND
  update briefs[b.id] { title, body }
  return null

-- Live scoring: judges only, while the round is open, for entered teams.
mutation submitScore(round: rounds, team: teams, argument: int 1..10, presence: int 1..10, comment: text <=2000):
  require exists judges[viewer] else NOT_JUDGE
  r = rounds[round] ! else NOT_FOUND
  require r.status = 'open' else ROUND_CLOSED
  tm = teams[team] ! else NOT_FOUND
  require not tm.disqualified else DISQUALIFIED
  require exists roundTeams[round, team] else NOT_IN_ROUND
  return insert scores { round, team, judge: viewer, argument, presence, comment }

mutation updateScore(score: scores, argument: int 1..10, presence: int 1..10, comment: text <=2000):
  s = scores[score] ! else NOT_FOUND
  require s.judge = viewer else NOT_YOUR_SCORE
  r = rounds[s.round] ! else NOT_FOUND
  require r.status = 'open' else ROUND_CLOSED
  update scores[score] { argument, presence, comment }
  return null
