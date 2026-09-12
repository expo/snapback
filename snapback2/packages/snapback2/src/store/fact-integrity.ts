import { RowImage } from '../../../evaluator/src/row-image.js';
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — execution clocks never change durable fact identity.
import { isSha256, sha256 } from '../../../evaluator/src/hash.js';
import { canonical } from './canonical.js';
import type { PersistedRangeState, StoreDelivery, StoredAnswer, StoredRow } from './range-store.js';
import type { CarrierIndex } from './carrier-index.js';
import { type ExtentCondition, type ExtentProof, type KeyImage } from './extent-facts.js';
import { ExtentIndex } from './extent-index.js';
import type { FactIndex } from './fact-index.js';
export type FactProof = [key: string, digest: string];
/** Swap-owned body and meaning; only keys enter the retained fact image pool. */
export type PreparedImage = { key: string; digest: string; imageId: string; row: StoredRow; keys: KeyImage | undefined };
export class ClockCoverageReset extends Error {
  readonly clockCoverageReset = true;
  static is(error: unknown): error is ClockCoverageReset { return (error as ClockCoverageReset)?.clockCoverageReset === true; }
  constructor(readonly exhausted = false) { super(exhausted ? 'fact custody exceeds its slot budget' : 'coverage requires authenticated revalidation'); }
}
export class FullRevalidationRequired extends Error {
  readonly fullRevalidationRequired = true;
  static is(error: unknown): error is FullRevalidationRequired { return (error as FullRevalidationRequired)?.fullRevalidationRequired === true; }
  constructor(readonly op: string, readonly args: unknown) { super('conditional reply requires immutable full-envelope facts'); }
}
export const FACT_SLOT_LIMIT = 524288;
export const FACT_FORMAT = 5;
const absentDigest = sha256('absent');
export const rowFactKey = (table: string, id: string) => `${table}\0${id}`;
export function factRow(key: string): { table: string; id: string } | undefined {
  const at = key.indexOf('\0'); return at < 0 ? undefined : { table: key.slice(0,at),id: key.slice(at+1) };
}
export const verdictFactKey = (v: any) => canonical(['verdict', v.ruleHash, v.pinnedInputsDigest, { Id: v.principal }, v.authEpoch]);
export const negativeProof = (table: string, id: string): FactProof => [rowFactKey(table, id), absentDigest];
export const factImageId = ([key, digest]: FactProof) => key.includes('\0') && digest !== absentDigest
  ? `${factRow(key)!.table}\0${digest}` : undefined;
export type FactGuard = { seq: number; digest: string };
/** A number is an explicit primary absence, including sequence zero. */
export function factGuard(state: PersistedRangeState, key: string): FactGuard | undefined {
  const value = key.includes('\0') ? state.rowFacts[key] : state.verdictFacts[key];
  return value === undefined ? undefined : typeof value === 'number' ? { seq: value,digest: absentDigest } : { seq: value[0],digest: value[1] };
}
function putGuard(state: PersistedRangeState, key: string, seq: number, digest: string): void {
  if (key.includes('\0')) state.rowFacts[key] = digest === absentDigest ? seq : [seq,digest];
  else state.verdictFacts[key] = [seq,digest];
}
export function answerProof(answer: StoredAnswer | undefined, key: string): string | undefined {
  const value = key.includes('\0') ? answer?.rowProofs?.[key] : answer?.verdictProofs?.[key];
  return value === null ? absentDigest : value;
}
export function answerProofs(answer?: StoredAnswer): FactProof[] {
  return [...Object.entries(answer?.rowProofs ?? {}).map(([key,digest]): FactProof => [key,digest === null ? absentDigest : digest]),
    ...Object.entries(answer?.verdictProofs ?? {})];
}
export function storedProofs(proofs: Iterable<FactProof>): Pick<StoredAnswer,'rowProofs'|'verdictProofs'> {
  const rowProofs: Record<string,string|null> = {}, verdictProofs: Record<string,string> = {};
  for (const [key,digest] of proofs) {
    if (key.includes('\0')) rowProofs[key] = digest === absentDigest ? null : digest; else verdictProofs[key] = digest;
  }
  return { rowProofs,verdictProofs };
}
export const factAssertion = (row: StoredRow): string => RowImage.is(row.row) ? RowImage.digest(row.row) : sha256(canonical(row.row));
export const imageSlots = (keys?: KeyImage): number => 1 + Object.values(keys ?? {}).reduce((sum,parts) =>
  sum + 1 + parts.length + parts.reduce((n,part) => n + ('Words' in part ? part.Words.length : 0),0),0);
export const extentSlots = (condition: ExtentCondition): number => 1 + condition.present.length + condition.prefix.length
  + ['after','before','gt','gte','lt','lte','first','last'].reduce((n,key) => n + ((condition as any)[key]?.length ?? 0),0);
const extentMeanings = new WeakMap<object,string>();
function exactExtentMeaning(condition: ExtentCondition): string {
  const { present: _present,...meaning } = condition; return canonical(meaning);
}
export function extentMeaning(condition: ExtentCondition): string {
  let key = extentMeanings.get(condition);
  if (!key) { key = sha256(exactExtentMeaning(condition)); extentMeanings.set(condition,key); }
  return key;
}
export function deliveryFacts(delivery: StoreDelivery, images: PreparedImage[]): FactProof[] {
  const facts = new Map<string, string>();
  const add = ([key, digest]: FactProof) => {
    if (facts.has(key) && facts.get(key) !== digest) throw new TypeError('conflicting facts in one delivery');
    facts.set(key, digest);
  };
  for (const image of images) add([image.key, image.digest]);
  const receipt = delivery.receiptEvidence ?? delivery.receipt;
  for (const [table, index, values] of receipt?.absences ?? []) if (index === 'byId' && typeof values[0] === 'string') add(negativeProof(table, values[0]));
  for (const verdict of receipt?.verdicts ?? []) add([verdictFactKey(verdict), sha256(canonical((verdict as any).result))]);
  return [...facts];
}
/** One swap's immutable equality boundary. Seed each touched key lazily from its
 * pre-swap guard; later durable sequences cannot erase an earlier contradiction. */
export class FactTransaction {
  private seen = new Map<string, Map<number, string>>();
  private incoming: FactIndex;
  private incomingExtents = new ExtentIndex();
  private extentSeen = new Set<string>();
  private images = new Map<string, PreparedImage>();
  private touchedImages = new Set<string>();
  private touchedExtents = new Set<string>();
  constructor(private state: PersistedRangeState, private enroll: (key: string) => void,
    private index: CarrierIndex, private missing: (key: string, digest: string, seq: number) => never,
    private answer: (owner: string) => StoredAnswer | undefined,
    private enrollExtent: (condition: ExtentCondition) => void) { this.incoming = index.newFacts(); }
  prepare(row: StoredRow): PreparedImage {
    const key = rowFactKey(row.table,row.id), digest = factAssertion(row), imageId = factImageId([key,digest])!;
    let image = this.images.get(imageId);
    if (image) {
      // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — only an actual collision needs body text; nominal immutable identity already proves equality.
      if (image.key !== key || (image.row !== row && !(RowImage.is(row.row) && image.row.row === row.row)
        && canonical(image.row.row) !== canonical(row.row))) throw new TypeError('conflicting immutable image identity');
    } else {
      image = { key,digest,imageId,row,keys: this.index.keyImage(row,imageId) }; this.images.set(imageId,image);
    }
    return image;
  }
  register(rows: StoredRow[], seq: number): PreparedImage[] {
    return rows.map(row => {
      const image = this.prepare(row); this.indexPositive(image.key,image.digest,seq,image.keys); return image;
    });
  }
  private indexPositive(key: string, digest: string, seq: number, keys?: KeyImage): void {
    const id = canonical([key,digest,seq]); if (this.incoming.get(id)) return;
    const { table,id: rowId } = factRow(key)!;
    this.incoming.change({ id,key,digest,seq,table,rowId,keys },1);
  }
  private image(proof: FactProof) {
    const id = factImageId(proof); if (!id) return;
    if (!this.state.factImages[id]) { this.state.factImages[id] = { refs: 0 }; this.state.factSlots++; }
    this.touchedImages.add(id);
    const image = this.state.factImages[id], keys = this.images.get(id)?.keys;
    if (!image.keys && keys) {
      image.keys = keys; this.state.factSlots += imageSlots(keys) - 1;
    }
    return image;
  }
  private imageRefs(proof: FactProof, delta: number): void {
    const image = this.image(proof); if (image && delta) image.refs += delta;
  }
  private seed(key: string): Map<number, string> {
    let facts = this.seen.get(key);
    if (!facts) {
      const old = factGuard(this.state,key); facts = new Map(old ? [[old.seq, old.digest]] : []);
      for (const owner of this.index.proofOwners.get(key) ?? []) {
        const answer = this.answer(owner), digest = answerProof(answer,key);
        if (digest !== undefined) facts.set(answer!.seq, digest);
      }
      this.seen.set(key, facts);
    }
    return facts;
  }
  check(proofs: FactProof[], seq: number, track = false): FactProof[] {
    const retained: FactProof[] = [];
    for (const [key, digest] of proofs) {
      const old = factGuard(this.state,key);
      const image = factImageId([key,digest]);
      // Explicit primary absence/tombstone is a global fact, independently of
      // whether an indexed query has already enrolled this row.
      let indexed = key.includes('\0') && digest === absentDigest;
      if (image) {
        const keys = this.images.get(image)?.keys ?? this.state.factImages[image]?.keys;
        const { table,id: rowId } = factRow(key)!;
        if (!keys && (this.index.closed.has(table) || this.incomingExtents.has(table))) this.missing(key,digest,seq);
        if (keys) {
          for (const index of [this.index.closed,this.incomingExtents]) for (const extent of index.matching(table,keys,0)) {
            indexed = true;
            if (extent.seq === seq && !extent.condition.present.includes(rowId)) throw new TypeError(`conflicting durable fact at seq ${seq}`);
          }
        }
      }
      if (!old && !track && !indexed) continue;
      const facts = this.seed(key);
      if (facts.has(seq) && facts.get(seq) !== digest) throw new TypeError(`conflicting durable fact at seq ${seq}`);
      facts.set(seq, digest);
      if (image) this.indexPositive(key,digest,seq,this.image([key,digest])?.keys);
      if (!old) { this.enroll(key); this.state.factSlots++; }
      if (!old || old.seq <= seq) {
        if (!old || old.digest !== digest) {
          this.imageRefs([key, digest], 1); if (old) this.imageRefs([key, old.digest], -1);
        } else this.image([key, digest]);
        putGuard(this.state,key,seq,digest);
      }
      retained.push([key, digest]);
    }
    return retained;
  }
  close(condition: ExtentCondition, seq: number): ExtentProof {
    const present = new Set(condition.present);
    for (const index of [this.index.positives,this.incoming]) {
      const unknown = index.opaque(condition.table,seq);
      if (unknown) this.missing(unknown.key,unknown.digest,seq);
      for (const fact of index.matching(condition,seq)) if (!present.has(fact.rowId)) throw new TypeError(`conflicting durable fact at seq ${seq}`);
    }
    // A currently held immutable image also establishes existence at its own rowSeq.
    // It is never promoted to an answer's conditional sequence or reconstructed after GC.
    for (const fact of this.index.live.matching(condition)) {
      this.enroll(fact.key);
      const { table,id } = factRow(fact.key)!;
      if (fact.seq === seq && this.index.proven(table,id,seq) && !present.has(id)) throw new TypeError(`conflicting durable fact at seq ${seq}`);
    }
    const exact = canonical(condition), id = sha256(exact), key = extentMeaning(condition);
    if (this.state.factExtents[id] && canonical(this.state.factExtents[id].condition) !== exact)
      throw new TypeError('conflicting immutable extent identity');
    if (!this.state.factExtents[id]) { this.state.factExtents[id] = { refs: 0, condition }; this.state.factSlots += extentSlots(condition); }
    this.touchedExtents.add(id);
    const old = this.state.extentGuards[key];
    if (old && exactExtentMeaning(this.state.factExtents[old.id].condition) !== exactExtentMeaning(condition))
      throw new TypeError('conflicting immutable extent meaning');
    if (!old) { this.enrollExtent(condition); this.state.factSlots++; }
    if (!old || old.seq <= seq) {
      if (old?.id !== id) {
        this.state.factExtents[id].refs++;
        if (old) { this.state.factExtents[old.id].refs--; this.touchedExtents.add(old.id); }
      }
      this.state.extentGuards[key] = { id,seq };
    }
    const indexed = canonical([id,seq]);
    if (!this.extentSeen.has(indexed)) { this.incomingExtents.change(indexed,condition,seq,1); this.extentSeen.add(indexed); }
    return id;
  }
  blocking({ row, keys }: PreparedImage, seq: number): { seq: number; condition: ExtentCondition } | undefined {
    let blocking: { seq: number; condition: ExtentCondition } | undefined;
    if (!keys) return;
    for (const index of [this.index.closed,this.incomingExtents]) for (const extent of index.matching(row.table,keys,seq))
      if (!extent.condition.present.includes(row.id) && (!blocking || extent.seq > blocking.seq)) blocking = { seq: extent.seq,condition: extent.condition };
    return blocking;
  }
  finish(before: Map<string, StoredAnswer | undefined>): void {
    for (const [owner, old] of before) {
      const next = this.state.answers[owner];
      // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — equal retained proofs still prepare images but do not dirty unchanged reference counts.
      for (const [answer, other, delta] of [[old, next, -1], [next, old, 1]] as const) {
        for (const proof of answerProofs(answer)) this.imageRefs(proof, answerProof(other, proof[0]) === proof[1] ? 0 : delta);
        for (const id of answer?.extentProofs ?? []) {
          this.state.factExtents[id].refs += delta; this.touchedExtents.add(id);
        }
      }
    }
    for (const id of this.touchedImages) if (!this.state.factImages[id].refs) { this.state.factSlots -= imageSlots(this.state.factImages[id].keys); delete this.state.factImages[id]; }
    for (const id of this.touchedExtents) if (!this.state.factExtents[id].refs) { this.state.factSlots -= extentSlots(this.state.factExtents[id].condition); delete this.state.factExtents[id]; }
  }
}
export const proofSlots = (answer?: StoredAnswer) => Object.keys(answer?.rowProofs ?? {}).length + Object.keys(answer?.verdictProofs ?? {}).length
  + (answer?.extentProofs?.length ?? 0) + Number(!!answer?.needsFactProofs);
export function answerFactKeys(answer: StoredAnswer): Set<string> {
  return new Set([...answer.refs.map(r => rowFactKey(r.table, r.id)),
    ...(answer.receipt?.absences ?? []).flatMap(([table, index, values]) => index === 'byId' && typeof values[0] === 'string' ? [rowFactKey(table, values[0])] : []),
    ...(answer.receipt?.verdicts ?? []).map(verdictFactKey)]);
}
export function checkFactSlots(state: PersistedRangeState): void { if (state.factSlots > FACT_SLOT_LIMIT) throw new ClockCoverageReset(true); }
export function validateClock(value: { readTime?: number; clockPlanHash?: string }): void {
  if (value.readTime === undefined && value.clockPlanHash === undefined) return;
  if (!Number.isSafeInteger(value.readTime) || Object.is(value.readTime, -0) || !isSha256(value.clockPlanHash))
    throw new TypeError('invalid execution clock identity');
}
export const sameClockPlan = (old: StoredAnswer | undefined, next: StoreDelivery): old is StoredAnswer =>
  old?.fingerprint !== undefined && old.readTime !== undefined && next.readTime !== undefined && old.clockPlanHash === next.clockPlanHash;
