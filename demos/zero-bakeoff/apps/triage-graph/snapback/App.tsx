import React from 'react';
import {useSnapbackQuery} from '@expo/snapback-react';
import api from './generated/api.mjs';

export type TriageFilters = {teamKey?: string; status?: string; priority?: string; labelKey?: string; assigneeKey?: string; after?: string};

export function TriageGraphSnapback({filters}: {filters: TriageFilters}) {
  const query = useSnapbackQuery(api.inbox, filters);
  return <main data-testid="triage-snapback-root">
    <output data-testid="triage-completeness">{query.status}:{query.connection}</output>
    <ol data-testid="triage-rows">
      {(query.data ?? []).map((issue) => <li key={issue.issueKey} data-testid={`issue-${issue.issueKey}`}>
        <strong>{issue.title}</strong> · {issue.projectName} · {issue.assigneeName}
        <span>{Array.isArray(issue.labels) ? issue.labels.map((label: any) => label.name).join(', ') : ''}</span>
        <span>{issue.commentCount} comments</span>
      </li>)}
    </ol>
  </main>;
}

