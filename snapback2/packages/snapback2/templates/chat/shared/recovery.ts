import { useCallback, useMemo, useReducer, useRef } from "react";
import type { SnapbackClient } from "snapback2/client";

export interface RecoveryAction {
  conversationId: string;
  draft?: string;
}

/** One account-owned slot serializes a mutation and its unresolved receipt. */
export interface RecoveryCustody<Unknown> {
  readonly active?: RecoveryAction;
  readonly unknown?: Unknown;
  begin(action: RecoveryAction): object | undefined;
  beginRecovery(expected: Unknown, action: RecoveryAction): object | undefined;
  hold(token: object, value: Unknown): boolean;
  finish(token: object): boolean;
  resolve(token: object, expected: Unknown): boolean;
}

type Cell<Unknown> = {
  account: object;
  action?: RecoveryAction & { token: object };
  unknown?: Unknown;
};

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the
// stable screen owner holds one exact recovery identity across child remounts;
// an earlier auth generation cannot publish into its successor.
export function useAccountRecoveryCustody<Unknown>(
  client: SnapbackClient,
  generation: number,
): RecoveryCustody<Unknown> {
  const account = useMemo(() => ({}), [client, generation]);
  const cell = useRef<Cell<Unknown>>({ account });
  if (cell.current.account !== account) cell.current = { account };
  const [version, changed] = useReducer((value: number) => value + 1, 0);
  const mutate = useCallback((update: (current: Cell<Unknown>) => boolean) => {
    if (cell.current.account !== account || client.snapshot.authGeneration !== generation) return false;
    if (!update(cell.current)) return false;
    changed();
    return true;
  }, [account, client, generation]);
  return useMemo(() => ({
    active: cell.current.action,
    unknown: cell.current.unknown,
    begin(action: RecoveryAction) {
      if (cell.current.account !== account || cell.current.action || cell.current.unknown
        || client.snapshot.authGeneration !== generation) return undefined;
      const token = {};
      cell.current.action = { ...action, token };
      changed();
      return token;
    },
    beginRecovery(expected: Unknown, action: RecoveryAction) {
      if (cell.current.account !== account || cell.current.action || cell.current.unknown !== expected
        || client.snapshot.authGeneration !== generation) return undefined;
      const token = {};
      cell.current.action = { ...action, token };
      changed();
      return token;
    },
    hold: (token: object, value: Unknown) => mutate((current) => {
      if (current.action?.token !== token) return false;
      current.action = undefined;
      current.unknown = value;
      return true;
    }),
    finish: (token: object) => mutate((current) => {
      if (current.action?.token !== token) return false;
      current.action = undefined;
      return true;
    }),
    resolve: (token: object, expected: Unknown) => mutate((current) => {
      if (current.action?.token !== token || current.unknown !== expected) return false;
      current.action = undefined;
      current.unknown = undefined;
      return true;
    }),
  }), [account, client, generation, mutate, version]);
}
