// Executable authority-transition policy shared by headless and UI adapters.
//
// @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — keep the five-state classifier, closed terminal vocabulary, and generated W2 rows in one importable artifact.

export const CLIENT_AUTHORITY_STATES = Object.freeze([
  'anonymous',
  'authenticating',
  'authenticated',
  'revoking',
  'reconnecting',
]);

export const CLIENT_AUTHORITY_TRANSITION_EVENTS = Object.freeze([
  'anonymous-to-authenticated',
  'authenticated-to-anonymous',
  'authenticated-to-different-user',
  'same-user-new-session',
  'incarnation-change',
  'watch-reload',
  'reconnect-during-transition',
  'unmount-remount-across-barrier',
  'late-predecessor-delivery',
]);

export const CLIENT_AUTHORITY_OPERATION_TIMINGS = Object.freeze([
  'armed-before',
  'pre-clearing',
  'clearing-to-commit',
  'commit-to-resume',
  'after-settle',
]);

export const CLIENT_AUTHORITY_TERMINALS = Object.freeze([
  'admit',
  'join',
  'queue',
  'refuse',
  'blocked',
  'blank-successor',
  'retain-stale',
  'drain-active',
  'drain-suspended',
  'project',
  'provider-wait',
  'provider-teardown-rearm',
  'provider-retain',
]);

const cell = (terminal, observable = {}) => Object.freeze({
  terminal,
  observable: Object.freeze({ ...observable }),
});

const MATRIX = Object.freeze({
  'one-shot-anonymous': Object.freeze({
    anonymous: cell('admit'),
    authenticating: cell('join', { transitionOwner: 'auth-coordinator', transport: 'none-before-settle' }),
    authenticated: cell('admit'),
    revoking: cell('join', { transitionOwner: 'auth-coordinator', reEvaluate: true }),
    reconnecting: cell('admit', { retry: 'bounded-client-owned', waitObservable: true }),
  }),
  'one-shot-authenticated': Object.freeze({
    anonymous: cell('refuse', { code: 'SNAPBACK_AUTH_REQUIRED', transport: 'zero' }),
    authenticating: cell('join', { transitionOwner: 'auth-coordinator', reEvaluate: true }),
    authenticated: cell('admit'),
    revoking: cell('join', { transitionOwner: 'auth-coordinator', reEvaluate: true }),
    reconnecting: cell('admit', { retry: 'bounded-client-owned', modePendingTerminal: false }),
  }),
  'live-optional-user': Object.freeze({
    anonymous: cell('admit', { authority: 'anonymous' }),
    authenticating: cell('blank-successor', { successors: 1, transitionOwner: 'auth-coordinator' }),
    authenticated: cell('admit', { authority: 'authenticated' }),
    revoking: cell('blank-successor', { successors: 1, transitionOwner: 'auth-coordinator' }),
    reconnecting: cell('retain-stale', { resync: true }),
  }),
  'live-authenticated': Object.freeze({
    anonymous: cell('blocked', { reason: 'authentication-required', transitionOwner: 'auth-coordinator' }),
    authenticating: cell('blank-successor', { successors: 1, transitionOwner: 'auth-coordinator' }),
    authenticated: cell('admit'),
    revoking: cell('blank-successor', { successors: 1, transitionOwner: 'auth-coordinator', successorMayBlock: true }),
    reconnecting: cell('retain-stale', { resync: true }),
  }),
  'mutation-foreground': Object.freeze({
    anonymous: cell('project', { byDeclaration: { anonymous: 'admit', authenticated: 'refuse:SNAPBACK_AUTH_REQUIRED' } }),
    authenticating: cell('join', { transport: 'none-before-settle', transitionOwner: 'auth-coordinator' }),
    authenticated: cell('admit'),
    revoking: cell('join', { predecessorDisposition: 'item-5', transitionOwner: 'auth-coordinator' }),
    reconnecting: cell('queue', { reason: 'connectivity' }),
  }),
  'mutation-housekeeping': Object.freeze({
    anonymous: cell('admit', { lane: 'housekeeping', coalescing: 'latest-wins' }),
    authenticating: cell('queue', { reason: 'auth-barrier', lane: 'housekeeping' }),
    authenticated: cell('admit', { lane: 'housekeeping' }),
    revoking: cell('queue', { reason: 'auth-barrier', lane: 'housekeeping', predecessorDisposition: 'item-5' }),
    reconnecting: cell('queue', { reason: 'connectivity', lane: 'housekeeping', coalescing: 'latest-wins' }),
  }),
  'outbox-drain': Object.freeze({
    anonymous: cell('drain-active'),
    authenticating: cell('drain-suspended', { reason: 'auth-barrier', wakeup: 'level-triggered' }),
    authenticated: cell('drain-active'),
    revoking: cell('drain-suspended', { reason: 'auth-barrier', wakeup: 'level-triggered' }),
    reconnecting: cell('drain-suspended', { reason: 'connectivity' }),
  }),
  ephemeral: Object.freeze({
    anonymous: cell('admit'),
    authenticating: cell('blank-successor', { successors: 1 }),
    authenticated: cell('admit'),
    revoking: cell('blank-successor', { successors: 1 }),
    reconnecting: cell('retain-stale', { state: 'resyncing', republishActiveIntent: 1 }),
  }),
  'react-familiar': Object.freeze({
    anonymous: cell('project', { source: 'underlying-cell' }),
    authenticating: cell('project', { source: 'underlying-cell' }),
    authenticated: cell('project', { source: 'underlying-cell' }),
    revoking: cell('project', { source: 'underlying-cell' }),
    reconnecting: cell('project', { source: 'underlying-cell' }),
  }),
  provider: Object.freeze({
    anonymous: cell('provider-wait', { signal: 'settled-authority', subscribeSafe: true }),
    authenticating: cell('provider-wait', { signal: 'settled-authority', subscribeSafe: false }),
    authenticated: cell('admit', { subscribeSafe: true }),
    revoking: cell('provider-teardown-rearm', { signal: 'settled-authority', subscribeSafe: false }),
    reconnecting: cell('provider-retain', { subscribeSafe: true, resync: true }),
  }),
});

export const CLIENT_AUTHORITY_SURFACES = Object.freeze(Object.keys(MATRIX));
export const CLIENT_AUTHORITY_STATE_MATRIX = MATRIX;

function assertMember(value, members, label) {
  if (!members.includes(value)) throw new TypeError(`${label} must be one of: ${members.join(', ')}`);
}

/**
 * Ordered classifier: an active barrier always outranks reconnecting.
 */
export function classifyClientAuthorityState(input) {
  if (!input || typeof input !== 'object') throw new TypeError('authority transition classifier input is required');
  const predecessor = input.predecessor ?? null;
  const successor = input.successor ?? null;
  const barrierActive = input.barrierActive === true;
  if (barrierActive) {
    if (input.incarnationChanged === true || input.authModeChanged === true) return 'revoking';
    if (predecessor?.kind === 'session') return 'revoking';
    return 'authenticating';
  }
  if (input.reconnecting === true || input.modePending === true) return 'reconnecting';
  return successor?.kind === 'session' ? 'authenticated' : 'anonymous';
}

export function authorityTransitionCell(surface, state) {
  assertMember(surface, CLIENT_AUTHORITY_SURFACES, 'surface');
  assertMember(state, CLIENT_AUTHORITY_STATES, 'state');
  return MATRIX[surface][state];
}

function authDeclarationForSurface(surface) {
  if (surface === 'one-shot-anonymous') return 'anonymous-admissible';
  if (surface === 'one-shot-authenticated') return 'authenticated-required';
  if (surface === 'live-optional-user') return 'optional-user';
  if (surface === 'live-authenticated') return 'authenticated-required';
  if (surface === 'mutation-housekeeping') return 'declared-housekeeping';
  return 'surface-defined';
}

/** The full W2 row product; adapters filter by surface and replay these rows. */
export function generateAuthorityTransitionConformanceRows() {
  const rows = [];
  for (const surface of CLIENT_AUTHORITY_SURFACES) {
    for (const startingState of CLIENT_AUTHORITY_STATES) {
      for (const event of CLIENT_AUTHORITY_TRANSITION_EVENTS) {
        for (const operationTiming of CLIENT_AUTHORITY_OPERATION_TIMINGS) {
          const expected = authorityTransitionCell(surface, startingState);
          rows.push(Object.freeze({
            id: `${surface}/${authDeclarationForSurface(surface)}/${startingState}/${event}/${operationTiming}`,
            surface,
            authDeclaration: authDeclarationForSurface(surface),
            startingState,
            event,
            operationTiming,
            expected,
          }));
        }
      }
    }
  }
  return Object.freeze(rows);
}

export const CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS = generateAuthorityTransitionConformanceRows();
