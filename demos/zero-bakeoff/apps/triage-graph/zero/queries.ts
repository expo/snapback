import {defineQueries, defineQuery} from '@rocicorp/zero';
import {zql, type AuthContext} from './schema.ts';

export type InboxFilters = {
  teamID?: string;
  status?: string;
  priority?: string;
  labelID?: string;
  assigneeID?: string;
  after?: string;
  afterID?: string;
};

export const queries = defineQueries({
  issues: {
    inbox: defineQuery(({args, ctx}: {args: InboxFilters; ctx: AuthContext}) => {
      let query = zql.tg_issue
        .where(({or, cmp, exists}) => or(
          cmp('assigneeID', ctx.userID),
          exists('team', (teams) => teams.whereExists('members', (members) => members.where('userID', ctx.userID))),
        ));
      if (args.teamID) query = query.where('teamID', args.teamID);
      if (args.status) query = query.where('status', args.status);
      if (args.priority) query = query.where('priority', args.priority);
      if (args.assigneeID) query = query.where('assigneeID', args.assigneeID);
      if (args.labelID) query = query.whereExists('labels', (labels) => labels.where('id', args.labelID));
      query = query
        .related('project')
        .related('assignee')
        .related('labels')
        .orderBy('pageKey', 'desc');
      if (args.after) query = query.start({pageKey: args.after, ...(args.afterID ? {id: args.afterID} : {})}, {inclusive: false});
      return query.limit(50);
    }),
    detail: defineQuery(({args, ctx}: {args: {issueID: string}; ctx: AuthContext}) =>
      zql.tg_issue
        .where('id', args.issueID)
        .where(({or, cmp, exists}) => or(
          cmp('assigneeID', ctx.userID),
          exists('team', (teams) => teams.whereExists('members', (members) => members.where('userID', ctx.userID))),
        ))
        .related('project')
        .related('assignee')
        .related('labels')
        .related('comments', (comments) => comments.orderBy('createdAt', 'desc').limit(20))
        .related('activities', (activities) => activities.orderBy('createdAt', 'desc').limit(20))
        .one(),
    ),
  },
});
