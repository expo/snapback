// The A3 board surface: one registered multi-query React view shared verbatim
// between the browser app (src/App.tsx) and the jsdom render proof
// (ui-render.mjs). Six live queries in one provider-owned group: four board
// columns, the aggregate counts, and the organization activity feed.
import { createElement as h } from 'react';
import { useSnapbackQueries, useSnapbackMutation } from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

export const BOARD_COLUMNS = [
  ['todo', 'Todo'],
  ['in-progress', 'In progress'],
  ['review', 'Review'],
  ['done', 'Done'],
];

const rowsOf = (entry) =>
  entry && (entry.status === 'ready' || entry.status === 'refreshing') ? entry.data : [];

export function BoardView({ orgId }) {
  const board = useSnapbackQueries({
    todo: { ref: api.columnIssues, args: { orgId, status: 'todo' } },
    inProgress: { ref: api.columnIssues, args: { orgId, status: 'in-progress' } },
    review: { ref: api.columnIssues, args: { orgId, status: 'review' } },
    done: { ref: api.columnIssues, args: { orgId, status: 'done' } },
    aggregates: { ref: api.boardAggregates, args: { orgId } },
    activity: { ref: api.orgActivity, args: { orgId } },
  });
  const createIssue = useSnapbackMutation(api.createIssue);
  const byStatus = {
    todo: rowsOf(board.queries.todo),
    'in-progress': rowsOf(board.queries.inProgress),
    review: rowsOf(board.queries.review),
    done: rowsOf(board.queries.done),
  };
  const agg = rowsOf(board.queries.aggregates)[0] ?? null;
  const feed = rowsOf(board.queries.activity).slice(0, 6);

  return h('section', { className: 'workspace two-column', 'aria-label': 'Issue board' },
    h('nav', { className: 'panel list-nav', 'aria-label': 'Issue views' },
      h('button', {
        className: 'primary',
        'data-testid': 'board-new-issue',
        onClick: () => {
          createIssue({
            orgId,
            teamId: 'team_platform',
            projectId: 'proj_sync',
            title: `Board-created issue ${Date.now()}`,
            description: 'created from the board view',
            priority: 1,
            actorName: 'Board user',
          }).catch(() => {});
        },
      }, '+ New issue'),
      h('div', { className: 'offline-note', 'data-testid': 'board-activity' },
        feed.map((a) => h('p', { key: a._id }, `${a.actorName} · ${a.kind} · ${a.detail}`))),
    ),
    h('div', { className: 'panel content-panel' },
      h('div', { className: 'section-heading' },
        h('div', null,
          h('p', { className: 'eyebrow' }, 'Relay'),
          h('h2', null, 'Board')),
        h('input', { 'aria-label': 'Search issues', 'data-testid': 'board-search', placeholder: 'Search' })),
      h('div', { className: 'issue-list board-columns', 'data-testid': 'board-issue-list' },
        BOARD_COLUMNS.map(([status, title]) =>
          h('div', { key: status, 'data-testid': `board-column-${status}` },
            h('h3', null, `${title} (${byStatus[status].length})`),
            byStatus[status].map((issue) =>
              h('button', { className: 'issue-row', key: issue._id, 'data-testid': `board-issue-${issue.identifier}` },
                h('span', { className: 'muted' }, issue.identifier),
                h('strong', null, issue.title),
                h('span', { className: 'pill' }, `P${issue.priority}`),
                h('span', null, issue.assigneeName || 'Unassigned')))))),
      h('div', { className: 'offline-note', 'data-testid': 'board-aggregates' },
        agg
          ? `${agg.total} total · ${agg.todo} todo · ${agg.inProgress} in progress · ${agg.review} review · ${agg.done} done`
          : 'loading counts')),
  );
}
