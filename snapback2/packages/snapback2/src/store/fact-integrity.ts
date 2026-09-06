// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — execution clocks never change durable fact identity.
import { sha256 } from '../../../evaluator/src/hash.js';
import { canonical } from './canonical.js';
import type { PersistedRangeState, StoreDelivery, StoredAnswer } from './range-store.js';
export type FactProof = [key: string, digest: string];
export class ClockCoverageReset extends Error {
  readonly clockCoverageReset = true;
  static is(error: unknown): error is ClockCoverageReset { return (error as ClockCoverageReset)?.clockCoverageReset === true; }
  constructor(readonly exhausted = false) { super(exhausted ? 'timed fact custody exceeds its slot budget' : 'timed coverage requires authenticated revalidation'); }
}
export class FullRevalidationRequired extends Error {
  readonly fullRevalidationRequired = true;
  static is(error: unknown): error is FullRevalidationRequired { return (error as FullRevalidationRequired)?.fullRevalidationRequired === true; }
  constructor(readonly op: string, readonly args: unknown) { super('conditional reply requires immutable full-envelope facts'); }
}
export const FACT_SLOT_LIMIT = 524288;
export const rowFactKey = (table: string, id: string) => canonical(['row', table, { Id: id }]);
export const verdictFactKey = (v: any) => canonical(['verdict', v.ruleHash, v.pinnedInputsDigest, { Id: v.principal }, v.authEpoch]);
export const negativeProof = (table: string, id: string): FactProof => [rowFactKey(table, id), sha256('absent')];
export function deliveryFacts(delivery: StoreDelivery): FactProof[] {
  const facts = new Map<string, string>();
  const add = ([key, digest]: FactProof) => {
    if (facts.has(key) && facts.get(key) !== digest) throw new TypeError('conflicting facts in one delivery');
    facts.set(key, digest);
  };
  for (const row of delivery.rows ?? []) add([rowFactKey(row.table, row.id), sha256(canonical(row.row))]);
  const receipt = delivery.receiptEvidence ?? delivery.receipt;
  for (const [table, index, values] of receipt?.absences ?? []) if (index === 'byId' && typeof values[0] === 'string') add(negativeProof(table, values[0]));
  for (const verdict of receipt?.verdicts ?? []) add([verdictFactKey(verdict), sha256(canonical((verdict as any).result))]);
  return [...facts];
}
export function guardFacts(state: PersistedRangeState, proofs: FactProof[], seq: number, track = false, enroll?: (key: string) => void): FactProof[] {
  const retained: FactProof[] = [];
  for (const [key, digest] of proofs) {
    const old = state.factGuards[key];
    if (old?.seq === seq && old.digest !== digest) throw new TypeError(`conflicting durable fact at seq ${seq}`);
    if (!old && !track) continue;
    if (!old) { enroll?.(key); state.factSlots++; }
    if (!old || old.seq <= seq) state.factGuards[key] = { seq, digest };
    retained.push([key, digest]);
  }
  return retained;
}
export const proofSlots = (answer?: StoredAnswer) => (answer?.factProofs?.length ?? 0) + Number(!!answer?.needsFactProofs);
export function answerFactKeys(answer: StoredAnswer): Set<string> {
  return new Set([...answer.refs.map(r => rowFactKey(r.table, r.id)),
    ...(answer.receipt?.absences ?? []).flatMap(([table, index, values]) => index === 'byId' && typeof values[0] === 'string' ? [rowFactKey(table, values[0])] : []),
    ...(answer.receipt?.verdicts ?? []).map(verdictFactKey)]);
}
export function checkFactSlots(state: PersistedRangeState): void { if (state.factSlots > FACT_SLOT_LIMIT) throw new ClockCoverageReset(true); }
export function validateClock(value: { readTime?: number; clockPlanHash?: string }): void {
  if (value.readTime === undefined && value.clockPlanHash === undefined) return;
  if (!Number.isSafeInteger(value.readTime) || Object.is(value.readTime, -0) || !/^[0-9a-f]{64}$/.test(value.clockPlanHash ?? ''))
    throw new TypeError('invalid execution clock identity');
}
export const sameClockPlan = (old: StoredAnswer | undefined, next: StoreDelivery): old is StoredAnswer =>
  old?.fingerprint !== undefined && old.readTime !== undefined && next.readTime !== undefined && old.clockPlanHash === next.clockPlanHash;
