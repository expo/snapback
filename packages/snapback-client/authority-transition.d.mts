export type ClientAuthorityState = 'anonymous' | 'authenticating' | 'authenticated' | 'revoking' | 'reconnecting';
export type ClientAuthorityTransitionEvent =
  | 'anonymous-to-authenticated'
  | 'authenticated-to-anonymous'
  | 'authenticated-to-different-user'
  | 'same-user-new-session'
  | 'incarnation-change'
  | 'watch-reload'
  | 'reconnect-during-transition'
  | 'unmount-remount-across-barrier'
  | 'late-predecessor-delivery';
export type ClientAuthorityOperationTiming = 'armed-before' | 'pre-clearing' | 'clearing-to-commit' | 'commit-to-resume' | 'after-settle';
export type ClientAuthoritySurface =
  | 'one-shot-anonymous'
  | 'one-shot-authenticated'
  | 'live-optional-user'
  | 'live-authenticated'
  | 'mutation-foreground'
  | 'mutation-housekeeping'
  | 'outbox-drain'
  | 'ephemeral'
  | 'react-familiar'
  | 'provider';
export type ClientAuthorityTerminal =
  | 'admit' | 'join' | 'queue' | 'refuse' | 'blocked' | 'blank-successor'
  | 'retain-stale' | 'drain-active' | 'drain-suspended' | 'project'
  | 'provider-wait' | 'provider-teardown-rearm' | 'provider-retain';
export interface ClientAuthorityMatrixCell {
  readonly terminal: ClientAuthorityTerminal;
  readonly observable: Readonly<Record<string, unknown>>;
}
export interface ClientAuthorityConformanceRow {
  readonly id: string;
  readonly surface: ClientAuthoritySurface;
  readonly authDeclaration: string;
  readonly startingState: ClientAuthorityState;
  readonly event: ClientAuthorityTransitionEvent;
  readonly operationTiming: ClientAuthorityOperationTiming;
  readonly expected: ClientAuthorityMatrixCell;
}
export const CLIENT_AUTHORITY_STATES: readonly ClientAuthorityState[];
export const CLIENT_AUTHORITY_TRANSITION_EVENTS: readonly ClientAuthorityTransitionEvent[];
export const CLIENT_AUTHORITY_OPERATION_TIMINGS: readonly ClientAuthorityOperationTiming[];
export const CLIENT_AUTHORITY_SURFACES: readonly ClientAuthoritySurface[];
export const CLIENT_AUTHORITY_TERMINALS: readonly ClientAuthorityTerminal[];
export const CLIENT_AUTHORITY_STATE_MATRIX: Readonly<Record<ClientAuthoritySurface, Readonly<Record<ClientAuthorityState, ClientAuthorityMatrixCell>>>>;
export const CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS: readonly ClientAuthorityConformanceRow[];
export function authorityTransitionCell(surface: ClientAuthoritySurface, state: ClientAuthorityState): ClientAuthorityMatrixCell;
export function generateAuthorityTransitionConformanceRows(): readonly ClientAuthorityConformanceRow[];
export function classifyClientAuthorityState(input: Readonly<{
  predecessor?: Readonly<{ kind: 'anonymous' | 'session' }> | null;
  successor?: Readonly<{ kind: 'anonymous' | 'session' }> | null;
  barrierActive?: boolean;
  incarnationChanged?: boolean;
  authModeChanged?: boolean;
  reconnecting?: boolean;
  modePending?: boolean;
}>): ClientAuthorityState;
