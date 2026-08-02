import React from 'react';
import {useQuery} from '@rocicorp/zero/react';
import {queries, type InboxFilters} from './queries.ts';

export function TriageGraphZero({filters}: {filters: InboxFilters}) {
  const [issues, result] = useQuery(queries.issues.inbox(filters));
  return <main data-testid="triage-zero-root">
    <output data-testid="triage-completeness">{result.type}</output>
    <ol data-testid="triage-rows">
      {issues.map((issue) => <li key={issue.id} data-testid={`issue-${issue.id}`}>
        <strong>{issue.title}</strong> · {issue.project?.name} · {issue.assignee?.name}
        <span>{issue.labels.map((label) => label.name).join(', ')}</span>
        <span>{issue.commentCount} comments</span>
      </li>)}
    </ol>
  </main>;
}

