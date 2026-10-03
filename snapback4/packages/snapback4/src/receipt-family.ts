import type { Mutation, Query } from "./contract.ts";

/** Emitted from a Quarry receipts clause; never infer operation or field names.
 * This binding groups handles, not read authority. Read bare retained history
 * independently from live receipts/decorations. It does not report delivery.
 * @see LLP 3000.032 §4.3; LLP 3000.022 §14
 */
export interface ReceiptFamily<M extends { id: string; pending?: boolean }, S extends string, T extends string> {
  readonly name: string;
  readonly fingerprint: string;
  readonly member: Query<Record<S, string>, M | null>;
  readonly seen: Mutation<Record<S, string> & Record<T, number>, null>;
  readonly scopeArgument: S;
  readonly throughArgument: T;
  readonly mapping: {
    readonly scope: string; readonly counter: string;
    readonly messages: string; readonly messageGroup: string; readonly position: string;
    readonly sender: string; readonly count: string; readonly members: string;
    readonly memberGroup: string; readonly principal: string; readonly runs: string;
    readonly floor: keyof M & string; readonly delivered: keyof M & string; readonly seen: keyof M & string;
  };
}
