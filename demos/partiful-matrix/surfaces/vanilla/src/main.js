import '../../react/src/styles.css';

import { SubscriptionScope } from './lifecycle.js';
import {
  configuredBackend,
  createMatrixProvider,
  snapbackArtifactHash,
} from './provider.js';

const markStartup = (name) => {
  const fullName = `partitime:${name}`;
  if (performance.getEntriesByName(fullName).length === 0) performance.mark(fullName);
};
const startupMilestones = () => Object.fromEntries([
  'module-evaluated',
  'boot-started',
  'provider-ready',
  'ui-mounted',
  'first-authoritative-snapshot',
].map((name) => [name, performance.getEntriesByName(`partitime:${name}`)[0]?.startTime ?? null]));
markStartup('module-evaluated');

const PERSONAS = [
  { id: 'ada', userId: 'user_ada', name: 'Ada', initials: 'AD' },
  { id: 'grace', userId: 'user_grace', name: 'Grace', initials: 'GH' },
  { id: 'eve', userId: 'user_eve', name: 'Eve', initials: 'EV' },
];
const RSVP_STATUSES = ['going', 'maybe', 'cant'];
const ACCENTS = new Set(['tangerine', 'cobalt', 'orchid']);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const formatWhen = (startsAt) => new Date(startsAt).toLocaleString(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const statusLabel = (status) => ({ host: 'Hosting', going: 'Going', maybe: 'Maybe', cant: "Can't go" })[status] ?? status;
const personaFromSearch = () => {
  const requested = new URLSearchParams(location.search).get('user');
  return PERSONAS.find((persona) => persona.id === requested || persona.userId === requested) ?? PERSONAS[0];
};
const accentClass = (accent, index = 0) => ACCENTS.has(accent)
  ? accent
  : ['tangerine', 'cobalt', 'orchid'][index % 3];
const valueAttribute = (value) => escapeHtml(value);

async function boot() {
  markStartup('boot-started');
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const provider = await createMatrixProvider();
  markStartup('provider-ready');
  const state = {
    persona: personaFromSearch(),
    view: { kind: 'feed' },
    events: [],
    eventRows: [],
    guests: [],
    posts: [],
    connection: 'connecting',
    creating: false,
    busy: false,
    error: '',
    createDraft: { title: '', emoji: '🪩', location: '', description: '' },
    wallDraft: '',
  };
  const scope = new SubscriptionScope();

  const snapshot = () => ({
    ...scope.snapshot(),
    authoring: 'vanilla',
    backend: provider.backend,
    view: state.view.kind,
    eventId: state.view.kind === 'event' ? state.view.id : null,
  });

  const renderConnection = () => {
    const label = state.connection === 'polling' ? 'polling · 1s' : state.connection;
    return `<span class="connection ${escapeHtml(state.connection)}" data-testid="connection"><b></b>${escapeHtml(label)}</span>`;
  };

  const renderNav = () => `
    <header class="nav">
      <button class="brand" data-testid="home">
        <span class="brand-mark">p</span><span>parti<span>time</span></span>
      </button>
      <div class="experiment-badge" data-testid="matrix-label"><strong>VANILLA JS</strong><i></i>${escapeHtml(configuredBackend)}</div>
      <div class="persona-switcher" data-testid="persona-switcher">
        ${PERSONAS.map((persona, index) => `
          <button data-persona="${persona.id}" data-testid="persona-${persona.id}"
            class="persona ${state.persona.id === persona.id ? 'active' : ''}"
            style="z-index:${PERSONAS.length - index}" title="Browse as ${persona.name}">${persona.initials}</button>
        `).join('')}
      </div>
    </header>`;

  const renderEventCard = (event, index) => `
    <article class="event-card ${accentClass(event.accent, index)}" data-event-id="${escapeHtml(event._id)}" data-testid="event-card-${escapeHtml(event._id)}">
      <div class="card-art"><span>${escapeHtml(event.emoji)}</span><b>${String(index + 1).padStart(2, '0')}</b><i></i></div>
      <div class="card-copy">
        <div class="card-time">${escapeHtml(formatWhen(event.startsAt))}</div>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(event.location)}</p>
        <div class="card-footer"><span>HOSTED BY ${escapeHtml(event.hostName).toUpperCase()}</span><button data-testid="open-${escapeHtml(event._id)}">View plan →</button></div>
      </div>
    </article>`;

  const renderFeed = () => `
    <section class="hero">
      <div class="eyebrow">SAN FRANCISCO · YOUR WEEK AHEAD</div>
      <h1>Make a plan worth<br><em>leaving the chat for.</em></h1>
      <p>Small gatherings, good people, no algorithmic sludge.</p>
      <div class="hero-actions">
        <button class="primary" data-testid="new-event">${state.creating ? 'Never mind' : '+ Make something happen'}</button>
        ${renderConnection()}
      </div>
    </section>
    ${state.creating ? `
      <section class="create-panel" data-testid="create-panel">
        <div><span class="step">01</span><h2>What’s the plan?</h2><p>Keep it loose. You can fill in the poetry later.</p></div>
        <div class="create-grid">
          <input aria-label="Emoji" data-testid="create-emoji" class="emoji-input" value="${valueAttribute(state.createDraft.emoji)}">
          <input aria-label="Event title" data-testid="create-title" placeholder="Sunday noodles" value="${valueAttribute(state.createDraft.title)}">
          <input aria-label="Location" data-testid="create-location" placeholder="Where are we meeting?" value="${valueAttribute(state.createDraft.location)}">
          <input aria-label="Description" data-testid="create-description" placeholder="A sentence to set the mood" value="${valueAttribute(state.createDraft.description)}">
          <button class="primary submit" data-testid="create-submit" ${state.busy || !state.createDraft.title.trim() || !state.createDraft.location.trim() ? 'disabled' : ''}>${state.busy ? 'Making it…' : 'Send the invite ↗'}</button>
        </div>
      </section>` : ''}
    <section class="feed-section">
      <div class="section-heading"><div><span class="step">02</span><h2>On the horizon</h2></div><span>${state.events.length} PLANS</span></div>
      ${state.error ? `<div class="boot-error"><b>Something interrupted the plan.</b><span>${escapeHtml(state.error)}</span></div>` : ''}
      <div class="event-grid" data-testid="feed">${state.events.map(renderEventCard).join('')}</div>
    </section>`;

  const renderPost = (post) => `
    <div class="post"><b>${escapeHtml(post.authorName).slice(0, 1)}</b><p><strong>${escapeHtml(post.authorName)}</strong>${escapeHtml(post.message)}</p></div>`;
  const renderGuest = (guest) => `
    <div class="guest" data-testid="guest-${escapeHtml(guest.userId)}"><b>${escapeHtml(guest.guestName).slice(0, 2).toUpperCase()}</b><span>${escapeHtml(guest.guestName)}</span><em>${escapeHtml(statusLabel(guest.status))}</em></div>`;

  const renderEvent = () => {
    const event = state.eventRows[0];
    if (!event) return `
      <section class="event-page">
        <button class="back" data-testid="back">← All plans</button>
        <p>${state.error ? escapeHtml(state.error) : 'Loading the plan…'}</p>
      </section>`;
    const mine = state.guests.find((guest) => guest.userId === state.persona.userId);
    const going = state.guests.filter((guest) => ['host', 'going'].includes(guest.status)).length;
    return `
      <section class="event-page" data-testid="event-page">
        <button class="back" data-testid="back">← All plans</button>
        <div class="event-hero ${accentClass(event.accent)}">
          <div class="event-glyph">${escapeHtml(event.emoji)}</div>
          <div><div class="eyebrow">${escapeHtml(formatWhen(event.startsAt))} · HOSTED BY ${escapeHtml(event.hostName).toUpperCase()}</div><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(event.description)}</p></div>
          ${renderConnection()}
        </div>
        <div class="event-columns">
          <div class="event-main">
            <div class="where"><span>MEET HERE</span><h2>${escapeHtml(event.location)}</h2><div class="map-lines"></div></div>
            <div class="wall" data-testid="wall">
              <div class="block-heading"><span>THE WALL</span><strong>${String(state.posts.length).padStart(2, '0')}</strong></div>
              ${state.posts.map(renderPost).join('')}
              <div class="composer"><input data-testid="wall-input" value="${valueAttribute(state.wallDraft)}" placeholder="Say something as ${escapeHtml(state.persona.name)}…"><button data-testid="wall-send" ${state.busy || !state.wallDraft.trim() ? 'disabled' : ''}>Send ↗</button></div>
            </div>
          </div>
          <aside class="guest-panel" data-testid="guest-list">
            <div class="block-heading"><span>WHO’S IN</span><strong>${going}</strong></div>
            <div class="rsvp-actions" data-testid="rsvp-actions">
              ${mine?.status === 'host'
                ? '<div class="host-note">You’re hosting this one ✦</div>'
                : RSVP_STATUSES.map((status) => `<button data-status="${status}" data-testid="rsvp-${status}" ${state.busy ? 'disabled' : ''} class="${mine?.status === status ? 'selected' : ''}">${escapeHtml(statusLabel(status))}</button>`).join('')}
            </div>
            <div class="guest-list">${state.guests.map(renderGuest).join('')}</div>
            <div class="provider-note"><span>${escapeHtml(configuredBackend)}</span>${provider.transport === 'push' ? 'streamed live' : 'refreshed every second'}</div>
          </aside>
        </div>
      </section>`;
  };

  const render = () => {
    root.innerHTML = `<div class="app-shell">${renderNav()}<main>${state.view.kind === 'feed' ? renderFeed() : renderEvent()}</main></div>`;
    wireInteractions();
  };

  const showCurrentError = (error, generation) => {
    if (generation !== scope.generation) return;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  };

  const watch = (name, args, applyRows, generation) => {
    void scope.watch(
      (observer) => provider.subscribe(name, args, state.persona.userId, observer),
      (rows, connection, delivery) => {
        if (name === 'listEvents' || name === 'eventDetails') state.connection = connection;
        if (delivery.kind === 'error') {
          showCurrentError(delivery.error?.message ?? delivery.error, generation);
          return;
        }
        if (delivery.kind === 'authoritative') {
          applyRows(rows);
          if (rows.length > 0) markStartup('first-authoritative-snapshot');
        }
        render();
      },
    ).catch((error) => showCurrentError(error, generation));
  };

  const mountFeed = () => {
    const generation = scope.renew();
    state.view = { kind: 'feed' };
    state.events = [];
    state.connection = 'connecting';
    state.error = '';
    render();
    watch('listEvents', {}, (rows) => { state.events = rows; }, generation);
  };

  const mountEvent = (eventId) => {
    const generation = scope.renew();
    state.view = { kind: 'event', id: eventId };
    state.eventRows = [];
    state.guests = [];
    state.posts = [];
    state.connection = 'connecting';
    state.error = '';
    render();
    watch('eventDetails', { eventId }, (rows) => { state.eventRows = rows; }, generation);
    watch('guestList', { eventId }, (rows) => { state.guests = rows; }, generation);
    watch('eventWall', { eventId }, (rows) => { state.posts = rows; }, generation);
  };

  const submitCreate = async () => {
    const title = state.createDraft.title.trim();
    const locationValue = state.createDraft.location.trim();
    if (!title || !locationValue || state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      const eventId = await provider.mutate('createEvent', {
        ...state.createDraft,
        title,
        location: locationValue,
        startsAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
        hostName: state.persona.name,
        accent: ['tangerine', 'cobalt', 'orchid'][state.events.length % 3],
      }, state.persona.userId);
      state.busy = false;
      mountEvent(eventId);
    } catch (error) {
      state.busy = false;
      state.error = error instanceof Error ? error.message : String(error);
      render();
    }
  };

  const respond = async (status) => {
    if (state.view.kind !== 'event' || state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      await provider.mutate('rsvp', {
        eventId: state.view.id,
        guestName: state.persona.name,
        status,
      }, state.persona.userId);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      render();
    }
  };

  const postMessage = async () => {
    const message = state.wallDraft.trim();
    if (state.view.kind !== 'event' || !message || state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      await provider.mutate('postMessage', {
        eventId: state.view.id,
        authorName: state.persona.name,
        message,
        createdAt: Date.now(),
      }, state.persona.userId);
      state.wallDraft = '';
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      render();
    }
  };

  function wireInteractions() {
    root.querySelector('[data-testid="home"]')?.addEventListener('click', mountFeed);
    root.querySelector('[data-testid="back"]')?.addEventListener('click', mountFeed);
    for (const button of root.querySelectorAll('[data-persona]')) {
      button.addEventListener('click', () => {
        state.persona = PERSONAS.find((persona) => persona.id === button.dataset.persona) ?? PERSONAS[0];
        state.creating = false;
        mountFeed();
      });
    }
    root.querySelector('[data-testid="new-event"]')?.addEventListener('click', () => {
      state.creating = !state.creating;
      render();
    });
    for (const card of root.querySelectorAll('[data-event-id]')) {
      card.addEventListener('click', () => mountEvent(card.dataset.eventId));
    }
    const draftInputs = [
      ['create-emoji', 'emoji'],
      ['create-title', 'title'],
      ['create-location', 'location'],
      ['create-description', 'description'],
    ];
    for (const [testId, field] of draftInputs) {
      root.querySelector(`[data-testid="${testId}"]`)?.addEventListener('input', (event) => {
        state.createDraft[field] = event.currentTarget.value;
        const submit = root.querySelector('[data-testid="create-submit"]');
        if (submit) submit.disabled = state.busy || !state.createDraft.title.trim() || !state.createDraft.location.trim();
      });
    }
    root.querySelector('[data-testid="create-submit"]')?.addEventListener('click', () => void submitCreate());
    for (const button of root.querySelectorAll('[data-status]')) {
      button.addEventListener('click', () => void respond(button.dataset.status));
    }
    const wallInput = root.querySelector('[data-testid="wall-input"]');
    wallInput?.addEventListener('input', (event) => {
      state.wallDraft = event.currentTarget.value;
      const send = root.querySelector('[data-testid="wall-send"]');
      if (send) send.disabled = state.busy || !state.wallDraft.trim();
    });
    wallInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void postMessage();
    });
    root.querySelector('[data-testid="wall-send"]')?.addEventListener('click', () => void postMessage());
  }

  globalThis.partifulMatrixDebug = { snapshot, goHome: mountFeed, startupMilestones };
  globalThis.addEventListener('pagehide', () => scope.close(), { once: true });
  mountFeed();
  markStartup('ui-mounted');
  return {
    backend: provider.backend,
    authoring: 'vanilla',
    artifactHash: snapbackArtifactHash,
    provider,
  };
}

const ready = boot().catch((error) => {
  console.error('[partiful-matrix/vanilla] boot failed', error);
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div class="boot-error"><b>This cell could not reach its backend.</b><span>${escapeHtml(error)}</span></div>`;
  throw error;
});

globalThis.partifulMatrixReady = ready;
