// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — fixed,
// wipe-scoped deduplication custody survives ordinary outbox dismissal.
import { canonical } from "./canonical.js";

const REQUEST_ID = /^s2fr1-([0-9a-f]+)-([0-9a-f]{32})$/;

/** Expiry is immutable request identity, so pruning cannot make an id reusable with a later deadline. */
export function forwardingRequestId(expiresAt: number, nonce: string): string {
  const random = nonce.replaceAll("-", "").toLowerCase();
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0 || !/^[0-9a-f]{32}$/.test(random)) {
    throw new TypeError("invalid forwarding request identity");
  }
  return `s2fr1-${expiresAt.toString(16)}-${random}`;
}

export function forwardingRequestExpiry(requestId: string): number | undefined {
  const match = REQUEST_ID.exec(requestId);
  if (!match) return undefined;
  const expiresAt = Number.parseInt(match[1]!, 16);
  return Number.isSafeInteger(expiresAt) ? expiresAt : undefined;
}

/** Compact grant slice that reproduces an admitted intent and every allocated id. */
export interface ForwardingReceipt {
  requestId: string;
  followerId: string;
  payloadDigest: string;
  expiresAt: number;
  authEpoch: number;
  partitionIncarnation: string;
  grant: string;
  from: string;
  offset: number;
  count: number;
  admittedAt: number;
  acknowledged: boolean;
}

export interface ForwardingCustody {
  partitionIncarnation?: string;
  clockFloor: number;
  receipts: Record<string, ForwardingReceipt>;
}

export interface ForwardingStore {
  /** Wipe-scoped admission identity and compact deduplication receipts. */
  forwarding(): Promise<ForwardingCustody>;
}

export interface ForwardingSwap {
  forwarding?: {
    partitionIncarnation?: string;
    clockFloor?: number;
    put?: ForwardingReceipt[];
    acknowledge?: string[];
    remove?: string[];
  };
}

export interface ForwardingState {
  /** Wipe-scoped identity: takeover preserves it, a fresh partition creates another. */
  partitionIncarnation?: string;
  /** Monotonic wall-clock floor for admission and receipt pruning. */
  admissionClockFloor: number;
  forwardingReceipts: Record<string, ForwardingReceipt>;
}

export function emptyForwardingState(): ForwardingState {
  return { admissionClockFloor: 0, forwardingReceipts: {} };
}

export function normalizeForwardingState(value: Partial<ForwardingState>): ForwardingState {
  return {
    ...(value.partitionIncarnation === undefined ? {} : { partitionIncarnation: value.partitionIncarnation }),
    admissionClockFloor: value.admissionClockFloor ?? 0,
    forwardingReceipts: value.forwardingReceipts ?? {},
  };
}

/** Applies only forwarding metadata; the caller persists the enclosing store swap atomically. */
export function applyForwarding(state: ForwardingState, swap: ForwardingSwap["forwarding"]): void {
  if (!swap) return;
  const { partitionIncarnation, clockFloor, put = [], acknowledge = [], remove = [] } = swap;
  if (partitionIncarnation !== undefined) {
    if (!partitionIncarnation) throw new TypeError("partition incarnation must be non-empty");
    if (state.partitionIncarnation !== undefined && state.partitionIncarnation !== partitionIncarnation) {
      throw new TypeError("partition incarnation cannot change without a wipe");
    }
    state.partitionIncarnation = partitionIncarnation;
  }
  if (clockFloor !== undefined) {
    if (!Number.isSafeInteger(clockFloor) || clockFloor < state.admissionClockFloor) {
      throw new TypeError("admission clock floor must be a monotonic non-negative safe integer");
    }
    state.admissionClockFloor = clockFloor;
  }
  for (const requestId of remove) delete state.forwardingReceipts[requestId];
  for (const receipt of put) {
    if (forwardingRequestExpiry(receipt.requestId) !== receipt.expiresAt
      || !receipt.followerId || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)
      || !receipt.partitionIncarnation || receipt.partitionIncarnation !== state.partitionIncarnation
      || !receipt.grant || !/^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/.test(receipt.from)
      || !Number.isSafeInteger(receipt.offset) || receipt.offset < 0
      || !Number.isSafeInteger(receipt.count) || receipt.count <= 0
      || !Number.isSafeInteger(receipt.expiresAt) || !Number.isSafeInteger(receipt.admittedAt)
      || !Number.isSafeInteger(receipt.authEpoch)) throw new TypeError("invalid forwarding receipt");
    const old = state.forwardingReceipts[receipt.requestId];
    if (old && canonical(old) !== canonical(receipt)) throw new TypeError("forwarding request identity conflict");
    state.forwardingReceipts[receipt.requestId] = structuredClone(receipt);
  }
  for (const requestId of acknowledge) {
    const receipt = state.forwardingReceipts[requestId];
    if (receipt) receipt.acknowledged = true;
  }
}
