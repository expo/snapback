// Type declarations for operator-authority-transaction.mjs — the only bridge
// between operator replay state and the canonical standing-supervisor database
// (SQLite -> mirror -> anchor commit boundary; no second writer).

import type { HostedSupervisor } from './index.mjs';
import type {
  SupervisorRequestV1,
  SupervisorOperatorAuthorityState,
  VerifySpecialAuthority,
} from './operator-authority.mjs';

export interface OperatorAuthorityTransactionResult {
  readonly response: unknown;
  /** true when a new canonical generation was committed; false on exact replay. */
  readonly committed: boolean;
  readonly generation: number;
  readonly operatorAuthoritySha256: `sha256:${string}`;
}

export interface OperatorAuthorityReservationResult {
  readonly state: 'terminal' | 'reserved';
  readonly response: unknown;
  readonly recovered: boolean;
  readonly committed: boolean;
  readonly generation: number;
  readonly operatorAuthoritySha256: `sha256:${string}`;
}

/** Admit, execute, retain, and commit one ordinary (synchronous) operator request. */
export function executeOperatorAuthorityTransaction(
  supervisor: HostedSupervisor,
  request: SupervisorRequestV1,
  options?: Readonly<{
    nowMs?: number;
    execute?: (input: {
      request: SupervisorRequestV1;
      state: SupervisorOperatorAuthorityState;
    }) => unknown;
    verifySpecialAuthority?: VerifySpecialAuthority;
  }>,
): OperatorAuthorityTransactionResult;

/**
 * Async form for bounded provider reads/effects. Authorization and durable
 * reservation persistence complete before `execute` starts.
 */
export function executeOperatorAuthorityTransactionAsync(
  supervisor: HostedSupervisor,
  request: SupervisorRequestV1,
  options?: Readonly<{
    nowMs?: number;
    execute?: (input: { request: SupervisorRequestV1 }) => unknown | Promise<unknown>;
    verifySpecialAuthority?: VerifySpecialAuthority;
    persistReservation?: (
      supervisor: HostedSupervisor,
      receipt: { committed: boolean; recovered: boolean },
    ) => unknown | Promise<unknown>;
  }>,
): Promise<OperatorAuthorityTransactionResult>;

export function reserveOperatorAuthorityTransaction(
  supervisor: HostedSupervisor,
  request: SupervisorRequestV1,
  options?: Readonly<{
    nowMs?: number;
    verifySpecialAuthority?: VerifySpecialAuthority;
  }>,
): OperatorAuthorityReservationResult;

export function settleOperatorAuthorityTransaction(
  supervisor: HostedSupervisor,
  request: SupervisorRequestV1,
  response: unknown,
  options?: Readonly<{ nowMs?: number }>,
): OperatorAuthorityTransactionResult;

export const __operatorAuthorityTransactionTest: Readonly<{
  JOURNAL_SCHEMA_VERSION: 'snapback.supervisor-operator-journal-entry.v1';
  snapshotDigest: (snapshot: unknown) => `sha256:${string}`;
}>;
