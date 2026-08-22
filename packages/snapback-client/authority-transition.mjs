// Executable authority-transition policy shared by headless and UI adapters.
//
// @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — keep the five-state vocabulary and independently transcribed 50-cell policy in one importable artifact.

export { classifyClientAuthorityState } from '@expo/snapback-contract/auth-coordinator';

export const CLIENT_AUTHORITY_STATES = Object.freeze([
  'anonymous',
  'authenticating',
  'authenticated',
  'revoking',
  'reconnecting',
]);

export const CLIENT_AUTHORITY_TERMINALS = Object.freeze([
  'admit',
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
    authenticating: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transitionOwner: 'auth-coordinator', transport: 'zero' }),
    authenticated: cell('admit'),
    revoking: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transitionOwner: 'auth-coordinator', transport: 'zero' }),
    reconnecting: cell('admit', { retry: 'bounded-client-owned', waitObservable: true }),
  }),
  'one-shot-authenticated': Object.freeze({
    anonymous: cell('refuse', { code: 'SNAPBACK_AUTH_REQUIRED', transport: 'zero' }),
    authenticating: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transitionOwner: 'auth-coordinator', transport: 'zero' }),
    authenticated: cell('admit'),
    revoking: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transitionOwner: 'auth-coordinator', transport: 'zero' }),
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
    authenticating: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transport: 'zero', transitionOwner: 'auth-coordinator' }),
    authenticated: cell('admit'),
    revoking: cell('refuse', { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING', transport: 'zero', predecessorDisposition: 'item-5', transitionOwner: 'auth-coordinator' }),
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

export function authorityTransitionCell(surface, state) {
  assertMember(surface, CLIENT_AUTHORITY_SURFACES, 'surface');
  assertMember(state, CLIENT_AUTHORITY_STATES, 'state');
  return MATRIX[surface][state];
}
