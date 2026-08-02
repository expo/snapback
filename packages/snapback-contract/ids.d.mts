export const BODY_LENGTH: 26;
export const MAX_PREFIX_LENGTH: 12;

/// The prefixes this arm mints. The Rust registry is the full vocabulary; the
/// JavaScript client only ever mints these.
export const ID_PREFIXES: Readonly<{
  mutation: 'mut';
  lease: 'lse';
  authorityInstance: 'aut';
  opaque: 'id';
}>;

export interface SnapbackSplitId {
  readonly prefix: string;
  readonly body: string;
}

/// 16 bytes to 26 lowercase Crockford base32 characters, most significant
/// first. Throws `TypeError` unless `bytes` is exactly 16 bytes.
export function encodeBody(bytes: Uint8Array): string;

/// Mint a time-ordered id under `prefix`. Throws `TypeError` on a prefix that
/// is not `[a-z][a-z0-9]{0,11}`.
export function mintId(prefix: string, nowMs?: number): string;

/// Split a well-formed id into `{ prefix, body }`; `null` means "not in this
/// format", which includes every id written before LLP 0148.
export function splitId(id: unknown): SnapbackSplitId | null;

/// Whether `id` is a canonically spelled LLP 0148 identifier.
export const isWellFormedId: (id: unknown) => boolean;

/// The canonical hyphenated UUIDv7 every Snapback id carried before LLP 0148.
export const UUID_V7: RegExp;

/// Whether `value` is a Snapback-minted identifier in either spelling.
export const isMintedIdentifier: (value: unknown) => boolean;

/// An app document's prefix: its declared table name, ASCII-lowercased, with
/// non-alphanumerics removed, truncated to `MAX_PREFIX_LENGTH`.
export function tablePrefix(table: unknown): string;
