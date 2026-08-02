import {defineMutator, defineMutators} from '@rocicorp/zero';
import {zql, type AuthContext} from './schema.ts';

export type PatchIssueArgs = {issueID: string; title?: string; status?: string; priority?: string; updatedAt: number};

export const mutators = defineMutators({
  issues: {
    patch: defineMutator(async ({tx, args, ctx}: {tx: any; args: PatchIssueArgs; ctx: AuthContext}) => {
      const issue = await tx.run(zql.tg_issue.where('id', args.issueID).one());
      if (!issue) throw new Error('issue not found');
      const membership = await tx.run(
        zql.tg_membership.where('teamID', issue.teamID).where('userID', ctx.userID).one(),
      );
      if (!membership && issue.assigneeID !== ctx.userID) throw new Error('issue not found');
      await tx.mutate.tg_issue.update({
        id: args.issueID,
        ...(args.title === undefined ? {} : {title: args.title}),
        ...(args.status === undefined ? {} : {status: args.status}),
        ...(args.priority === undefined ? {} : {priority: args.priority}),
        updatedAt: args.updatedAt,
      });
    }),
  },
});

