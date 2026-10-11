-- Mini Bug Tracker: projects with members; issues with status, priority,
-- assignee, labels and comments; only members see a project's issues;
-- an event log per issue.
use personas alice, bob, carol

table projects:
  name: text 1..80
  description: text <=500 ?
  creator: principal
  createdAt: time default now
  read <- exists projectMembers[.id, viewer]
  insert <- .creator = viewer
  update <- exists projectMembers[.id, viewer, role = 'admin']
  delete <- exists projectMembers[.id, viewer, role = 'admin']
  after insert <- exists projectMembers[project = .id, principal = .creator, role = 'admin']
  sync to projectMembers[.id]

table projectMembers:
  project: projects
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time default now
  unique project, principal else MEMBER_EXISTS
  cap 100 by project
  immutable project, principal
  read <- exists projectMembers[.project, viewer]
  insert <- created projects[.project] or exists projectMembers[.project, viewer, role = 'admin']
  update <- exists projectMembers[.project, viewer, role = 'admin']
  delete <- .principal = viewer or exists projectMembers[.project, viewer, role = 'admin']
  sync to projectMembers[.project]

table issues:
  project: projects
  title: text 1..120
  body: text <=2000 ?
  status: enum('open', 'in_progress', 'closed')
  priority: enum('low', 'medium', 'high')
  assignee: principal ?
  labels: [text <=20] <=5
  reporter: principal
  createdAt: time default now
  immutable project, reporter
  read <- exists projectMembers[.project, viewer]
  insert <- .reporter = viewer and exists projectMembers[.project, viewer]
  update <- exists projectMembers[.project, viewer]
  delete <- exists projectMembers[.project, viewer, role = 'admin']
  sync to projectMembers[.project] last 500 by .createdAt, .id

table comments:
  issue: issues
  author: principal
  body: text 1..1000
  createdAt: time default now
  immutable issue, author
  read <- exists projectMembers[.issue.project, viewer]
  insert <- .author = viewer and exists projectMembers[.issue.project, viewer]
  update <- .author = viewer
  delete <- .author = viewer or exists projectMembers[.issue.project, viewer, role = 'admin']
  sync to projectMembers[.issue.project] last 500 by .createdAt, .id

table events:
  issue: issues
  actor: principal
  kind: enum('created', 'status', 'priority', 'assigned', 'comment', 'edited')
  detail: text <=200 ?
  at: time default now
  immutable issue, actor, kind
  read <- exists projectMembers[.issue.project, viewer]
  insert <- .actor = viewer and exists projectMembers[.issue.project, viewer]
  update <- deny
  delete <- deny
  sync to projectMembers[.issue.project] last 500 by .at, .id

query myProjects(c: cursor ?):
  return projectMembers where .principal = viewer last 50 by .joinedAt after c { project, role, info: projects[.project] }

query projectIssues(project: projects, c: cursor ?):
  return issues where .project = project last 50 by .createdAt after c

query issueDetail(issue: issues):
  must = issues[issue] ! else NOT_FOUND
  return must

query issueComments(issue: issues, c: cursor ?):
  return comments where .issue = issue last 50 by .createdAt after c

query issueActivity(issue: issues, c: cursor ?):
  return events where .issue = issue last 50 by .at after c

mutation createProject(name: text 1..80, description: text <=500 ?):
  p = insert projects { name, description, creator: viewer }
  insert projectMembers { project: p.id, principal: viewer, role: 'admin' }
  return { id: p.id }

mutation addMember(project: projects, who: principal, role: enum('member', 'admin')):
  return insert projectMembers { project, principal: who, role }

mutation removeMember(project: projects, who: principal):
  delete projectMembers[project = project, principal = who]
  return null

mutation createIssue(project: projects, title: text 1..120, body: text <=2000 ?, priority: enum('low', 'medium', 'high'), labels: [text <=20] <=5):
  issue = insert issues { project, title, body, status: 'open', priority, labels, reporter: viewer }
  insert events { issue: issue.id, actor: viewer, kind: 'created' }
  return { id: issue.id }

mutation setStatus(issue: issues, status: enum('open', 'in_progress', 'closed')):
  update issues[issue] { status }
  insert events { issue, actor: viewer, kind: 'status' }
  return null

mutation setPriority(issue: issues, priority: enum('low', 'medium', 'high')):
  update issues[issue] { priority }
  insert events { issue, actor: viewer, kind: 'priority' }
  return null

mutation assignIssue(issue: issues, who: principal ?):
  update issues[issue] { assignee: who }
  insert events { issue, actor: viewer, kind: 'assigned' }
  return null

mutation addComment(issue: issues, body: text 1..1000):
  c = insert comments { issue, author: viewer, body }
  insert events { issue, actor: viewer, kind: 'comment' }
  return { id: c.id }

mutation editComment(comment: comments, body: text 1..1000):
  c = comments[comment] ! else NOT_FOUND
  update comments[c] { body }
  insert events { issue: c.issue, actor: viewer, kind: 'edited' }
  return null

mutation deleteComment(comment: comments):
  delete comments[comment]
  return null
