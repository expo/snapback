-- A separate runnable recipe, not additions to your application's schema.
-- Bare identity keeps guest signup and password accounts; password-only removes guests.
use identity
use personas alice, bob

table teams:
  title: text 1..80
  creator: principal
  read <- exists members[teamId = .id, principal = viewer]
  insert <- .creator = viewer
  update <- deny
  delete <- deny
  after insert <- exists members[teamId = .id, principal = .creator, role = 'admin']
  sync

table members:
  teamId: teams
  principal: principal
  role: enum('member', 'admin')
  unique byTeamPrincipal: teamId, principal
  cap 100 by teamId
  immutable teamId, principal
  read <- exists members[teamId = .teamId, principal = viewer]
  insert <- (.principal = viewer and .role = 'admin' and created teams[.teamId]) or exists members[teamId = .teamId, principal = viewer, role = 'admin']
  update <- deny
  delete <- deny
  sync

query myTeams(c: cursor ?):
  return members where .principal = viewer after c first 100 by .id

query myRole(teamId: teams):
  require exists members[teamId = teamId, principal = viewer] else NOT_MEMBER
  return members[teamId = teamId, principal = viewer]

query roster(teamId: teams, c: cursor ?):
  require exists members[teamId = teamId, principal = viewer] else NOT_MEMBER
  return members where .teamId = teamId after c first 100 by .id

mutation createTeam(title: text 1..80):
  team = insert teams { title, creator: viewer }
  insert members { teamId: team.id, principal: viewer, role: 'admin' }
  return team

mutation invite(teamId: teams, principal: principal, role: enum('member', 'admin')):
  require exists members[teamId = teamId, principal = viewer, role = 'admin'] else NOT_ADMIN
  team = teams[teamId] ! else NOT_FOUND
  return insert members { teamId, principal, role } if absent
