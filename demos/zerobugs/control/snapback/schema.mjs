import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// The ten source tables stay visible and source-shaped. Snapback's system `_id`
// is the physical, typed reference target; the source `id` columns remain part
// of the public row so the pinned application's URL and mutation contracts do
// not silently change.
// @ref LLP 0183#d1--comparator-manifest-and-current-surface-control — the
// current-surface control keeps source demand exact while making every
// Snapback-specific representation choice explicit and countable.

export const user = defineTable({
  id: v.string(),
  login: v.string(),
  name: v.optional(v.string()),
  avatar: v.string(),
  // Stored as the source varchar representation. The fixture compiler and
  // every authoritative writer close this to `crew | user`; the shipped table
  // field surface does not admit literal unions.
  role: v.string(),
  githubID: v.integer(),
  email: v.optional(v.string()),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_github_id', ['githubID'], { unique: true })
  .index('by_login', ['login'], { unique: true })
  .sync();

export const project = defineTable({
  id: v.string(),
  name: v.string(),
  lowerCaseName: v.string(),
  issueCountEstimate: v.optional(v.integer()),
  supportsSearch: v.boolean(),
  markURL: v.optional(v.string()),
  logoURL: v.optional(v.string()),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_lower_case_name', ['lowerCaseName'], { unique: true })
  .sync();

export const issue = defineTable({
  id: v.string(),
  shortID: v.optional(v.integer()),
  title: v.string(),
  open: v.boolean(),
  modified: v.number(),
  created: v.number(),
  projectID: v.id('project'),
  creatorID: v.id('user'),
  assigneeID: v.optional(v.id('user')),
  description: v.string(),
  // Stored as the source varchar representation, with the source enum checked
  // by fixture ingestion and every authoritative write.
  visibility: v.string(),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_short_id', ['shortID'])
  .index('by_created', ['created'])
  .index('by_project_modified', ['projectID', 'modified', 'id'])
  .index('by_project_open_modified', ['projectID', 'open', 'modified', 'id'])
  .index('by_project_assignee_modified', ['projectID', 'assigneeID', 'modified', 'id'])
  .index('by_project_open_assignee_modified', ['projectID', 'open', 'assigneeID', 'modified', 'id'])
  .index('by_project_creator_modified', ['projectID', 'creatorID', 'modified', 'id'])
  .index('by_project_open_creator_modified', ['projectID', 'open', 'creatorID', 'modified', 'id'])
  .index('by_creator_source_id', ['creatorID', 'id'])
  .index('by_assignee_source_id', ['assigneeID', 'id'])
  .sync();

export const viewState = defineTable({
  issueID: v.id('issue'),
  userID: v.id('user'),
  viewed: v.number(),
})
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .sync();

export const comment = defineTable({
  id: v.string(),
  issueID: v.id('issue'),
  created: v.number(),
  body: v.string(),
  creatorID: v.id('user'),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_issue', ['issueID'])
  .index('by_issue_created', ['issueID', 'created', 'id'])
  .sync();

export const label = defineTable({
  id: v.string(),
  name: v.string(),
  projectID: v.id('project'),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_source_id_project', ['id', 'projectID'], { unique: true })
  .index('by_project_name', ['projectID', 'name'], { unique: true })
  .sync();

export const issueLabel = defineTable({
  labelID: v.id('label'),
  issueID: v.id('issue'),
  projectID: v.id('project'),
})
  .index('by_label_issue', ['labelID', 'issueID'], { unique: true })
  .index('by_issue', ['issueID'])
  .index('by_issue_label', ['issueID', 'labelID'], { unique: true })
  .sync();

export const emoji = defineTable({
  id: v.string(),
  value: v.string(),
  annotation: v.string(),
  subjectID: v.string(),
  creatorID: v.id('user'),
  created: v.number(),
})
  .index('by_source_id', ['id'], { unique: true })
  .index('by_created', ['created'])
  .index('by_subject', ['subjectID'])
  .index('by_value_subject_creator', ['value', 'subjectID', 'creatorID'], { unique: true })
  .sync();

export const userPref = defineTable({
  key: v.string(),
  userID: v.id('user'),
  value: v.string(),
})
  .index('by_key_user', ['key', 'userID'], { unique: true })
  .index('by_user_key', ['userID', 'key'], { unique: true })
  .sync();

export const issueNotifications = defineTable({
  userID: v.id('user'),
  issueID: v.id('issue'),
  subscribed: v.boolean(),
  created: v.number(),
})
  .index('by_user_issue', ['userID', 'issueID'], { unique: true })
  .index('by_issue_user', ['issueID', 'userID'], { unique: true })
  .sync();

export default defineSchema(
  {
    user,
    project,
    issue,
    viewState,
    comment,
    label,
    issueLabel,
    emoji,
    userPref,
    issueNotifications,
  },
  { auth: { mode: 'sessions' } },
);
