import {defineSchema, defineTable, v} from '../../../../_kit/define.mjs';

const keyed = (fields) => defineTable(fields).sync();

export default defineSchema({
  users: keyed({userKey: v.string(), name: v.string()}).index('by_user_key', ['userKey'], {unique: true}),
  organizations: keyed({organizationKey: v.string(), name: v.string()}).index('by_organization_key', ['organizationKey'], {unique: true}),
  teams: keyed({teamKey: v.string(), organizationKey: v.string(), name: v.string()})
    .index('by_team_key', ['teamKey'], {unique: true})
    .index('by_organization', ['organizationKey']),
  memberships: keyed({membershipKey: v.string(), teamKey: v.string(), userKey: v.string()})
    .index('by_membership_key', ['membershipKey'], {unique: true})
    .index('by_user_team', ['userKey', 'teamKey'], {unique: true})
    .index('by_team_user', ['teamKey', 'userKey'], {unique: true}),
  projects: keyed({projectKey: v.string(), teamKey: v.string(), name: v.string()})
    .index('by_project_key', ['projectKey'], {unique: true})
    .index('by_team', ['teamKey']),
  labels: keyed({labelKey: v.string(), teamKey: v.string(), name: v.string()})
    .index('by_label_key', ['labelKey'], {unique: true})
    .index('by_team', ['teamKey']),
  issues: keyed({
    issueKey: v.string(), teamKey: v.string(), projectKey: v.string(), assigneeKey: v.string(),
    title: v.string(), status: v.string(), priority: v.string(), pageKey: v.string(),
    commentCount: v.integer(), updatedAt: v.integer(),
  })
    .index('by_issue_key', ['issueKey'], {unique: true})
    .index('by_team_page', ['teamKey', 'pageKey'], {unique: true})
    .index('by_assignee_page', ['assigneeKey', 'pageKey'], {unique: true}),
  issueLabels: keyed({issueLabelKey: v.string(), issueKey: v.string(), labelKey: v.string()})
    .index('by_issue_label_key', ['issueLabelKey'], {unique: true})
    .index('by_issue_label', ['issueKey', 'labelKey'], {unique: true})
    .index('by_label_issue', ['labelKey', 'issueKey'], {unique: true}),
  comments: keyed({commentKey: v.string(), issueKey: v.string(), authorKey: v.string(), body: v.string(), createdAt: v.integer()})
    .index('by_comment_key', ['commentKey'], {unique: true})
    .index('by_issue_time', ['issueKey', 'createdAt'], {unique: true}),
  activities: keyed({activityKey: v.string(), issueKey: v.string(), kind: v.string(), createdAt: v.integer()})
    .index('by_activity_key', ['activityKey'], {unique: true})
    .index('by_issue_time', ['issueKey', 'createdAt'], {unique: true}),
});

