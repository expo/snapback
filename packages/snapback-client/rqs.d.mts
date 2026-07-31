// Type declarations for rqs.mjs — RQS token/digest cryptography (the JS arm
// of LLP 0091's 0A contract). Byte-compatible with src/rqs.rs.

/** A durable row as it appears on the wire: a JSON object keyed by `_id`. */
export type RqsRow = Readonly<Record<string, unknown>>;

export function sha256(bytes: Uint8Array): Uint8Array;
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
export function hex(bytes: Uint8Array): string;
export function base64UrlNoPad(bytes: Uint8Array): string;

/** Thrown (or caught into refusal verdicts) when a value cannot canonicalize
 * under RFC 8785 with the LLP 0091 §0A.2 mint refusals. */
export class RqsMintRefusal extends Error {
  constructor(reason: string);
  readonly reason: string;
}

/** RFC 8785 (JCS) canonical serialization; throws RqsMintRefusal on
 * non-finite numbers, unsafe integers, lone surrogates, and non-JSON types. */
export function jcs(value: unknown): string;
export function jcsBytes(value: unknown): Uint8Array;

export function rowHash(row: RqsRow): Uint8Array;
export function leaf(rowId: string, rowHashBytes: Uint8Array): Uint8Array;
export function rowWireId(row: Readonly<{ _id?: unknown }> | null | undefined): string | null;

export function mset1Empty(): Uint16Array;
export function mset1Add(state: Uint16Array, leafBytes: Uint8Array): Uint16Array;
export function mset1Remove(state: Uint16Array, leafBytes: Uint8Array): Uint16Array;
export function mset1Root(state: Uint16Array): `mset1:${string}`;
export function seq1Digest(rows: readonly RqsRow[]): `seq1:${string}`;
export function argsHash(args: unknown): `sha256:${string}`;
export function queryArtifactHash(functionDefinition: unknown): `sha256:${string}`;

export type RqsDigestKind = 'mset1' | 'seq1';

/** Compute the published content digest of a held row set for `kind`;
 * throws RqsMintRefusal on an unknown kind, a missing row id, or a
 * duplicate row id. */
export function digestOfRows(kind: RqsDigestKind, rows: readonly RqsRow[]): string;
/** Classify a digest by its self-describing prefix; null when unknown. */
export function digestKindOf(contentDigest: string): RqsDigestKind | null;

/** Rung-2 witness entry cap (LLP 0091 rung-2 amendment default). */
export const RQS_WITNESS_MAX_ENTRIES: number;

export interface RqsMembershipWitnessEntry {
  id: string;
  oldRowHash: string;
}
export interface RqsMembershipWitness {
  count: number;
  entries: RqsMembershipWitnessEntry[];
}

/** Build the rung-2 membership witness for a held `mset1` result; null when
 * the result is not witnessable (wrong digest kind, over the entry cap, a
 * mint-refusable row, or rows that do not reproduce `contentDigest`). */
export function membershipWitnessOfRows(
  rows: readonly RqsRow[],
  contentDigest: string,
  options?: { readonly maxEntries?: number },
): RqsMembershipWitness | null;

/** Verify held rows against a resume meta's content digest; a mint refusal
 * inside the recompute counts as a mismatch. */
export function rowsMatchDigest(rows: readonly RqsRow[], contentDigest: string): boolean;

/** Resume-token body (LLP 0091 §0A.6). `version`/`issuedAt` accept bigint
 * because the transcript encodes them as u64. */
export interface RqsResumeTokenBody {
  readonly app: string;
  readonly generation: string;
  readonly versionStream: string;
  readonly version: number | bigint;
  readonly queryArtifact: string;
  readonly argsHash: string;
  readonly digestKind: string;
  readonly contentDigest: string;
  readonly issuedAt: number | bigint;
  readonly authPartition?: string | null;
}

/** The length-framed MAC transcript for one resume token (byte-identical to
 * the Rust arm; parity obligation — browser clients never mint). */
export function tokenTranscript(keyId: string, body: RqsResumeTokenBody): Uint8Array;
export function mintTokenWire(
  key: Uint8Array,
  keyId: string,
  body: RqsResumeTokenBody,
): `sbrt1.${string}`;
