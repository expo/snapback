// The A5 research surface: registered multi-query React views shared
// verbatim between the browser app (src/App.tsx) and the jsdom render proof
// (ui-render.mjs). One provider-owned group of three live queries (room
// overview, source list, question feed) plus a child panel holding its own
// live thread query for the newest question.
import { createElement as h } from 'react';
import { useSnapbackQueries, useSnapbackMutation } from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

const rowsOf = (entry) =>
  entry && (entry.status === 'ready' || entry.status === 'refreshing') ? entry.data : [];

const STAGE_DOTS = ['accepted', 'retrieved', 'ranked', 'drafted', 'answered'];

export function ThreadPanel({ roomId, questionId }) {
  const live = useSnapbackQueries({
    thread: { ref: api.questionThread, args: { roomId, questionId } },
  });
  const thread = rowsOf(live.queries.thread)[0] ?? null;
  if (!thread) return h('p', { 'data-testid': 'research-thread-empty' }, 'loading thread…');
  const answer = thread.answer[0] ?? null;
  const reached = STAGE_DOTS.indexOf(thread.stage) + 1;
  return h('div', { 'data-testid': 'research-thread' },
    h('article', { className: 'question' },
      h('strong', null, thread.askerName),
      h('p', { 'data-testid': 'research-question-text' }, thread.text)),
    h('article', { className: 'answer', 'data-testid': 'research-answer' },
      h('p', { className: 'eyebrow', 'data-testid': 'research-status' }, `Answer · ${thread.status}`),
      h('p', { 'data-testid': 'research-answer-text' }, answer ? answer.text : `(${thread.stage})`),
      h('div', { className: 'citations', 'data-testid': 'research-citations' },
        ...(answer ? answer.citations.map((c, i) =>
          h('button', { key: c.sourceId }, `[${i + 1}] ${c.title}`)) : []))),
    h('div', { className: 'progress', 'data-testid': 'research-progress' },
      ...STAGE_DOTS.map((stage, i) =>
        h('span', { key: stage, className: i < reached ? 'complete' : '' }))),
    h('ol', { 'data-testid': 'research-progress-log' },
      ...thread.progress.map((p) =>
        h('li', { key: p.seq, 'data-testid': `research-progress-${p.seq}` }, `${p.stage}: ${p.detail}`))),
  );
}

export function ResearchView({ roomId }) {
  const live = useSnapbackQueries({
    overview: { ref: api.roomOverview, args: { roomId } },
    sources: { ref: api.sourceList, args: { roomId } },
    feed: { ref: api.questionFeed, args: { roomId } },
  });
  const ask = useSnapbackMutation(api.askQuestion);
  const overview = rowsOf(live.queries.overview)[0] ?? null;
  const sources = rowsOf(live.queries.sources);
  const feed = rowsOf(live.queries.feed);
  const latest = feed.length > 0 ? feed[feed.length - 1] : null;

  const submit = (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.question;
    const text = input.value.trim();
    if (!text) return;
    ask({ roomId, text, dedupeKey: `ui-${text.slice(0, 32)}`, askerName: 'You', ttlMs: 60000 }).catch(() => {});
    input.value = '';
  };

  return h('section', { className: 'workspace research-grid', 'aria-label': 'Research room' },
    h('nav', { className: 'panel list-nav', 'aria-label': 'Sources' },
      h('button', { className: 'primary', 'data-testid': 'research-upload' }, 'Upload source'),
      h('p', { className: 'section-label', 'data-testid': 'research-source-count' },
        overview ? `${overview.sourceCount} sources` : 'loading…'),
      ...sources.map((source) =>
        h('button', { className: 'nav-row', key: source._id, 'data-testid': `research-source-${source.title}` },
          source.title))),
    h('div', { className: 'panel content-panel research-panel' },
      h('div', { className: 'section-heading' },
        h('div', null,
          h('p', { className: 'eyebrow' }, 'Shared research room'),
          h('h2', { 'data-testid': 'research-room-name' }, overview ? overview.name : 'Loading room')),
        h('span', { 'data-testid': 'research-question-count' },
          overview ? `${overview.questionCount} questions` : '…')),
      latest
        ? h(ThreadPanel, { roomId, questionId: latest._id })
        : h('p', { 'data-testid': 'research-thread-none' }, 'No questions yet — ask one.'),
      h('form', { className: 'composer', onSubmit: submit },
        h('label', null, 'Ask the room',
          h('input', { name: 'question', 'data-testid': 'research-question', placeholder: 'Ask a cited question…' })))),
  );
}
