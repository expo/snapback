// The A6 operations surface: registered multi-query React views shared
// verbatim between the browser app (src/App.tsx) and the jsdom render proof
// (ui-render.mjs). One provider-owned group of two live queries (dashboard
// aggregates + the job ledger) plus a child panel holding its own live
// jobDetail query (bounded steps + newest-20 audit trail) for the selected
// job.
import { createElement as h, useState } from 'react';
import { useSnapbackQueries, useSnapbackMutation } from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

const rowsOf = (entry) =>
  entry && (entry.status === 'ready' || entry.status === 'refreshing') ? entry.data : [];

export function JobPanel({ jobId }) {
  const live = useSnapbackQueries({
    detail: { ref: api.jobDetail, args: { jobId } },
  });
  const claim = useSnapbackMutation(api.claimJob);
  const detail = rowsOf(live.queries.detail)[0] ?? null;
  if (!detail) return h('p', { 'data-testid': 'ops-detail-empty' }, 'loading job…');
  return h('div', { 'data-testid': 'ops-detail' },
    h('div', { className: 'section-heading' },
      h('div', null,
        h('p', { className: 'eyebrow' }, `${detail.display} · ${detail.customerName}`),
        h('h2', { 'data-testid': 'ops-detail-title' }, detail.title)),
      h('span', { className: 'pill', 'data-testid': 'ops-detail-status' },
        detail.ownerName ? `${detail.status} · ${detail.ownerName}` : detail.status)),
    detail.status === 'open'
      ? h('button', {
          className: 'primary',
          'data-testid': 'ops-claim',
          onClick: () => { claim({ jobId, actorName: 'You', leaseMs: 120000 }).catch(() => {}); },
        }, 'Claim this job')
      : null,
    h('ol', { 'data-testid': 'ops-detail-steps' },
      ...detail.steps.map((s) =>
        h('li', { key: s.seq, 'data-testid': `ops-step-${s.seq}` },
          `${s.state === 'done' ? '☑' : '☐'} ${s.title}`))),
    h('p', { className: 'section-label' },
      `Audit trail · ${detail.activityShown} of ${detail.activityTotal} · ${detail.attemptReceipts} attempt receipts`),
    h('ol', { 'data-testid': 'ops-detail-activity' },
      ...detail.recentActivity.map((a) =>
        h('li', { key: a.seq, 'data-testid': `ops-activity-${a.seq}` },
          `${a.kind}: ${a.detail}`))),
  );
}

export function OpsView({ orgId }) {
  const live = useSnapbackQueries({
    dashboard: { ref: api.orgDashboard, args: { orgId, fromMs: 0, toMs: 0 } },
    jobs: { ref: api.jobList, args: { orgId, fromMs: 0, toMs: 0, status: '' } },
  });
  const [selected, setSelected] = useState(null);
  const dashboard = rowsOf(live.queries.dashboard)[0] ?? null;
  const jobs = rowsOf(live.queries.jobs);
  const selectedId = selected ?? (jobs.length > 0 ? jobs[jobs.length - 1]._id : null);

  return h('section', { className: 'workspace two-column', 'aria-label': 'Operations ledger' },
    h('nav', { className: 'panel list-nav', 'aria-label': 'Ledger views' },
      h('button', { className: 'primary', 'data-testid': 'ops-new-job' }, '+ New job'),
      h('p', { className: 'section-label', 'data-testid': 'ops-org-name' },
        dashboard ? dashboard.orgName : 'loading…'),
      h('div', { className: 'issue-list', 'data-testid': 'ops-job-list' },
        ...jobs.map((j) =>
          h('button', {
            className: 'issue-row', key: j._id,
            'data-testid': `ops-job-${j.display}`,
            onClick: () => setSelected(j._id),
          },
            h('span', { className: 'muted' }, j.display),
            h('strong', null, j.title),
            h('span', { className: 'pill', 'data-testid': `ops-job-status-${j.display}` },
              j.ownerName ? `${j.status} · ${j.ownerName}` : j.status))))),
    h('div', { className: 'panel content-panel' },
      selectedId ? h(JobPanel, { jobId: selectedId }) : h('p', null, 'no jobs'),
      h('div', { className: 'offline-note', 'data-testid': 'ops-dashboard-counts' },
        dashboard
          ? `${dashboard.jobsTotal} jobs · ${dashboard.jobsOpen} open · ${dashboard.jobsClaimed} claimed · ${dashboard.jobsDone} done · seq ${dashboard.jobSeq}`
          : 'loading…')),
  );
}
