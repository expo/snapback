import {createBuilder, createSchema, number, relationships, string, table, type Row} from '@rocicorp/zero';

const user = table('tg_user').columns({id: string(), name: string()}).primaryKey('id');
const organization = table('tg_organization').columns({id: string(), name: string()}).primaryKey('id');
const team = table('tg_team').columns({id: string(), organizationID: string(), name: string()}).primaryKey('id');
const membership = table('tg_membership').columns({id: string(), teamID: string(), userID: string()}).primaryKey('id');
const project = table('tg_project').columns({id: string(), teamID: string(), name: string()}).primaryKey('id');
const label = table('tg_label').columns({id: string(), teamID: string(), name: string()}).primaryKey('id');
const issue = table('tg_issue').columns({
  id: string(), teamID: string(), projectID: string(), assigneeID: string(), title: string(),
  status: string(), priority: string(), pageKey: string(), commentCount: number(), updatedAt: number(),
}).primaryKey('id');
const issueLabel = table('tg_issue_label').columns({id: string(), issueID: string(), labelID: string()}).primaryKey('id');
const comment = table('tg_comment').columns({id: string(), issueID: string(), authorID: string(), body: string(), createdAt: number()}).primaryKey('id');
const activity = table('tg_activity').columns({id: string(), issueID: string(), kind: string(), createdAt: number()}).primaryKey('id');

const teamRelationships = relationships(team, ({one, many}) => ({
  organization: one({sourceField: ['organizationID'], destField: ['id'], destSchema: organization}),
  members: many({sourceField: ['id'], destField: ['teamID'], destSchema: membership}),
}));
const issueRelationships = relationships(issue, ({one, many}) => ({
  team: one({sourceField: ['teamID'], destField: ['id'], destSchema: team}),
  project: one({sourceField: ['projectID'], destField: ['id'], destSchema: project}),
  assignee: one({sourceField: ['assigneeID'], destField: ['id'], destSchema: user}),
  labels: many(
    {sourceField: ['id'], destField: ['issueID'], destSchema: issueLabel},
    {sourceField: ['labelID'], destField: ['id'], destSchema: label},
  ),
  comments: many({sourceField: ['id'], destField: ['issueID'], destSchema: comment}),
  activities: many({sourceField: ['id'], destField: ['issueID'], destSchema: activity}),
}));

export const schema = createSchema({
  tables: [user, organization, team, membership, project, label, issue, issueLabel, comment, activity],
  relationships: [teamRelationships, issueRelationships],
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});
export const zql = createBuilder(schema);
export type Schema = typeof schema;
export type Issue = Row<typeof schema.tables.tg_issue>;
export type AuthContext = {userID: string};

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: Schema;
    context: AuthContext;
  }
}

