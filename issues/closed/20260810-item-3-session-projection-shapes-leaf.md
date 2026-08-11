# Claim: `session_projection` value shapes to the contract leaf (LLP 0225 §4 continuing item 1 / ratchet worklist item 3, second cut)

**Opened:** 2026-08-10 · **Closed:** 2026-08-11 · **Status:** resolved —
landed · **Area:** core modularization / ownership ratchet

## Claim

Claims the safe leftover identified in
`issues/20260810-item-3-remainder-auth-catalog-ops-owner-question.md` — the
`session_projection` **value shapes**, which are independent of the
`auth_catalog_ops` ownership question that ticket raises and can land without
it. First-claim-wins.

Predecessors reusing the same shape-down/behavior-up recipe: `5373238eb`
(item-3 first cut, 6 edges) and `b6a317ed8` (items-4/5 `ServerProfile`,
12 edges).

## Scope — the shapes move, every impl stays

Move from `src/auth/session_projection.rs` to `src/contract_types.rs`:

| Symbol | Kind |
| --- | --- |
| `SESSION_TERMINAL_CAUSE_META_PREFIX` | `&str` const |
| `RevocationReason` | 10-variant enum |
| `PersistedSessionTerminalReason` | private 8-variant serde enum |
| `SessionTerminalCauseRecord` | serde struct |
| `AuthorizationStreamIncarnation` | `String` newtype (canonical UUIDv7) |

`PersistedSessionTerminalReason` is not optional collateral: it is the field
type of `SessionTerminalCauseRecord.reason`, and a leaf struct may not hold a
field whose type lives in a sync module — that would be a leaf→sync edge, the
direction §2 forbids most strictly.

**Every `impl` block stays in `session_projection.rs`**, because each reaches
something that is not leaf-safe:

- `impl RevocationReason::authority_disposition` returns
  `TerminalAuthorityDisposition`, which stays.
- `impl PersistedSessionTerminalReason::from_revocation_reason` and
  `impl SessionTerminalCauseRecord::new` are conversions/validation, not shape.
- `impl AuthorizationStreamIncarnation::{fresh, parse, …}` calls the private
  `validate_canonical_uuid_v7` and `stream_corrupt`.

Inherent impls work cross-module inside a crate, and sync→leaf is an allowed
direction, so leaving them costs nothing. Moved struct fields widen to
`pub(crate)` where an impl that stayed behind needs them.

**`SessionProjection` must NOT move.** It carries 36 methods — it is the
behavior this boundary exists to keep in the sync engine. Likewise
`AuthorizationStreamRecord`, `ProjectionSource`, and
`TerminalAuthorityDisposition` stay.

## Frozen edges this cut inverts (4 of 7 — see the correction below)

| Frozen fingerprint | Symbol keeping it alive today |
| --- | --- |
| `src/storage/auth_mode.rs → src/auth/session_projection.rs` | `RevocationReason` |
| `src/storage/push_registry.rs → src/auth/session_projection.rs` | `RevocationReason` |
| `src/storage/auth.rs → src/auth/session_projection.rs` | all three terminal-cause symbols |
| `src/storage/auth_catalog_ops.rs → src/auth/session_projection.rs` | `SessionTerminalCauseRecord` |

Deliberately **not** cleared: `src/storage/auth_stream.rs` and
`src/storage/tests.rs`, which use `SessionProjection` /
`AuthorizationStreamRecord` / `ProjectionSource` — the shapes that stay.

## Why `contract_types.rs`

`src/local.rs` (unassigned) consumes `AuthorizationStreamIncarnation` in
function signatures, and `unassigned` confers no dependency rights (LLP 0225
§1), so a *new* leaf module would add a forbidden edge that — because a shape
moving down a layer cannot use the `relocation` disposition — would cost a
waiver. The three terminal-cause symbols have no unassigned consumer and were
free to go anywhere.

`src/ids.rs` was considered for `AuthorizationStreamIncarnation` and
**rejected on charter**: that module is explicitly the *prefixed*-identifier
registry (`usr_…`, `posts_…`) and this is a bare canonical UUIDv7, so putting
it there would violate the invariant its own header states.
`src/contract_types.rs` is the canonical dependency-free contract leaf, holds
language-neutral value shapes, and is already a dependency of `local.rs` — so
the charter answer and the zero-waiver answer coincide.

## Serialization safety

`SessionTerminalCauseRecord` and `PersistedSessionTerminalReason` are persisted
serde types with `rename_all = "camelCase"` and `deny_unknown_fields`. The move
keeps derives, attributes, field names, and field order byte-identical, so the
wire/at-rest encoding is unchanged. Any change there would be a data-format
break, not a relocation.

## Expected baseline disposition

Four frozen forbidden edges removed (this section originally said five — see
the outcome correction), **none added**. New `* →
src/contract_types.rs` edges are allowed downward edges. If the audited
`--update-baseline` diff shows any added forbidden edge, that is a scoping
error to fix before landing.

## Acceptance

- Ownership gate green; the fingerprints gone; no added forbidden edge.
- Affected cargo subsets match the merge-base failure **name sets** exactly.
- `./ref-check --verbose` green.
- LLP 0225 §4 and the ratchet worklist record the cut.


## Outcome — LANDED 2026-08-11

**4 frozen forbidden edges removed, none added (370 -> 366):**
`storage/auth_mode`, `storage/push_registry`, `storage/auth`, and
`storage/auth_catalog_ops`, each `-> src/auth/session_projection.rs`.

**Correction to this ticket's own prediction.** It claimed 5 edges, counting
`src/storage/schema_seed.rs`. That was wrong: schema_seed also uses
`AuthorizationStreamRecord`, `ProjectionSource`, and `SessionProjection` through
a *function-local* multi-line `use` (schema_seed.rs:463) that the survey grep
did not reach — the same grep limitation this ticket noted for `auth.rs` and
`tests.rs` but failed to re-apply to schema_seed. Its edge stays, correctly and
permanently for this cut, because `SessionProjection` is the behavior that must
not move. The scope was right; the count was one too high.

Verification: `auth`/`storage`/`server` lib-test failure name sets
byte-identical to the merge-base (630/58, 385/50, 265/24 pre-existing);
`cargo build --all-targets` clean; `./ref-check --verbose` green. Serde
derives, attributes, field names and field order carried verbatim, so the
persisted encoding of `SessionTerminalCauseRecord` /
`PersistedSessionTerminalReason` is unchanged. No repo-wide reformat.

Remaining `* -> session_projection` edges (`storage/auth_stream`,
`storage/tests`, `storage/schema_seed`) all hold `SessionProjection` or its
companions and are not shape moves; they belong to the ownership question in
`issues/20260810-item-3-remainder-auth-catalog-ops-owner-question.md`.
