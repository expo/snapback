// Type declarations for agent-authority.mjs — the agent-credential custody
// fence (LLP 0055/0059): volatile or durable single-authority custody with
// capture/synchronize/replace/terminate barriers and transactional
// partition-owned storage.

/** Custody storages must declare independently owned side-ledger
 * partitions (the v2 partition-ownership contract). */
export const AGENT_CUSTODY_PARTITION_OWNERSHIP: 'partitioned-v2';

/** The credential facts a fence normalizes and freezes at construction.
 * All ids are UUIDv7 strings; `credentialGeneration` is a non-negative safe
 * integer; `bearerToken` is a non-empty string. */
export interface AgentAuthorityCredentialInput {
  readonly actorUserId: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly grantId: string;
  readonly tokenId: string;
  readonly bearerToken: string;
}

/** A frozen point-in-time publication capture; stale the moment any of its
 * four facts rotates. */
export interface AgentAuthorityCapture {
  readonly authorityEpoch: number;
  readonly authorityKey: string;
  readonly carrierGeneration: number;
  readonly tokenId: string;
}

/** The durable authority identity derived from the credential. */
export interface AgentDurableAuthority {
  readonly kind: 'servicePrincipal';
  readonly authMode: 'sessions';
  readonly actorUserId: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly grantId: string;
}

/** A protocol-v1 service descriptor proof from /auth/session validation. */
export interface AgentAuthorityDescriptor {
  readonly descriptorVersion: 1;
  readonly authorityInstanceId: string;
  readonly sessionGeneration: 0;
  readonly [key: string]: unknown;
}

/** A narrowly scoped carrier offer for /auth/session validation; grants no
 * capture and no publication permission. */
export interface AgentCredentialOffer {
  readonly bearer: string;
  readonly tokenId: string;
}

export interface AgentCredentialReplacementOffer extends AgentCredentialOffer {
  readonly previousCapture: AgentAuthorityCapture;
}

/** Terminal cut handle; `settlement` resolves when the cut's barrier (and,
 * for `durableDelete`, the durable tombstone) has settled. */
export interface AgentTerminalHandle {
  readonly accepted: true;
  readonly authorityDisposition: 'carrier' | 'durableDelete';
  readonly settlement: Promise<void>;
}

export type AgentTerminationDisposition =
  | 'carrier'
  | 'durableDelete'
  | Readonly<{
      authorityDisposition?: 'carrier' | 'durableDelete';
      terminalError?: unknown;
    }>;

/** Participant callbacks MUST be synchronous (agent replacement and terminal
 * loss are synchronous carrier cuts). */
export interface AgentAuthorityParticipant {
  quiesce?(context: Readonly<Record<string, unknown>>): void;
  blank?(context: Readonly<Record<string, unknown>>): void;
  clearMemory?(context: Readonly<Record<string, unknown>>): void;
}

export interface AgentCustodyScanRecord {
  readonly partitionId: string;
  readonly value: unknown;
  readonly byteLength: number;
}

export interface AgentCustodyScanPage {
  readonly records: readonly AgentCustodyScanRecord[];
  readonly nextCursor: string | null;
}

/** The per-partition owner handle passed to `withOwnership` operations.
 * Owner operations must not overlap; `replace`/`remove`/`retire` are
 * revision-checked compare-and-swap verbs. */
export interface AgentCustodyOwner {
  scanPartitions(options?: {
    readonly cursor?: string | null;
    readonly limit?: number;
  }): Promise<AgentCustodyScanPage>;
  withPartition<T>(
    partitionId: string,
    operation: (owner: AgentCustodyOwner) => T | Promise<T>,
  ): Promise<T>;
  read(): Promise<Record<string, unknown> | null>;
  replace(
    expectedRevision: number | null,
    nextValue: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
  remove(expectedRevision: number): Promise<boolean>;
  retire(expectedRevision: number | null): Promise<boolean>;
}

/** Transactional agent custody storage: one gate per partition, structured
 * ownership, and the v2 partition-ownership marker. */
export interface AgentAuthorityCustodyStorage {
  readonly partitionOwnership: 'partitioned-v2';
  readonly terminalLedgerParameters: unknown;
  terminalLedgerCheckpoint(name: string, context: unknown): Promise<void>;
  withOwnership<T>(
    custodyId: string,
    operation: (owner: AgentCustodyOwner) => T | Promise<T>,
  ): Promise<T>;
  snapshot(custodyId: string): Record<string, unknown> | null;
}

/** Deterministic transactional storage for tests and native/headless
 * adapters; share the same `state` object across fixtures to model
 * independent processes. */
export function createMemoryAgentAuthorityCustodyStorage(options?: {
  readonly state?: { custody?: Record<string, unknown> };
  readonly terminalLedgerParameters?: unknown;
  readonly terminalLedgerCheckpoint?:
    | ((name: string, context: unknown) => void | Promise<void>)
    | null;
}): AgentAuthorityCustodyStorage;

export interface AgentAuthorityFenceOptions {
  readonly storage?: AgentAuthorityCustodyStorage | null;
  readonly custodyId?: string | null;
  readonly volatileCounterCeiling?: number;
  readonly carrierCounterCeiling?: number;
  readonly barrierCounterCeiling?: number;
}

export class AgentAuthorityFence {
  constructor(
    credential: AgentAuthorityCredentialInput,
    options?: AgentAuthorityFenceOptions,
  );
  readonly hasDurableCustody: boolean;
  readonly authority: AgentDurableAuthority;
  readonly authorityDescriptor: AgentAuthorityDescriptor | null;
  /** Durable-custody terminal-ledger inspection (diagnostic surface). */
  inspectCustody(): Promise<Record<string, unknown>>;
  /** Throws when custody is not synchronized for publication. */
  capture(): AgentAuthorityCapture;
  synchronize(): Promise<AgentAuthorityCapture>;
  isCurrent(capture: AgentAuthorityCapture | null | undefined): boolean;
  /** Throws when `capture` is stale. */
  credentialFor(capture: AgentAuthorityCapture): AgentCredentialOffer;
  credentialOfferForHandshake(): AgentCredentialOffer;
  credentialOfferForReplacement(
    credential: AgentAuthorityCredentialInput,
  ): AgentCredentialReplacementOffer;
  synchronizeValidated(
    descriptor: AgentAuthorityDescriptor,
  ): Promise<AgentAuthorityCapture>;
  bindHandshake(
    capture: AgentAuthorityCapture,
    descriptor: AgentAuthorityDescriptor,
  ): AgentAuthorityCapture;
  /** Always throws: credential replacement requires server validation
   * (use `replaceCredentialValidated`). */
  replaceCredential(): never;
  replaceCredentialValidated(
    expected: AgentAuthorityCapture,
    credential: AgentAuthorityCredentialInput,
    descriptor: AgentAuthorityDescriptor,
  ): Promise<AgentAuthorityCapture>;
  terminateValidatedCredential(
    offer: AgentCredentialOffer,
    disposition?: AgentTerminationDisposition,
  ): AgentTerminalHandle | false;
  terminate(
    capture: AgentAuthorityCapture | null | undefined,
    disposition?: AgentTerminationDisposition,
  ): AgentTerminalHandle | false;
  /** The commit callback must be synchronous; it runs only while `capture`
   * is still current (and, under durable custody, while the durable record
   * still matches). */
  compareAndCommit<T>(
    capture: AgentAuthorityCapture | null | undefined,
    commit: (
      context: AgentAuthorityCapture &
        Readonly<{ authorityDescriptor: AgentAuthorityDescriptor | null }>,
    ) => T,
  ): Promise<{ committed: false } | { committed: true; value: T }>;
  /** Returns the unregister function. */
  registerParticipant(participant: AgentAuthorityParticipant): () => Promise<void>;
}
