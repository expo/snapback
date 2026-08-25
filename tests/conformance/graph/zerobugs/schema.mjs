import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// Corpus-owned mirror of the Zerobugs control tables touched by the four
// corpus graphs.
// declarations. The field and index names intentionally match the control.
// Issue reads are public only when the row says so; internal rows require a
// crew principal in the still-authoritative opaque handlers. The visibility
// field is therefore permission-backing input even though the storage mirror
// remains public-read.
// @ref LLP 0209#stage-b-oracle-comparison-contract — graph declarations and
// the opaque control oracle share schema facts without sharing execution.

export const user = defineTable({
  id: v.string(), login: v.string(), name: v.optional(v.string()),
  avatar: v.string(), role: v.string(), githubID: v.integer(),
  email: v.optional(v.string()),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_github_id', ['githubID'], { unique: true })
  .index('by_login', ['login'], { unique: true })
  .visibility({ kind: 'public-read' });

export const project = defineTable({
  id: v.string(), name: v.string(), lowerCaseName: v.string(),
  issueCountEstimate: v.optional(v.integer()), supportsSearch: v.boolean(),
  markURL: v.optional(v.string()), logoURL: v.optional(v.string()),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_lower_case_name', ['lowerCaseName'], { unique: true })
  .visibility({ kind: 'public-read' });

export const issue = defineTable({
  id: v.string(), shortID: v.optional(v.integer()), title: v.string(),
  open: v.boolean(), modified: v.number(), created: v.number(),
  projectID: v.id('project'), creatorID: v.id('user'),
  assigneeID: v.optional(v.id('user')), description: v.string(),
  visibility: v.string(),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_short_id', ['shortID'])
  .index('by_created', ['created'])
  .index('by_project_modified', ['projectID', 'modified', 'id'])
  .permissionBacking(['visibility'])
  .visibility({ kind: 'public-read' });

export const comment = defineTable({
  id: v.string(), issueID: v.id('issue'), created: v.number(), body: v.string(),
  creatorID: v.id('user'),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_issue', ['issueID'])
  .index('by_issue_created', ['issueID', 'created', 'id'])
  .visibility({ kind: 'public-read' });

export const label = defineTable({
  id: v.string(), name: v.string(), projectID: v.id('project'),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_project_name', ['projectID', 'name'], { unique: true })
  .visibility({ kind: 'public-read' });

export const viewState = defineTable({
  issueID: v.id('issue'), userID: v.id('user'), viewed: v.number(),
})
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .visibility({ kind: 'public-read' });

export const issueNotifications = defineTable({
  userID: v.id('user'), issueID: v.id('issue'), subscribed: v.boolean(),
  created: v.number(),
})
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .visibility({ kind: 'public-read' });

export const identityBinding = defineTable({
  principal: v.principal(), userID: v.id('user'), sourceUserID: v.string(),
})
  .index('by_principal', ['principal'], { unique: true })
  .index('by_user', ['userID'], { unique: true })
  .index('by_source_user_id', ['sourceUserID'], { unique: true })
  .visibility({ kind: 'public-read' });

export const issueListRead = defineTable({
  issueID: v.id('issue'), sourceIssueID: v.string(), projectID: v.id('project'),
  creatorID: v.id('user'), assigneeID: v.optional(v.id('user')),
  open: v.boolean(), visibility: v.string(), modified: v.number(),
  created: v.number(),
})
  .index('by_issue', ['issueID'], { unique: true })
  .index('by_source_issue_id', ['sourceIssueID'], { unique: true })
  .index('by_project_modified', ['projectID', 'modified', 'sourceIssueID'])
  .index('by_project_created', ['projectID', 'created', 'sourceIssueID'])
  .permissionBacking(['visibility'])
  .visibility({ kind: 'public-read' });

export const issueLabelRead = defineTable({
  projectID: v.id('project'), issueID: v.id('issue'), labelID: v.id('label'),
})
  .index('by_issue_label', ['issueID', 'labelID'], { unique: true })
  .index('by_project_label_issue', ['projectID', 'labelID', 'issueID'], { unique: true })
  .index('by_project_issue_label', ['projectID', 'issueID', 'labelID'], { unique: true })
  .visibility({ kind: 'public-read' });

export default defineSchema({
  user, project, issue, comment, label, viewState, issueNotifications,
  identityBinding, issueListRead, issueLabelRead,
});
