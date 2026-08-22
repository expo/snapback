export type ClientAuthorityState = 'anonymous' | 'authenticating' | 'authenticated' | 'revoking' | 'reconnecting';
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
  | 'admit' | 'queue' | 'refuse' | 'blocked' | 'blank-successor'
  | 'retain-stale' | 'drain-active' | 'drain-suspended' | 'project'
  | 'provider-wait' | 'provider-teardown-rearm' | 'provider-retain';
export interface ClientAuthorityMatrixCell {
  readonly terminal: ClientAuthorityTerminal;
  readonly observable: Readonly<Record<string, unknown>>;
}
export const CLIENT_AUTHORITY_STATES: readonly ClientAuthorityState[];
export const CLIENT_AUTHORITY_SURFACES: readonly ClientAuthoritySurface[];
export const CLIENT_AUTHORITY_TERMINALS: readonly ClientAuthorityTerminal[];
export const CLIENT_AUTHORITY_STATE_MATRIX: Readonly<Record<ClientAuthoritySurface, Readonly<Record<ClientAuthorityState, ClientAuthorityMatrixCell>>>>;
export function authorityTransitionCell(surface: ClientAuthoritySurface, state: ClientAuthorityState): ClientAuthorityMatrixCell;
export function classifyClientAuthorityState(input: Readonly<{
  current?: Readonly<{ kind: 'anonymous' | 'session' }> | null;
  predecessor?: Readonly<{ kind: 'anonymous' | 'session' }> | null;
  successor?: Readonly<{ kind: 'anonymous' | 'session' }> | null;
  barrierActive?: boolean;
  incarnationChanged?: boolean;
  authModeChanged?: boolean;
  reconnecting?: boolean;
  modePending?: boolean;
}>): ClientAuthorityState;
