# LLP 0057: Auth catalog and provider protocol

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Storage, Security, API, Admin API, Backup/restore, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-08-15 (password issuance releases its planning
maintenance/address-stripe admission before projection Begin, then the owned
durable commit reacquires one fresh shared admission after Begin; a fair
maintenance gate can no longer self-join behind periodic GC).
2026-08-12 (macOS descriptor-copy reconciliation: SQLite online
backup now materializes its complete quiesced snapshot in a private in-memory
database, sanitizes export-excluded custody there, and serializes the finished
image through the already pinned staging descriptor; declared restore rebases
catalog-v4 password-attempt timestamps by only an artificial clock-floor jump
so physical lockout state is not aged out by future authority deadlines.) 2026-08-11 (catalog-v3 reconciliation: closed-v1 logical auth
transfer now accepts exact v2/v3 source and empty-target catalogs, records the
source catalog version, reconstructs only the v3 identity descriptors the
format implies exactly, and refuses lossy descriptor mappings.) 2026-08-10 (implementation reconciliation: first-class closed-v1
logical auth export/import now carries stable users, identities, agent recovery
metadata, and v2 scope bases while excluding all spendable authority; empty-v2
import rotates the authorization incarnation atomically.) 2026-08-10 (dated amendment: LLP 0215 wave 2c replaces four
independent throttle constants with the named compatibility budget policy,
without changing limits, transaction boundaries, profiles, or legacy
diagnostics). 2026-08-08 (dated amendment: the operator-locus startup
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` diagnostic names the missing
`<db>.auth-keyring.json` sidecar path and cause class, while the request-path
503 stays redacted — see LLP 0192 D-4 and the dated amendment). 2026-08-06 (dated amendment drafted at the author's
direction and ratified by the author the same day: LTX-boundary capture
discipline as a second admissible physical-capture form for the auth
unit, per LLP 0188). 2026-08-01 (LLP 0148 prefixed identifiers: the four catalog object
ids are respelled `usr_`/`idn_`/`ses_`/`aut_`, `usr_` gains a random body, both
spellings stay readable, and no catalog version is taken — see the dated
amendment). 2026-07-26 (capture-only provider ergonomics: `dev` and `demo`
retain the global request budget and bounded mailbox but are exempt from the
recipient-oriented per-address request budget; `test` and `prod` retain the
exact per-address boundary); 2026-07-23 (delegated wire extension: Draft LLP 0077 extends
this Spec's `/auth/exchange` contract for sender-constrained v2 browser
sessions — the request body gains an optional `senderConstraint` member
carrying the public JWK and issuance proof, and responses on that path carry
a `DPoP-Nonce` header. This resolves the sender-binding question this Spec
reserved as "not implementation latitude": the latitude is granted to LLP
0077 specifically, which has precedence for the extended members. Sessions
without a sender constraint, and the frozen `{challengeId, code}` core, are
unchanged. The delegation also covers the issuance-proof outcome accounting
for sender exchanges: a cryptographically valid issuance proof consumes its
replay id (`jti`) even when the paired code is wrong, locked, or exhausted —
so a single valid proof cannot be reused across code guesses — while a wrong
code still increments this Spec's code-attempt counter and only a valid proof
plus correct code binds the thumbprint; LLP 0077 defines that atomic outcome
table. The delegation further narrows this Spec's carrier-diagnostic matrix on
sender-constrained hosted routes only: a present-but-malformed or unknown
session carrier is folded into LLP 0077's anti-oracle
`SNAPBACK_AUTH_SENDER_PROOF_REQUIRED` challenge (with a cover nonce) rather
than `SNAPBACK_AUTH_REQUIRED`, to avoid a family-existence oracle; a genuinely
absent `Authorization` header still yields `SNAPBACK_AUTH_REQUIRED` as this
Spec requires, and non-sender routes are unchanged. This note records the
amendment without reopening Accepted status); 2026-07-15 (author ratification: Charlie Cheever explicitly
ratified this Spec after ENG-25001 closed the review findings and the FINAL4
Codex and Fable reviews both returned READY; Status advanced to Accepted
without advancing frozen LLP 0039); 2026-07-15 (FINAL3 closure: declared restore validates every
non-null v1/v2 catalog timestamp's SQLite integer storage class and portable
range before deriving the frontier, with mixed-corruption, nullable-field, and
ReadyV1 evidence; clarifies the maximum generation boundary; status remains
Draft); 2026-07-15 (final cross-family review follow-up: narrows durable
clock-floor wording to the exact generic-seed versus declared-restore
boundaries; status remains Draft); 2026-07-15 (ENG-25001 blind-review evidence closure: adds an exact
frozen-v1 compatibility fixture across reopen, provider/session use,
agent-surface refusal, no-migration activation, and marker-preserving physical
backup/restore; exercises rescue's rollback, exact-successor, and divergent
commit outcomes at the SQLite boundary; and proves refusal preserves valid LLP
0058 settled, pending, and quarantined four-key tuples); 2026-07-15 (ENG-25001 final review reconciliation: establishes
this document as the v1 base protocol under LLP 0055's v2 precedence, makes
legacy-v1 recognition versus fresh-v2 creation explicit throughout, exposes a
stable three-state backup publication result on every exit, and narrows
collision-route evidence to the deterministic seams actually exercised);
2026-07-15 (ENG-25001 implementation reconciliation: production
issuance and rotation now enforce cross-table digest uniqueness with three
bounded candidates; malformed family alarms are parse-gated; backup/restore,
clock-floor, keyring durability, rescue identity/ambiguity, explicit stdin
impersonation intake, and portable numeric schemas implement the pinned
fail-closed obligations; status intentionally remains Draft); 2026-07-14
(round-2 dual-family revision, /llp-super-refine; historical intermediate
review state whose named implementation gaps were closed by the preceding
ENG-25001 revision: pinned
the reusable **bulk session-revocation transaction** LLP 0058's downgrade and
declared restore both consume; reconciled **commit-ambiguity** to LLP 0059's
exact-successor reconciliation (this document no longer states the contradictory
discard-and-unavailable rule for mint/rotation) and pointed the **composed lock
graph** at LLP 0059's ordering as authoritative; pinned **bearer-digest
uniqueness across current and tombstone rows** with a retryable-collision
outcome, and named the shipped issuance gap as a defect obligation; made
**malformed family-alarm input semantically non-actionable** regardless of dummy
digest equality; derived **declared-restore time from the durable clock floor**
and stated the LLP 0059 floor overlay on every durable `now`; reconciled the
**`auth.mintSession` wire shape** with LLP 0024 (nested flat payload; top-level
descriptor is the composed-response envelope); tightened **backup "publishes
nothing"** to proven pre-rename failure only and made restore hash/inspect
through the **retained descriptor**; hardened **rescue** (rowid/`sqlite_sequence`
preserve-or-refuse, commit-ambiguity reconciliation, LLP 0058 four-key mode
compatibility, and reserved-source name reachability) as defect obligations;
pinned the **`generation` domain** and the JS-safe **timestamp schema bound**;
and softened the **no-ready-file impersonation stdin** path to a named
obligation. Full triage in §Review triage.) 2026-07-14 (ENG-24996 review gate: archived the GPT-family review artifact at `reviews/0057-auth-provider-protocol.codex.md` and applied its editorial corrections — composed credential-response example, address-exposure wording, future-import incarnation rule, and Related links; material findings remain for author triage). 2026-07-14 (ENG-24981 backup-staging audit: bind the SQLite backup image to its exact descriptor-created inode, pin the staging directory and every staged child inode, and revalidate them immediately before and after publication so a replaced or symlinked staging path fails closed before any source page is copied). 2026-07-14 (implementation-vs-review reconciliation: ENG-24596/item 3 and its executable evidence have landed, while this security-sensitive Spec remains Draft pending author ratification and an appropriately scaled review). 2026-07-13 (ENG-24596 restore audit: serialize every supported file-backed startup with restore, carry the target-directory identity through database open, and bind staged children plus publication/cleanup to their exact inodes); 2026-07-13 (ENG-24596 final audit: enforced rescue's frozen dev/test-only profile and reconciled the LLP 0045 handoff boundary); 2026-07-13 (ENG-24596 implementation reconciliation: aligned owning LLPs, review findings, restore exclusion, redaction/ACL/GC hardening, and executable evidence); 2026-07-13 (implementation review: separate due key rotation from request admission; pin public no-store classification)
**Related:** LLP 0000, LLP 0007, LLP 0009, LLP 0011, LLP 0012, LLP 0017, LLP 0024, LLP 0030, LLP 0031, LLP 0036, LLP 0037, LLP 0039, LLP 0045, LLP 0051, LLP 0053, LLP 0055, LLP 0058, LLP 0059, LLP 0060, LLP 0192, LLP 0215

## Summary

This Spec makes landing item 3 of
[LLP 0039](./0039-auth-vertical-slice.rfc.md) executable. It pins the local
SQLite protocol for Snapback's protected auth catalog, passwordless email-code
provider, session token family, capture mailbox, operator impersonation carrier,
collision rescue, and database-plus-keyring backup.

[LLP 0045](./0045-notifications-outbox.rfc.md) retains ownership of the
auth-code delivery handoff and its durable/non-durable boundary. This Spec is
its item-3 implementing delegate: it owns the exact bounded process-local
mailbox protocol, but may not move plaintext into a durable notification intent.

LLP 0039 remains **Draft / FROZEN**. This document does not amend or reinterpret
it. Where 0039 pins an outcome, 0039 wins; this document chooses the exact wire,
storage, constant, and failure-path details that 0039 deliberately deferred in
`LLP 0039#protocol-obligations-deferred-to-implementation`.

The protocol has four security boundaries:

1. App schemas and app code cannot name, read, sync, journal, or subscribe to
   `_auth_*` state.
2. Low-entropy verification codes are protected by a versioned keyed digest;
   high-entropy session credentials are stored only as SHA-256 digests.
3. Reading a captured code or selecting another user's authority requires a
   separate process-bound `ImpersonationCapability`. Admin, console, and
   `AdminSecretRead` credentials are not substitutes.
4. A physical backup succeeds only when its SQLite snapshot and exact keyring
   bytes were captured under one quiescence boundary.

This is the local target's **v1 base protocol**, not the catalog version a fresh
current binary creates. LLP 0055 extends this base with agent principals and
owns catalog v2: current binaries recognize an exact legacy v1 catalog without
migrating it, but create v2 for every fresh activation. Provider delivery in
`prod`, hosted/distributed throttling and invalidation, cookies, OAuth, and the
client-page XSS posture stay outside this item exactly as LLP 0039 states.

ENG-24596 implements this item-3 contract and its acceptance vectors. Charlie
Cheever explicitly ratified this Spec on 2026-07-15 after the scaled review
loop closed, so the document is Accepted; LLP 0039 remains frozen.

## Scope and ownership

This document owns:

- catalog version 1 DDL, catalog recognition, reservation, reset, and GC;
- keyring format 1, file lifecycle, atomic replacement, and rotation;
- email canonicalization, request throttling, challenge creation, exchange,
  first-login provisioning, and capture delivery;
- session minting, the 20-session cap, bearer rotation, tombstones, tiered
  supersession, logout, the refresh-family alarm, and the reusable
  **bulk session-revocation transaction** (§Bulk session revocation);
- item-3 HTTP and host-operation DTOs, routes, diagnostics, and schemas;
- the v1 `ImpersonationCapability` wire carrier used by all impersonation
  effects, including item 2's already-registered host-operation branch;
- transactional collision rescue, including the database-open recovery case;
- the consistent physical backup and declared-restore procedure; and
- generated and adversarial acceptance matrices for those state machines.

At the item-3 landing boundary this document exposed, but did not implement,
seams owned by later items. Those consumers have since landed without moving
their ownership into this Spec:

- item 4 now calls the read-only collision check at stage time and catalog/keyring
  activation at consume time; provider routes retain typed `MODE_DEV` refusals
  whenever dev remains the active mode;
- item 5 now consumes session/revocation outcomes in the in-memory projection
  and adds the authorization-stream incarnation to reset and declared restore;
- item 7 now projects `authority_instance_id` through the public authority
  descriptor;
- LLP 0053 owns authorization invalidation and retained/offline admission.

### Version composition and precedence

This Spec is normative for the session/provider machinery common to catalog
versions 1 and 2 and for exact recognition of the frozen v1 shape. **LLP 0055
has precedence wherever its v2 extension changes catalog shape or lifecycle.**
In particular, LLP 0055 owns the current marker, the agent columns and six agent
tables, reset/restore effects for those authority classes, and the rule that a
fresh catalog is v2. LLP 0058 remains authoritative for staged auth-mode state,
and LLP 0059 remains authoritative for the durable clock, projection, and
composed lock protocol. LLP 0215 owns the named effect-budget vocabulary,
policy resolution, counter classes, retry identity, and refusal shape. This
Spec retains authority over the email-code state machine and its exact
compatibility terms and transaction boundaries.

The closed version policy is:

- marker `1` plus the exact DDL in §Catalog version 1 is recognized as
  `ReadyV1`; session and email-code surfaces remain usable, while LLP 0055 agent
  surfaces are unavailable;
- an uninitialized catalog is activated directly as exact v2 under LLP 0055 and
  must become `ReadyV2`; no current path creates a fresh v1 catalog; and
- there is no implicit v1→v2 migration. A legacy v1 catalog stays v1 until a
  separately specified first-class migration lands, and an unknown higher
  marker fails closed.

An implementer following this Spec in the current repository MUST compose LLP
0055 and create v2. The v1 DDL below exists for exact legacy recognition and as
the shared protocol base; it is not a fresh-creation recipe.

## Normative vocabulary and constants

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. All durations use a
monotonic clock for in-process waits and Unix epoch milliseconds for durable and
wire timestamps. Durable/wire timestamps must be integers in
`0..=9_007_199_254_740_991`, following `LLP 0007#timestamps`.

**Every durable auth write's `now` is the LLP 0059 durable clock floor**, not a
raw wall-clock sample. `LLP 0059#durable-session-clock-floor` seeds a
non-decreasing floor from a persisted value at startup and derives every
wall-clock lifetime decision at `max(sample, floor)`; this document's tables
carry `CHECK` bounds (e.g. `created_at_ms <= revoked_at_ms`) that a backward
wall move would otherwise violate, so `now` here means the floored epoch
throughout — session lifetimes, tombstone `superseded_at_ms`, challenge
timestamps, key `retired_at_ms`, bulk revocation, and declared restore alike.
An implementation that reaches declared restore before the generic coordinator
seed MUST incorporate the catalog's own maxima inside that restore transaction
before applying any supplied `now`; provider work must not begin until either
that restore boundary or the generic seed has established the floor.
The production startup path seeds the durable floor immediately after catalog
inspection, before declared restore, provider-mode composition, auth GC, or
keyring lifecycle work; declared restore receives `provider.now_ms()`, never a
raw `SystemTime::now()` sample.

`generation` is an integer in `1..=9_007_199_254_740_991` (the JS-safe range,
since it is wire-visible in `authorityDescriptor`). Landing exactly on the
maximum is representable; attempting a revocation-class increment when the
stored generation is already at that maximum is catalog corruption, failed
closed, never a wrap. The handshake-only `sessionGeneration: 0` is the
anonymous/no-session sentinel and is never a durable session generation.

| Name | Base/current value or named compatibility policy |
|---|---:|
| `AUTH_CATALOG_VERSION_V1` (legacy-recognition marker) | `1` |
| `AUTH_CATALOG_VERSION` (fresh/current, LLP 0055) | `2` |
| `AUTH_KEYRING_FORMAT_VERSION` | `1` |
| Request body limit | 4 KiB |
| Canonical address limit | 320 UTF-8 bytes |
| Verification code | 6 ASCII digits, uniformly sampled |
| Challenge TTL | 10 minutes |
| Maximum attempts | LLP 0215 `auth.guessing`, `credential + provider + app + deployment`, `ATTEMPT` fixed-total: 5 total submitted attempts |
| Per-address request budget | LLP 0215 `auth.delivery`, `recipient + provider + app + deployment`, `SUCCESSFUL_EFFECT` rolling-window: 5 accepted requests per rolling 10 minutes in `test` and `prod`; the rule is `not-applicable` under the `dev`/`demo` overlay |
| Global request budget | LLP 0215 `auth.challenge-allocation`, `app + deployment`, `SUCCESSFUL_EFFECT` rolling-window: 120 accepted requests per rolling 60 seconds in every profile |
| Address coordination | 256 fixed mutex stripes |
| Capture mailbox capacity | LLP 0215 `auth.challenge-allocation`, `provider + app + deployment`, `SUCCESSFUL_EFFECT` occupancy: 1,024 published or reserved entries |
| Session bearer entropy | 256 random bits |
| Sliding session window | 30 days |
| Absolute session window | 90 days |
| Client rotation cadence | 7 days |
| Supersession grace | 10 seconds, inclusive |
| Live sessions per user | 20 |
| Sliding-use write coalescing | 3 days (one tenth of the sliding window) |
| Key rotation age | 30 days |
| Retired-key minimum retention | 24 hours and no referencing challenge |
| Auth GC cadence | 30 seconds, plus startup |
| Auth GC batch | 512 rows per table per pass |
| Impersonation bearer lifetime | one server process |

Except for the catalog marker explicitly superseded by LLP 0055 and the four
named budget rows governed by LLP 0215, these are the shared v1-base/current
constants. The four budget rows resolve from LLP 0215's source-controlled base
policy plus deployment-profile overlay; they are not independent numeric
authorities or mutable operator settings. Other constants are not
configuration entries.
Changing a cryptographic encoding, digest domain, catalog shape, or keyring
shape is a version change. Operational constant changes require an acceptance
update and an explicit compatibility decision; they do not silently
reinterpret durable rows.

## Binary and textual encodings

### Randomness and identifiers

All credentials, codes, challenge ids, and key material use the operating
system CSPRNG. Failure to obtain all requested bytes is
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`; no weak or deterministic fallback exists.

- User, identity, session, and authority-instance ids are LLP 0148 prefixed
  identifiers — `usr_`, `idn_`, `ses_`, `aut_` followed by a 26-character
  lowercase Crockford base32 body. `usr_` bodies are 16 CSPRNG bytes; the other
  three are UUIDv7 bytes. **A catalog written before that decision carries
  canonical lowercase hyphenated UUIDv7 strings in these columns, and readers
  MUST continue to accept them** — see the dated amendment below.
- A challenge id is `sbc_` followed by base64url-without-padding of 16 random
  bytes. Collision retries are bounded to three attempts.
- A key id is `sbak_` followed by base64url-without-padding of 16 random bytes.
- Base64url decoders require the canonical unpadded spelling. Alternate
  spellings are rejected rather than normalized.

Every freshly generated database id, key id, session bearer, challenge id, and
impersonation bearer gets at most three complete random candidates when a
uniqueness collision is observable. Each rejected candidate is zeroized; a
third collision is `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`. The implementation
never tweaks, truncates, or deterministically derives a colliding candidate.

**A session bearer's `token_hash` is unique across current *and* tombstoned
credentials, and issuance must check both.** Resolution consults
`_auth_sessions` before `_auth_session_tokens`, so a digest duplicated across
the two tables would let an old bearer authenticate as the new session — the
uniqueness invariant is not the per-table `UNIQUE` index alone, it is the
cross-table absence rotation already enforces (it checks
`EXISTS(... _auth_sessions ...) OR EXISTS(... _auth_session_tokens ...)` before
committing a successor). Session issuance MUST perform the same cross-table
check inside its transaction, retry up to the three-candidate bound, zeroize
each rejected candidate, and surface a **retryable-collision** outcome the
coordinator loop retries (never the raw internal-collision diagnostic to the
client). Production issuance and rotation both perform the two-table check in
their transaction. A candidate collision is propagated as an explicit internal
outcome, exactly removes that candidate's authority premark, and is retried by
the coordinator within the common three-candidate bound; exhausting the bound
is `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`.

Six-digit codes are sampled without modulo bias: interpret four random bytes as
a big-endian `u32`, reject values at or above
`floor(2^32 / 1_000_000) * 1_000_000`, and format the remainder modulo one
million as exactly six zero-padded ASCII digits.

### Length-prefixed code digest

`LP(x)` is a four-byte unsigned big-endian length followed by the exact bytes of
`x`. Lengths are byte lengths, not character counts. Digest version 1 is:

```text
HMAC-SHA-256(
  key,
  LP("snapback.auth.email-code.v1") ||
  LP(challenge_id) ||
  LP(canonical_address_utf8) ||
  LP(six_ascii_digits)
)
```

The stored digest is the raw 32-byte HMAC output. Verification uses a
constant-time comparison. `key_id` selects the key; absence of that key is a
provider failure, never `CODE_INVALID`. Unknown and terminal challenges perform
one dummy HMAC with a process-local dummy key before returning their uniform
result so the obvious database-lookup timing distinction is not exposed.

### Session bearer and at-rest digest

A session credential has this single canonical spelling:

```text
sbs_<base64url-no-pad of 32 random bytes>.<8 lowercase hexadecimal CRC32>
```

The CRC is CRC-32/ISO-HDLC over the 32 raw random bytes: reflected polynomial
`0xedb88320`, initial value `0xffffffff`, and final xor `0xffffffff` (the
`123456789` check value is `cbf43926`). The complete token is 56 ASCII bytes.
The checksum detects copy/scanner mistakes; it is not an authenticator. Parsing
requires the exact prefix, separators, lengths, alphabet, canonical base64url
spelling, lowercase checksum, and checksum value.

`token_hash` is `SHA-256` over all 56 ASCII bytes, including prefix and
checksum. The database stores the raw 32-byte digest. A structurally invalid or
unknown bearer maps to `SNAPBACK_AUTH_REQUIRED`; a validly shaped digest that
resolves to a revoked or expired session maps to
`SNAPBACK_AUTH_SESSION_EXPIRED`.

Secret-bearing Rust types do not implement serialization, cloning, display, or
ordinary `Debug`. Their explicit `Debug` output is `[REDACTED]`; their owned
buffers zeroize on drop.

## Reserved namespace and catalog recognition

### Reservation

An identifier is auth-reserved when its ASCII-lowercased spelling is exactly
`_auth` or begins `_auth_`. The comparison is ASCII-case-insensitive because
SQLite identifiers are case-insensitive. Confusable Unicode is irrelevant to
the existing ASCII identifier grammar.

The reservation is enforced at the scopes the repository already uses:

- codegen: table and index names;
- storage manifest validation: table, field, and index names;
- every `ctx.db`, sync, live, admin-edit, import, and direct storage name
  resolver that accepts an app-owned identifier; and
- stored-manifest load on every database open, not only new schema apply.

The existing authoring/runtime invalid-identifier diagnostics remain the public
result (`SCHEMA_INVALID_IDENTIFIER` in codegen and
`SNAPBACK_INVALID_IDENTIFIER` in storage). No database-specific exemption or
adoption flag exists.

### Catalog states

The marker is `_snapback_meta.key = 'auth_catalog_version'`. This base Spec
defines exact ASCII value `1`; the current composed binary additionally
recognizes LLP 0055's exact value `2`. Catalog inspection reads both the marker
and `sqlite_schema` without mutation and returns exactly one state:

| Marker / physical state | Result |
|---|---|
| No marker, no auth-reserved physical table and no exact current-catalog name conflict | `Uninitialized` |
| No marker, any auth-reserved physical table | `SNAPBACK_AUTH_TABLE_COLLISION` |
| No marker, exact current-catalog index name owned by another table | `SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION` |
| Marker not recognized by the composed binary | `SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED` |
| Marker `1`, exact v1 schema | `ReadyV1` |
| Marker `1`, missing/changed catalog object or extra auth-reserved table/object attached to a catalog table | `SNAPBACK_AUTH_CATALOG_CORRUPT` |
| Marker `2`, exact LLP 0055 schema | `ReadyV2` |
| Marker `2`, missing/changed v2 object | `SNAPBACK_AUTH_CATALOG_CORRUPT` |

An unmarked catalog is never adopted, even if its SQL happens to equal v1.
Exact-v1 recognition compares tables, columns, declared types, nullability,
primary keys, checks, foreign keys, named indexes, uniqueness, indexed columns,
and partial-index predicates. It ignores only SQLite's generated `sqlite_autoindex`
names. LLP 0055 owns equivalent exact recognition for v2. Unknown auth-reserved
objects make a marked catalog corrupt rather than future-compatible when they
are tables or attach to catalog tables; a future migration changes the marker
first-class. An unrelated legacy reserved-name
index/trigger/view attached only to an ordinary app table is not silently
adopted, but it also cannot wedge catalog creation unless its name is one of
v1's exact globally named indexes. Stored-manifest validation still rejects any
such declared object under the absolute reservation.

Stage-time inspection is read-only: it MUST NOT create `_snapback_meta`, mint or
read the keyring, start a transaction that writes a WAL frame, or alter the
database file. Item 4 invokes it before accepting a desired `sessions` mode.
Both `ReadyV1` and `ReadyV2` are recognized session-capable states; only
`ReadyV2` admits LLP 0055 agent surfaces.

## Catalog version 1

This DDL is frozen for recognition of legacy marker `1` and defines the base
tables v2 extends. A fresh current activation MUST NOT install it; §Activation
ordering installs LLP 0055's v2 shape instead.

Legacy catalog v1 uses the following logical SQLite DDL. Implementations may
format SQL differently, but v1 recognition and shared-table behavior must be
equivalent to this exact shape. Fresh creation uses LLP 0055's v2 descriptor.

```sql
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(length(provider) > 0),
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "_auth_identities_provider_subject_uq"
  ON "_auth_identities"(provider, subject);
CREATE UNIQUE INDEX "_auth_identities_id_user_uq"
  ON "_auth_identities"(id, user_id);
CREATE INDEX "_auth_identities_user"
  ON "_auth_identities"(user_id, id);

CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),
  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL OR revoked_at_ms BETWEEN 0 AND 9007199254740991),
  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "_auth_sessions_token_uq"
  ON "_auth_sessions"(token_hash);
CREATE UNIQUE INDEX "_auth_sessions_authority_instance_uq"
  ON "_auth_sessions"(authority_instance_id);
CREATE INDEX "_auth_sessions_user_live"
  ON "_auth_sessions"(user_id, created_at_ms, id)
  WHERE revoked_at_ms IS NULL;
CREATE INDEX "_auth_sessions_absolute_expiry"
  ON "_auth_sessions"(absolute_expires_at_ms, id);

CREATE TABLE "_auth_session_tokens" (
  token_hash BLOB NOT NULL PRIMARY KEY CHECK(length(token_hash) = 32),
  session_id TEXT NOT NULL,
  superseded_at_ms INTEGER NOT NULL
    CHECK(superseded_at_ms BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(session_id) REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
);
CREATE INDEX "_auth_session_tokens_session"
  ON "_auth_session_tokens"(session_id, superseded_at_ms, token_hash);

CREATE TABLE "_auth_verification_codes" (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  canonical_address TEXT NOT NULL CHECK(length(canonical_address) > 0),
  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  requested_at_ms INTEGER NOT NULL
    CHECK(requested_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),
  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL OR consumed_at_ms BETWEEN 0 AND 9007199254740991),
  superseded_by TEXT,
  CHECK(attempts >= 0 AND attempts <= max_attempts),
  CHECK(max_attempts = 5),
  CHECK(requested_at_ms <= expires_at_ms),
  CHECK(consumed_at_ms IS NULL OR consumed_at_ms >= requested_at_ms),
  CHECK(consumed_at_ms IS NULL OR superseded_by IS NULL)
);
CREATE UNIQUE INDEX "_auth_verification_codes_one_active"
  ON "_auth_verification_codes"(canonical_address)
  WHERE consumed_at_ms IS NULL AND superseded_by IS NULL;
CREATE INDEX "_auth_verification_codes_address_requested"
  ON "_auth_verification_codes"(canonical_address, requested_at_ms);
CREATE INDEX "_auth_verification_codes_requested"
  ON "_auth_verification_codes"(requested_at_ms, challenge_id);
CREATE INDEX "_auth_verification_codes_expiry"
  ON "_auth_verification_codes"(expires_at_ms, challenge_id);
```

For either catalog version, creation and insertion of the marker are one
`IMMEDIATE` transaction and the marker is inserted last. A rollback leaves no
catalog object and no marker. The current creation descriptor is LLP 0055's v2
shape, not the v1 DDL above.

### Activation ordering

First activation has this order:

1. Run read-only catalog inspection; stop on any result except `Uninitialized`,
   exact `ReadyV1`, or exact `ReadyV2`.
2. If `Uninitialized`, load an existing keyring or atomically mint the initial
   keyring. A corrupt existing keyring is never overwritten.
3. Re-run catalog inspection inside the serialized activation boundary.
4. If it is still `Uninitialized`, create every **v2** catalog object defined by
   LLP 0055 and marker `2` in one transaction. Never create marker `1` here and
   never silently migrate an observed `ReadyV1` catalog.
5. Re-inspect and require `ReadyV2` for a fresh activation. An existing
   `ReadyV1` or `ReadyV2` remains in that exact recognized state.

A crash after keyring publication but before catalog commit leaves a harmless,
valid pre-created keyring that the retry adopts. DDL never precedes a usable
keyring. For an already-marked catalog, a missing keyring is not auto-minted:
the provider fails closed because live challenges may reference lost keys.

## Catalog write and lifecycle rules

Every auth mutation uses direct storage methods below app `ctx.db`. It MUST NOT
call app mutation helpers, advance `_snapback_version`, append
`_snapback_changes`, produce a mutation receipt, wake the live matcher, or expose
rows through sync/export snapshots. Tests compare the journal row count and app
commit version before and after every auth operation.

The v1 base reset deletes, in this order, verification codes, token tombstones,
sessions, identities, and users inside the same transaction as the app reset.
For `ReadyV2`, LLP 0055 takes precedence and the same transaction first removes
agent tokens, pairing requests, grants, invitations, credentials, and other
v2-owned authority state before the shared rows. Reset preserves the catalog
DDL, marker, and keyring. The capture mailbox is cleared only after that
transaction commits. A rejected reset preserves both durable auth rows and
mailbox entries. A crash after commit but before the in-memory clear is safe
because process loss clears the mailbox.

Logical export/import tooling is now implemented by `snapback auth export` and
`snapback auth import`. Its closed format-1 contract is:

- export users and identities, including canonical subjects;
- exclude sessions, token hashes, tombstones, verification challenges/digests,
  mailbox entries, and keyring bytes;
- require an exact current v2 or v3 catalog on export; import only into an
  exact empty v2 or v3 catalog without migrating either version, reject
  identity collisions, and mint no session, credential, grant, invitation, or
  pairing request;
- record the source catalog version in the artifact; for v3, accept only the
  email-code, local-password, and agent-credential descriptors whose kind,
  issuer, canonical value, and enabled state format 1 implies exactly, and
  refuse every lossy export or import mapping;
- regenerate the durable authorization-stream incarnation in the same
  transaction as the destructive import, as LLP 0039 pins and LLP 0059's
  stream protocol implements;
- validate the versioned closed shape, explicit nullable fields, canonical
  subjects, ownership references, deterministic ordering, and scope bases;
- carry LLP 0055 ownership, registration provenance, deactivation, and
  `_auth_scope_bases` while structurally omitting every spendable or
  consent-pending authority class; and
- never treat logical import as a physical backup.

The acceptance matrix plants session/challenge/credential/grant/token/
invitation/pairing markers in the source, round-trips the included identity
facts, proves the markers absent from the artifact and destination, rejects
older/corrupt/colliding inputs, and proves a nonempty-target refusal leaves
authorization state unchanged.

### Garbage collection

GC runs at startup and every 30 seconds, deleting at most 512 rows from each
class per transaction and scheduling another immediate pass when a class hit the
limit.

- A challenge is retained until `now >= expires_at_ms`, even if consumed or
  superseded, so the ten-minute per-address throttle history cannot be erased by
  consuming a code. It is then deletable.
- A session, revoked or not, and all its tombstones remain until
  `now >= absolute_expires_at_ms`; deletion cascades to tombstones.
- An orphan tombstone is corrupt catalog state, not silently collectible.
- Mailbox expiry uses the challenge expiry and is pruned on every mailbox
  operation plus the maintenance pass.
- A retired key is prunable only after 24 hours and when no retained challenge
  names it.

GC uses the direct auth path and has no app journal/version/live effect.

## Keyring protocol

### Path and format

For a file-backed database at `<db>`, the keyring is exactly
`<db>.auth-keyring.json`. It is a deployment sidecar, not LLP 0036 app config.
An in-memory database has an in-memory-only keyring that vanishes with the
process.

Format 1 is a closed JSON object:

```json
{
  "format_version": 1,
  "active_key_id": "sbak_BASE64URL16",
  "keys": [
    {
      "id": "sbak_BASE64URL16",
      "algorithm": "hmac-sha256",
      "created_at_ms": 0,
      "retired_at_ms": null,
      "material": "BASE64URL_NO_PAD_32_BYTES"
    }
  ]
}
```

Unknown fields, duplicate ids, a noncanonical encoding, a key not exactly 32
bytes, more than 64 keys, a missing/retired active key, multiple unretired keys,
an unsupported algorithm/version, or non-monotone timestamps make the keyring
corrupt. Key records are serialized by `(created_at_ms, id)` for deterministic
review. The file size is capped at 64 KiB.

Persistent files are opened no-follow and, before any content is read, must be
regular, owned by the effective service identity, mode exactly `0600`, and have
exactly one hard link. A mode mismatch is not repaired in place; unsupported
owner/ACL validation fails closed. A provider
operation revalidates the current path and complete file under the keyring lock;
deletion or replacement with an invalid file therefore cannot keep using a
stale cached keyring.

### Atomic publication and rotation

Atomic replacement means:

1. create an unpredictable same-directory temporary file with `O_EXCL`,
   `O_NOFOLLOW`, and mode `0600`;
2. write the complete closed JSON, flush, and `fsync` the file;
3. rename over the destination without crossing filesystems;
4. `fsync` the parent directory; and
5. only then publish the new in-memory view.

A failure before rename preserves the prior destination bytes. Rename is the
filesystem linearization point, so an error from rename or the following parent
`fsync` is treated as commit-ambiguous: discard the candidate in-memory view,
re-open and fully validate the destination, and accept only bytes equal to the
complete prior or complete candidate ring. The triggering mutation still
returns unavailable; later operations use the revalidated result. Any other
bytes fail the provider closed. A predictable reusable temporary path is
forbidden.

Before issuing a challenge, rotate when the active key is at least 30 days old:
mark it retired at `now`, append a fresh active key, and atomically publish the
keyring before computing any digest with the new key. A publication failure
refuses the new request but leaves exchanges using the last validated on-disk
ring available. Retired keys remain for at least 24 hours and until no retained
challenge references them. Pruning is another atomic replacement. Keys are
never returned by an API, diagnostic, receipt, or backup manifest.

For `ReadyV1`, startup validates the keyring before bind and emits one
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` startup diagnostic plus an
`authProvider: unavailable` health fact when it is missing or corrupt. That
startup diagnostic is operator-locus and names the exact sidecar path and cause
class — see the 2026-08-08 dated amendment; the request-path 503 carrying the
same code stays redacted. Existing
session resolution remains available because it needs no keyring, but
request-code/exchange refuse without mutation until a valid ring is restored;
startup never silently mints a replacement for a marked catalog.

## Email-code provider

### Canonical address

Canonicalization is exact and ordered:

1. decode the JSON string as Unicode and reject NUL or control characters;
2. trim Unicode `White_Space` only at the two ends;
3. normalize the complete string to Unicode NFC;
4. apply Unicode default, locale-independent lowercase to the complete address;
5. reject any remaining Unicode whitespace/control character;
6. require exactly one ASCII `@`, with nonempty local and domain parts; and
7. require `1..=320` UTF-8 bytes after all transformations.

V1 performs no dot folding, plus-tag stripping, provider-specific rewrite,
IDNA/punycode conversion, or local-part case exception. Those are future
identity migrations, not invisible canonicalization changes. Invalid input is
`SNAPBACK_AUTH_REQUEST_INVALID` with no address echoed in details.

### Request-code transaction

`POST /auth/request-code` is accepted only when a delivery provider is
available. The capture provider is available in `dev`, `test`, and `demo`, never
`prod`. A refused profile or unavailable/corrupt keyring mutates nothing.

Canonical addresses map onto 256 fixed mutex stripes by a process-keyed hash;
the service holds that stripe from mailbox reservation through publish. The
fixed stripe set bounds memory while preventing two requests for one address
from reordering. The flow is:

1. Canonicalize and validate the address.
2. Revalidate/rotate the keyring and generate challenge id, code, and digest.
3. Reserve one mailbox slot under LLP 0215's
   `auth.challenge-allocation` occupancy rule. A reservation counts against the
   1,024 cap; capacity refusal is `SNAPBACK_AUTH_THROTTLED` and mutates neither
   the auth catalog nor mailbox. A due key rotation already durably published
   by step 2 is an independent maintenance effect and is not rolled back merely
   because later request admission refuses. Any pre-commit refusal releases
   the reservation.
4. In one `IMMEDIATE` transaction, count retained rows for the rolling global
   and per-address half-open windows `(now - window, now]`. The global budget
   applies in every profile. The `test` and `prod` overlays apply the
   per-address rule; the `dev` and `demo` overlays declare that rule
   `not-applicable`, covered by the finite global rule, because their capture
   provider never delivers to a recipient. At an applicable limit, roll back
   and return `SNAPBACK_AUTH_THROTTLED`. The bounded capture mailbox remains in
   force for every non-production profile. A request exactly one full window
   after an older request no longer counts that older row.
5. Mark every active challenge for the address with
   `superseded_by = new_challenge_id`, then insert the new challenge. The partial
   unique index is the concurrency backstop.
6. Commit. This is the durable linearization point.
7. Erase superseded mailbox entries and publish the reserved new entry. Publish
   after a valid reservation is infallible except process termination.
8. Only after publish, return `{ challengeId, expiresAt }`.

The address mutex prevents an older request from publishing after a newer one
has superseded it. A process death after commit but before response can leave an
unreadable active challenge; the next request supersedes it, and the caller that
received no response has no challenge id. This is the only cross-resource crash
residual and grants no authority.

Every accepted request creates a challenge whether or not an identity exists.
The response and status are identical in both cases.

### Challenge states and exchange

Challenge states are derived, not stored as a second enum:

| State | Predicate |
|---|---|
| `Active` | unconsumed, unsuperseded, `now < expires`, attempts `< 5` |
| `Locked` | unconsumed, unsuperseded, attempts `= 5`, not expired |
| `Consumed` | `consumed_at_ms` is set |
| `Superseded` | `superseded_by` is set |
| `Expired` | `now >= expires_at_ms` |

`POST /auth/exchange` runs lookup, HMAC verification, attempt accounting,
challenge consumption, identity provisioning, session-cap enforcement, and
session insertion in one `IMMEDIATE` transaction.

Before that transaction, a read-only challenge lookup obtains the canonical
address, if any, and exchange acquires the same fixed address stripe used by
request-code. It rechecks every predicate in the transaction and holds the
stripe through post-commit mailbox erase. The preliminary lookup grants no
authority and an absent/deleted row follows the uniform invalid path.

- Unknown, expired, consumed, or superseded returns
  `SNAPBACK_AUTH_CODE_INVALID` without revealing which predicate failed.
- A locked challenge returns `SNAPBACK_AUTH_CODE_LOCKED`.
- For an active challenge, increment `attempts` for every submitted code. A
  correct fifth attempt succeeds. An incorrect fifth attempt commits the value
  `5` and returns `CODE_LOCKED`; earlier incorrect attempts commit and return
  `CODE_INVALID`.
- A correct code sets `consumed_at_ms`, finds or creates exactly one
  `email-code` identity and user, enforces the session cap, and inserts exactly
  one session before commit.
- The wrong-code and locked outcomes are transaction outcomes, not errors that
  roll back attempt accounting.
- The plaintext code and returned bearer are generated outside SQL parameters
  where possible and zeroized after use. Only their digests enter SQLite.

After commit, the mailbox entry is erased before the credential response is
returned. A crash after commit but before erase loses the in-memory mailbox with
the process. Concurrent exchanges can therefore commit at most one session.

## Session and token-family protocol

### Session creation and cap

A new session has generation `1`, `last_used_at_ms = created_at_ms`, sliding
expiry `created + 30 days`, and absolute expiry `created + 90 days`. The sliding
expiry is capped at the absolute expiry. `authority_instance_id` is random and
stable across refresh.

Within the creation transaction, expired sessions do not count toward the cap.
If 20 unrevoked, unexpired sessions already exist, creation revokes the oldest
by `(created_at_ms, id)`: set `revoked_at_ms = now`, increment its generation,
then insert the new session. The transaction returns the revoked session id and
generation to item 5's projection seam. It never mints a 21st live session.

`auth.mintSession` uses the same canonicalization, user/identity provisioning,
session creation, cap, and credential response as a successful exchange. It
sets `verified_at_ms` to mint time only when creating the identity and records
`issuedBy: admin` in the host-operation audit envelope. It is available only in
`dev`, `test`, and `demo` and requires both `AdminWrite` and
`ImpersonationCapability`. Item 3 implements this reusable core and closed DTO;
item 4 owns host-op activation and its end-to-end acceptance, matching LLP
0039's landing order.

### Credential resolution matrix

Resolution checks current-session hashes first, then tombstones. All comparisons
are by fixed-length digests.

| Presented bearer | Ordinary authenticated surface | `/auth/refresh` | `/auth/family-alarm` |
|---|---|---|---|
| Current, live | resolve session | rotate | opaque accepted/no-op |
| Current but expired/revoked | `SESSION_EXPIRED` | `SESSION_EXPIRED` | opaque accepted/no-op |
| Tombstone, age `<= 10s`, session live | resolve same session | `REFRESH_SUPERSEDED`, no mutation | revoke family |
| Tombstone, age `> 10s`, session live | `CREDENTIAL_SUPERSEDED` | revoke family, then `SESSION_EXPIRED` | revoke family |
| Tombstone, session expired/revoked | `SESSION_EXPIRED` | `SESSION_EXPIRED` | idempotent revoke/no-op |
| Structurally valid but unknown | `AUTH_REQUIRED` | `AUTH_REQUIRED` | opaque accepted/no-op |
| Structurally invalid | `AUTH_REQUIRED` | `AUTH_REQUIRED` | opaque accepted/no-op |

The grace comparison is inclusive at exactly ten seconds. Ordinary grace use
is a real authenticated use and may extend sliding expiry. A refresh alone never
extends expiry.

### Rotation

Refreshing a current live bearer generates a noncolliding bearer and, in one
transaction:

1. rechecks that the presented digest is still current and the session live;
2. checks the new digest against both current and tombstone tables;
3. inserts the predecessor digest into `_auth_session_tokens` with `now`; and
4. replaces `_auth_sessions.token_hash` with the successor digest.

Session id, user id, identity id, generation, authority instance id, and expiry
are unchanged. Commit is the linearization point; the plaintext successor is
returned only after commit. A lost successful response strands the successor
and requires reauthentication. The server never reissues it.

Two refreshes racing with the same current bearer have only these outcomes: one
commits; the other observes the tombstone. If it observes it inside grace, it
returns `REFRESH_SUPERSEDED` without revocation. This is the sleeping/woken-tab
case and MUST NOT destroy the healthy session.

### Logout, ordinary supersession, and family alarm

Logout of a resolved session sets `revoked_at_ms = now` and increments
generation in one transaction. Repeating logout with the now-revoked bearer is
`SESSION_EXPIRED` and changes nothing.

When an ordinary request receives `CREDENTIAL_SUPERSEDED`, the client later
tries custody reload and one retry. If it cannot find a valid successor, it
calls the family alarm before clearing. The alarm is:

- `POST /auth/family-alarm` with the suspect bearer in `Authorization` and an
  empty closed body;
- `Public` plus operation-specific `FamilyAlarmBearer` resolution, which grants
  no caller or invocation authority;
- lookup only in `_auth_session_tokens`; a current or unknown bearer is a no-op;
- one `IMMEDIATE` transaction for every input. **Malformed input is
  semantically non-actionable regardless of digest equality**: the transaction
  carries a "parsed a well-formed bearer" predicate that is false for malformed
  input, and the conditional update revokes only when that predicate is true
  *and* the presented digest names a live tombstone. A dummy digest computed for
  malformed input therefore cannot revoke an unrelated family even if it
  collides with a retained tombstone — the collision is inert because the
  parsed-ok predicate gates the write, not merely the timing pad. Every input
  uses the same fixed lookup-plus-conditional-update statement shape; that
  statement revokes only the attributable tombstone's session and increments
  generation only when still live; and
- always HTTP `202`, `{ "accepted": true }`, and `Cache-Control: no-store` for
  missing, malformed, current, unknown, attributable, and already-revoked
  inputs. Response publication waits until a fixed 20 ms minimum plus 0–5 ms of
  CSPRNG jitter from admission, after the transaction completes; no status,
  body, header, row count, or unpadded fast path returns a family/session fact.

The operation can only destroy authority. It cannot authenticate, refresh,
return a user/session id, or revoke a family not attributable to the presented
tombstone. It is safe to retry after an unknown response. If the client is
offline or permanently loses the alarm request, the stolen-successor residual
survives until expiry or another revocation event; v1 makes no stronger claim.

### Bulk session revocation

This document owns one reusable bulk-revocation transaction, because LLP 0058's
sessions-to-dev downgrade and this document's own declared restore both consume
it and an implementer conforming to 0057 alone must produce identical durable
outcomes. It requires a recognized `ReadyV1` or `ReadyV2` catalog and, in one `IMMEDIATE` transaction,
for **every session not already revoked**: sets `revoked_at_ms = floored now`
(the LLP 0059 clock floor, below) and increments `generation` exactly once. It
**deletes nothing** — no session row, identity, tombstone, or user — so
projection (LLP 0059) and the "revoked sessions do not resurrect" guarantee
hold, and it never resurrects a session a later restore or downgrade re-touches.
A `generation` already at its domain maximum (below) makes the transaction fail
closed as catalog corruption rather than wrap. It writes no restore marker and
sends no family alarm; callers that also need a marker (declared restore) or an
incarnation bump (LLP 0059) compose those into the same transaction. The
downgrade caller in LLP 0058 and the restore branch below are its two consumers.

### Sliding use

Item 3 exposes `record_authenticated_use(session_id, expected_generation, now)`.
Authenticated app requests, connection open, and later live-socket liveness call
it; refresh does not. It performs no write until at least three days have elapsed
since `last_used_at_ms`. A write rechecks liveness/generation and sets
`last_used_at_ms = now`, `expires_at_ms = min(now + 30d, absolute_expires_at_ms)`.
An expired session is never revived.

## Capture mailbox

The capture mailbox is process-local and keyed only by challenge id. An entry
contains the canonical address, six-digit code in a zeroizing secret wrapper,
and expiry. It has no list operation and no durable representation. Published
entries plus pre-commit reservations cannot exceed 1,024.

`GET /_snapback/api/auth/mailbox?challengeId=<id>` returns the closed object
`{ challengeId, canonicalAddress, code, expiresAt }` only when all gates pass.
It does not consume the code. Missing, expired, consumed, or superseded entries
return `SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND` without an address. Responses are
`no-store`, excluded from logs/receipts, and available only in `dev`, `test`, or
`demo`.

Entries are erased on durable consume, durable supersede, committed reset,
expiry, and process exit. A future LLP 0045 delivery adapter receives only an
ephemeral payload handle; plaintext code material MUST NOT enter a durable
notification intent, retry row, export, or backup.

Mailbox GET first peeks only the entry's address, releases the map lock,
acquires that address stripe, and then re-reads and validates the entry before
returning it. Request-code and exchange hold the same stripe through publish or
erase. Reset holds the exclusive maintenance gate through commit and mailbox
clear, while mailbox GET takes that gate shared. Therefore no GET can observe a
consumed, superseded, or reset entry in a commit-to-erase gap; no path holds the
mailbox map while waiting for an address stripe.

## ImpersonationCapability carrier

V1 chooses the per-boot terminal/owner-file alternative allowed by LLP 0039,
not raw keyring bytes and not the item-2 secret-read root.

At every `dev`, `test`, or `demo` server start whose compiled registry exposes
at least one enabled impersonation operation, the operator plane generates an
independent 256-bit random bearer. It never mints or publishes one in `prod`:

```text
sbic_<base64url-no-pad of 32 bytes>.<8 lowercase hexadecimal CRC32>
```

The CRC and parser are the session-bearer construction with a distinct prefix.
The request-side registry retains only `SHA-256` of the complete bearer and the
process startup nonce. The raw value is held by a non-cloneable,
non-serializable, zeroizing `ImpersonationOperator` during publication, then
discarded by the server.

When `--ready-file` is used, the raw bearer is written to the mechanically
derived owner-only sibling `<ready-file>.impersonation` and the trusted ready
descriptor names that exact sibling in `impersonationCapabilityFile`. Discovery
accepts no arbitrary path. The file is mode `0600`, no-follow, size-bounded,
included in managed-path alias checks, and removed with ready-file cleanup. It
is atomically published before the ready descriptor; a descriptor-publication
failure removes the unpublished sibling. Discovery verifies the descriptor's
`startupNonce` against live `/health` before reading the sibling, so a stale
file or descriptor never supplies a capability to another process. With no
ready file, the bearer is printed exactly once to the controlling terminal; it
is never printed in JSON logs or stdout envelopes. A later attaching CLI accepts
that value only through the explicit `--impersonation-capability-stdin` input,
which requires a URL target and conflicts with `--ready-file`; it never accepts
the bearer from argv or an environment variable. The CLI reads that bounded
stdin only for a registered operation that requires impersonation, rejects more
than 512 bytes or a noncanonical bearer, and holds accepted decoded input and
the parsed secret in zeroizing carriers. A URL target without this flag resolves
no impersonation capability and never selects a local sidecar.

HTTP carries it only in `x-snapback-impersonation-capability`. Middleware first
proves the operation's ordinary `AdminWrite` credential, then constant-time
compares this independent carrier. Missing/invalid produces
`SNAPBACK_AUTH_IMPERSONATION_REQUIRED` without saying which credential failed.
Restart invalidates it. Reset does not extend it beyond the process lifetime.

This carrier gates all four impersonation effects:

- mailbox read;
- `auth.mintSession`;
- `auth.rescueCollidingTable`; and
- host-ops `function.run --as-user` / `--as-role`.

The existing item-2 bridge stays categorically separate:

- `SecretReadOperator` is an in-process, non-cloneable minting root;
- its `sbrl_` derivative is scope/budget/expiry/reset bounded and travels only
  in `x-snapback-secret-read-lease`;
- the ordinary admin token is exchanged for a short-lived console credential;
  the console stores only that ordinary credential and holds an `sbrl_` lease
  in memory when explicitly handed one; and
- none of the admin token, console credential, `sbrl_` lease, unexported
  secret-read root, session bearer, or raw keyring material satisfies the
  `sbic_` comparison. Conversely, `sbic_` satisfies neither AdminWrite nor
  AdminSecretRead.

No admin-console prompt or client setter accepts `sbic_`. The CLI attaches it
only to a registered impersonation operation and never to ordinary mutation,
action, inspection, or provisioning calls.
`x-snapback-impersonation-capability` is not added to the permissive loopback
cross-origin CORS header allowlist; local CLI HTTP needs no CORS. This is
defense-in-depth only, because same-origin script execution remains part of the
separate client-page XSS posture.

## Routes, operations, and DTOs

All new Rust request/response types are the serde + schemars authorities under
`LLP 0037#decision-ratified-2026-07-02`. Request objects use camelCase,
`deny_unknown_fields`, reject duplicate JSON keys, and have generated committed
schemas. Credential responses are `Cache-Control: no-store` and never enter
receipts or runtime-state snapshots.

### Public provider DTOs

```json
// POST /auth/request-code
{ "email": "person@example.com" }

// 200
{ "challengeId": "sbc_...", "expiresAt": 0 }

// POST /auth/exchange
{ "challengeId": "sbc_...", "code": "012345" }

// 200 exchange and refresh response
{
  "tokenType": "Bearer",
  "token": "sbs_...",
  "refreshAfter": 0,
  "session": {
    "id": "uuid-v7",
    "userId": "uuid-v7",
    "provider": "email-code",
    "createdAt": 0,
    "expiresAt": 0,
    "absoluteExpiresAt": 0
  },
  "authorityDescriptor": {
    "descriptorVersion": 1,
    "authorityInstanceId": "uuid-v7",
    "sessionGeneration": 1
  }
}

// POST /auth/refresh and POST /auth/logout
{}

// POST /auth/family-alarm
{}

// 202 family alarm
{ "accepted": true }
```

Credential responses always describe a live session, so their
`authorityDescriptor.sessionGeneration` schema is
`1..=9_007_199_254_740_991`. LLP 0058's bootstrap handshake reuses the
descriptor vocabulary but permits `0` only as the anonymous/no-session
sentinel; its schema still carries the same JavaScript-safe maximum.

`/auth/refresh`, `/auth/logout`, and `/auth/family-alarm` take the bearer only
from `Authorization: Bearer ...`; no body/query token alias exists. Logout
success is HTTP 204 with no body. `refreshAfter` is `created/rotated now + 7
days`, capped at the response's sliding and absolute expiry as client guidance;
it does not change server expiry.

The nested session object deliberately omits identity subject, token digest,
generation, and `authorityInstanceId`. The top-level `authorityDescriptor` is
item 7's since-landed versioned descriptor and is required in the composed
credential response and its committed schema; item 3 did not expose it, so an
item-3 credential response never became an accidental descriptor.

**Reconciliation with LLP 0024's `auth.mintSession` row.** LLP 0024 pins the
host-operation result as a *flat* credential payload — `tokenType`, `token`,
`refreshAfter`, and the public `session`, with "no identity subject, digest,
generation, or authority-instance id." That describes the **nested session
object**, which this document keeps flat and descriptor-free exactly as 0024
requires, and there is no contradiction: the `authorityDescriptor` is a
**sibling top-level member of the composed HTTP credential response** (item 7),
not a field of the nested session, and the host-operation envelope carries the
same composed response. The authority-instance id 0024 excludes is excluded
from the *session* object in both documents; it lives only in the top-level
descriptor. This precedence is stated so a fixture built from 0024's row and one
built from this DTO agree: the flat session is canonical, the top-level
descriptor is the response envelope, and where the two documents' wording could
diverge, 0024's exclusion governs the session object and this document governs
the envelope.

### Host-operation DTOs

```json
// auth.mintSession args
{ "email": "person@example.com" }

// auth.rescueCollidingTable args
{ "sourceTable": "_auth_users", "targetTable": "legacy_auth_users" }
```

`auth.mintSession` returns the same credential data inside the normal host-ops
envelope. The ordinary live-server `auth.rescueCollidingTable` projection
returns only source, target, copied row count, copied explicit-index count,
manifest-updated boolean, and `catalogCollisionCleared`; it never returns rows.
The startup recovery carrier returns those same six metadata fields plus the
posture fact `restartRequired: true`, because that listener cannot transition
into application service in-process.

### Registry rows

| Entry | Path policy | Credential resolution | Authority/effect | Response |
|---|---|---|---|---|
| `POST /auth/request-code` | Public | None | provider service; no caller | public typed, no-store |
| `POST /auth/exchange` | Public | `ChallengeProof` | provider service; issues credential | `CredentialSecret` |
| `POST /auth/refresh` | SessionAuth | `RequiredSessionBearer` | resolved session | `CredentialSecret` |
| `POST /auth/logout` | SessionAuth | `RequiredSessionBearer` | resolved session | no body, no-store |
| `POST /auth/family-alarm` | Public | `FamilyAlarmBearer` | no authority; revoke-only | opaque typed, no-store |
| `GET /_snapback/api/auth/mailbox` | AdminWrite | AdminCredential | `ImpersonationCapability` via its header | `CredentialSecret` |
| host-op `auth.mintSession` | AdminWrite | AdminCredential | `ImpersonationCapability` via its header | `CredentialSecret` |
| host-op `auth.rescueCollidingTable` | AdminWrite | AdminCredential | `ImpersonationCapability` via its header | operator metadata |

Mailbox access and session minting are available in dev/test/demo. At the
item-3 boundary mint was activation-fenced pending item 4; the current composed
target instead requires settled, available sessions mode plus all independent
operator gates. Collision rescue is deliberately dev/test-only on both the
ordinary and recovery-server projections.

`public typed, no-store` is a distinct response-sensitivity classification.
It is neither a cacheable `PublicProjection` nor mislabeled operator metadata;
the central response-control layer applies `Cache-Control: no-store` to it.

`ChallengeProof` and `FamilyAlarmBearer` are closed
`CredentialResolution` cases; they do not overload `None`, `AdminCredential`,
or `RequiredSessionBearer`. `x-snapback-impersonation-capability` is instead the
sole resolver for the independent `EffectPolicy::ImpersonationCapability` axis,
so it composes with but never replaces `AdminCredential`. Provider routes in
active dev mode return the typed HTTP-404
`SNAPBACK_AUTH_MODE_DEV`. The item-4 `/auth/session` handshake remains a
separate exception.

### Diagnostics

| Code | HTTP / locus | Boundary |
|---|---|---|
| `SNAPBACK_AUTH_REQUEST_INVALID` | 400 | malformed closed DTO, email, challenge id, or code shape |
| `SNAPBACK_AUTH_REQUIRED` | 401 | missing, malformed, or unknown session bearer |
| `SNAPBACK_AUTH_SESSION_EXPIRED` | 401 | resolved family is expired or revoked |
| `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` | 401 | ordinary use of an old family token after grace |
| `SNAPBACK_AUTH_CODE_INVALID` | 401 | uniform unknown/wrong/expired/consumed/superseded challenge result |
| `SNAPBACK_AUTH_CODE_LOCKED` | 403 | attempt budget exhausted |
| `SNAPBACK_AUTH_IMPERSONATION_REQUIRED` | 403 | separate effect carrier missing or invalid |
| `SNAPBACK_AUTH_MODE_DEV` | 404 | provider route unavailable in dev mode |
| `SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND` | 404 | gated exact mailbox lookup has no live entry |
| `SNAPBACK_AUTH_REFRESH_SUPERSEDED` | 409 | refresh raced a committed rotation inside grace |
| `SNAPBACK_AUTH_THROTTLED` | 429 | address/global/capture capacity budget |
| `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` | 503 | RNG, keyring, or delivery provider unavailable |
| `SNAPBACK_AUTH_TABLE_COLLISION` | stage/startup/host-op | unmarked auth-reserved physical table |
| `SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION` | stage/startup | exact current-catalog global object name is already foreign-owned |
| `SNAPBACK_AUTH_CATALOG_CORRUPT` | startup | marked catalog differs from its recognized version |
| `SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED` | startup | unknown marker |
| `SNAPBACK_AUTH_RESCUE_INVALID` | host-op/CLI | invalid names/state or absent source |
| `SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED` | host-op/CLI | source cannot be copied exactly by v1 rescue |
| `SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED` | host-op/CLI | manifest-named collision is governed by LLP 0058 mode keys and requires offline repair |
| `SNAPBACK_AUTH_BACKUP_INVALID` | CLI | inconsistent/unverifiable backup input/output |

The status mapper lists every request-path code explicitly; unknown codes remain
500. Details may include limits, retry-after seconds, catalog version, and object
kind/name where the operator must repair schema. They never include address,
code, token, digest, key id/material, or impersonation carrier.

## Collision rescue

### Reachability

There are two collision cases: a dormant physical `_auth_*` table not named by
the stored manifest, and a stored manifest that itself names the colliding
table. A normally valid dev manifest with only a dormant physical collision may
open and serve in dev mode; item 4's stage-time check refuses the transition and
the registered rescue host-op remains reachable through the ordinary server.
That ordinary projection is available only in `dev` and `test`; `demo` and
`prod` both refuse it before the rescue core can run.
The second case cannot enter the ordinary application open path after the
reservation lands, so startup has a closed **collision-recovery posture**.

When stored-manifest validation fails specifically because a declared physical
table is auth-reserved, the startup probe opens only the SQLite catalog below
stored-manifest validation and performs the read-only collision query. In `dev`
or `test`, on a loopback bind, it may bind a recovery router that exposes
exactly:

- `GET /health`, whose typed public state is
  `authRecovery: { reason: "table-collision", restartRequired: true }`; and
- the registered `POST /_snapback/api/host-ops` carrier, accepting only the
  selected `auth.rescueCollidingTable` operation.

Every app-data, inspect, provider, static-console, WebSocket, and other host-op
entry is absent/refused. No stored app manifest is accepted, no function bundle
loads or executes, and no catalog/keyring/app mutation occurs merely by entering
the posture. The ordinary serve startup still resolves or mints its configured
AdminWrite credential and the independent per-boot `sbic_` before binding, so
the rescue operation composes the same two gates as its normal HTTP projection.
Tokenless loopback is not AdminWrite authority here.

The no-mutation claim above is a database/catalog/keyring/app-state invariant.
Normal owner-only admin-token, ready-descriptor, and impersonation-sidecar
publication is allowed and is asserted separately; recovery never represents
those operator-plane files as application or catalog state.

`demo`, `prod`, non-loopback bind, missing AdminWrite configuration, ambiguous
catalog state, and a validation failure not attributable to a declared physical
auth-reserved table fail startup without a listener. A successful rescue leaves
the process in recovery posture and returns `restartRequired: true`; application
service begins only after a clean restart and normal manifest validation. More
than one colliding table may be rescued through repeated gated calls before that
restart.

An exact-v1 index name already attached to another table yields the distinct
`SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION` and fails closed for offline operator
repair; it never enters the table-copy recovery router. Other legacy reserved
non-table objects attached only to app tables are outside catalog ownership as
defined above. The recovery router never broadens table rescue into a generic
reserved-object editor.

### Transactional algorithm

Rescue accepts one actual physical source table whose case-folded name is
auth-reserved, an absent valid nonreserved target identifier, and an absent
catalog marker. It refuses catalog-owned tables. It also refuses a target that
already exists physically or in the stored manifest.

**Source-name reachability.** Catalog reservation recognizes any name whose
case-folded spelling equals `_auth` or begins `_auth_`, including quoted names
with spaces or non-ASCII suffixes. Rescue therefore accepts **any exact,
bounded, NUL-free physical SQLite source name** (identified by its exact,
case-sensitive stored name, not re-parsed through the application-identifier
grammar) while keeping the strict grammar on the *target*. The production
router implements this split. A source that cannot be exactly copied still
refuses with `SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED`, but it is never merely
unnameable.

**Row identity and sequence history are preserved or the source is refused.**
The multiset proof covers named-column values and multiplicities, which is not
observable table identity: a sparse implicit `rowid` set (`1, 99`) can renumber
to `1, 2`, and an `AUTOINCREMENT` table whose `sqlite_sequence` high-water
exceeds its current maximum loses that history, letting a retired id reuse.
Rescue MUST either copy through `WITHOUT ROWID`/explicit-`rowid` preservation
and carry the `sqlite_sequence` high-water for an `AUTOINCREMENT` source, or
**refuse** every source shape for which implicit `rowid` or `sqlite_sequence`
is observable — never silently renumber. (The auth-reserved sources this verb
actually rescues are legacy app tables, so refusal is an acceptable v1 answer;
the point is that lossy renumbering is not.) Production rescue preserves
`WITHOUT ROWID` tables and true `INTEGER PRIMARY KEY` identity; for an
observable hidden rowid it copies through an unshadowed SQLite rowid alias and
proves equality. A table that shadows every alias has no observable hidden
rowid through this interface. An `AUTOINCREMENT` source is refused with
`SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED`; v1 does not attempt to migrate its
`sqlite_sequence` high-water.

**Compatibility with LLP 0058's four-key mode state.** Rescue rewrites the
legacy `schema_manifest`, but LLP 0058 makes `schema_manifest_capability_aware`
and `auth_mode_state_v1` part of a cross-validated four-key state that the next
open refuses on any mismatch. Rescue MUST therefore either atomically update
**every** authoritative manifest/identity key in the same transaction, or
explicitly refuse a managed (sessions-era, staged, or quarantined) database with
a stable offline-repair diagnostic — it may not leave the legacy and
capability-aware manifests divergent for the next open to reject. Production
rescue may move an orphan physical collision that is not named by the stored
manifest without changing mode keys. If the manifest names the source and any
managed key (`schema_manifest_capability_aware`, its staged form, or
`auth_mode_state_v1`) is present, rescue refuses with the stable
`SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED` offline-repair diagnostic;
only legacy-manifest state is rewritten.

Inside one `IMMEDIATE` transaction it:

1. Rechecks marker/source/target and scans the complete schema, not only objects
   owned by the source. It enumerates the source's table SQL, columns, outgoing
   foreign keys, explicit indexes, and triggers; every other table's incoming
   foreign keys; and every trigger/view whose tokenized SQL depends on the
   source.
2. Refuses virtual tables, generated/hidden columns, any incoming or outgoing
   foreign key, any owned or externally owned trigger, any dependent view,
   expression indexes, indexes with unknown collation, an ambiguous dependency,
   or any `sqlite_schema.sql` shape the v1 token-aware rewriter cannot
   round-trip. Refusal is `SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED` with no
   mutation. Foreign-key enforcement remains enabled throughout.
3. Tokenizes the original `CREATE TABLE` statement and replaces only its leading
   schema object identifier with the quoted target, preserving column/check/
   default/unique SQL byte-for-byte otherwise. String literals and comments are
   never text-replaced.
4. Creates the target and copies every named column using quoted identifiers in
   one `INSERT INTO target(columns...) SELECT columns... FROM source` statement.
5. Requires equal row count and bidirectional multiset equality before
   proceeding. The comparison groups by every copied column (including NULL and
   BLOB values), compares each group's `count(*)`, and applies `EXCEPT` in both
   directions; set equality without multiplicity is insufficient.
6. Recreates each explicit index from tokenized SQL. Its new deterministic name
   is `<target>__rescue_idx_<zero-based-order>`; the rewriter replaces only the
   leading index name and `ON` table identifier. Unique and partial predicates
   are preserved.
7. If the stored manifest names the source table, rewrites that one table name
   and its explicit index names to the new values, clears its `schemaHash` and
   `inputsHash`, validates the complete manifest under current rules, and writes
   it in the same transaction. Clearing identity makes attestation report
   unmatched/unavailable and requires an explicit full artifact-pair
   reprovision; rescue never preserves a hash over changed content. If the
   manifest does not name the source, it is unchanged.
8. Drops the source only after table, rows, indexes, equality proof, and manifest
   validation all succeed.
9. Re-runs the read-only collision query inside the transaction. It commits the
   completed rescue in either case and reports
   `catalogCollisionCleared: true` only when no foreign auth-reserved object
   remains; otherwise the operator may rescue the next table.

Every error or injected failure rolls back target creation, manifest rewrite,
and source drop. The source table, rows, indexes, and stored manifest remain
logically equivalent to their pre-operation state; this does not falsely claim
that rollback leaves SQLite database/WAL bytes untouched. **The commit itself is
successor-checked, not blindly retried**: after `commit()` reports an error,
production uses the same live SQLite connection to test the exact expected
successor — source absent, target present, expected row and explicit-index
counts, any rewritten manifest mapping, and the expected collision-cleared
result. An exact successor returns the already-computed success; every other
state preserves the original commit error. SQLite's atomic transaction boundary
rules out a partially committed table/manifest transition, but this v1 path
does not reopen the database, classify an exact predecessor separately, or emit
a distinct third recovery result. The destructive
`--drop-orphaned-auth-tables` command remains separate and backup-first; rescue
never silently delegates to it.

## Physical backup and declared restore

### Consistent backup

The canonical command is
`snapback auth backup --db <path> --output <new-directory>`. It is local
operator-plane work and accepts only a nonexistent output path on the same
filesystem as its temporary sibling. It may run in process through trusted CLI
control or against a stopped instance; an out-of-process invocation that cannot
acquire the instance lock refuses rather than copying a live directory.
The command requires a file-backed exact `ReadyV1` or `ReadyV2` catalog;
in-memory and uninitialized instances return
`SNAPBACK_AUTH_BACKUP_INVALID`. The manifest records the image's actual marker
(`1` or `2`), never merely the binary's current creation constant.

The backup algorithm is:

1. Acquire the instance write lock and the exclusive auth-maintenance gate.
   Provider requests, key rotation, reset, rescue, and auth GC cannot cross this
   gate. The lock order is maintenance gate, keyring, database writer.
2. Fully validate catalog and keyring and retain the exact validated keyring
   bytes.
3. Create the staging directory as a strict owner-only direct child of the
   pinned output parent, and retain both its descriptor and its inode identity.
   Create each staged member (`database.sqlite3`, `auth-keyring.json`,
   `backup.json`) through that directory descriptor with `O_CREAT | O_EXCL |
   O_NOFOLLOW`, retaining the exact descriptor-created child inode before any
   byte is written.
4. Run SQLite's online backup API from the locked live connection into a
   private in-memory destination. The private copy journals in memory, so no
   `-journal` or `-wal` sidecar is created or read; this folds all committed
   database and WAL state into the destination while copying a source `-wal`
   file is neither necessary nor permitted. Apply any export-only sanitization
   before bytes escape that destination, serialize the completed image, and
   write it only through the exact retained descriptor-created database member
   (never through a pathname). Normalize the image's format-version header to
   rollback mode in that descriptor stream and re-open the same descriptor
   read-only to prove it is a standalone exact catalog matching the manifest
   version. This indirection is required on hosts such as macOS where SQLite
   cannot pager-write the `/dev/fd/N` alias of an otherwise writable retained
   descriptor. A staging path that a local principal has replaced or symlinked
   still cannot receive a source byte.
5. Write the captured keyring bytes to `auth-keyring.json` mode `0600` and the
   closed `backup.json` (format version `1`, creation time, catalog version,
   database SHA-256, keyring SHA-256, source database basename; no key ids or
   secret bytes) through their retained descriptors. Hash the database and
   keyring for the manifest through those descriptors, never through a
   replaceable path.
6. `fsync` all three files and the staging directory. Immediately before the
   publication rename, revalidate the staging-directory inode and every strict
   owner-only child inode through the pinned descriptors; rename the exact
   pinned staging inode to the requested output; then immediately after the
   rename revalidate the published directory inode and child inodes again, and
   `fsync` the parent. The three outcomes are distinct and named, because
   "publishes nothing" is only true before the rename: a pre-rename failure
   (including a swap that wins the pre-rename check) is **Unpublished** — no
   output exists and the temp is cleaned up; a clean rename plus passing
   post-check is **Published**; and a failure *after* the rename was attempted
   (post-rename revalidation, parent `fsync`, or an ambiguous rename result) is
   **CommitAmbiguous** — a complete unit may survive at the output path, cleanup
   is suppressed (step 7), and the operator validates or removes it. The
   operation returns which of the three occurred; only Unpublished may be
   described as publishing nothing.
7. Release locks only after publication or cleanup of the unpublished temp.
   Cleanup unlinks only the exact descriptor-created child and staging inodes;
   a substituted directory or child is left untouched. Once the rename has been
   attempted the still-open directory descriptor is never used to strip
   children, so a post-rename refusal is commit-ambiguous rather than
   destructive.

The CLI emits a closed JSON envelope on **every** backup exit. Its top-level
`publicationState` is exactly `Unpublished`, `Published`, or
`CommitAmbiguous`; failures repeat the same stable value in the diagnostic
details. `Published` is emitted only on success after the parent fsync.
Pre-rename validation and staging failures emit `Unpublished`. Any rename
error, post-rename validation failure, or parent-fsync failure emits
`CommitAmbiguous`, even when the process can currently see a complete output.

The output directory is mode `0700`; database, keyring, and manifest are `0600`.
A full instance backup may additionally include LLP 0036 config, but the auth
unit is successful only when these exact database and keyring bytes share the
one quiescence boundary. A raw `cp` of the database, WAL, and keyring while the
server runs is explicitly not a Snapback backup.

### Restore

`snapback auth restore --from <backup> --db <new-directory>/<database-name>`
requires the target instance directory itself to be nonexistent. It runs
offline under a persistent sibling target-instance reservation shared by every
supported file-backed startup. Startup creates only a missing outer parent
before taking that reservation, then keeps both it and the exact opened target
directory inode through the inside-instance lock and database-open handoff.
Restore validates both hashes and the closed format **through the same retained
descriptor it will publish** — the staged database is hashed, catalog-inspected,
and retained-key-checked through a descriptor-bound SQLite connection, never
reopened by pathname for inspection and then re-identified only at publication,
which under this document's path-swap threat model would let a benign database be
substituted for inspection and the original restored before the final identity
check. It stages the database, keyring sibling, and an owner-only closed
`restore-declaration.json` in a sibling temporary directory, fsyncs them, and
publishes the complete directory by one same-filesystem rename. Immediately before and after that rename it
revalidates the exact staging-directory inode, complete member set, and every
strict owner-only child inode through pinned descriptors. Failure cleanup
unlinks only identities created by this restore; a substituted child or
directory is left untouched and the operation fails closed. It never claims to
atomically replace two independent files in an existing instance directory.
Replacing an old instance means restoring to a new directory, preserving or
moving the stopped old directory, and then selecting the restored `--db` path.
Cross-filesystem publication is refused.

Each restore generates a fresh canonical UUIDv7 `declarationId`; it is not a
secret. The declaration file is exactly
`{ "formatVersion": 1, "declarationId": "<uuid-v7>" }`. The next start MUST
carry `--restored-from-backup <declarationId>`, and the argument must equal that
file. Before bind, one auth transaction compares
`_snapback_meta['auth_restore_declaration_id']`:

- if it already equals this id, the declaration is an idempotent no-op;
- otherwise it calls the shared **bulk session-revocation helper** (§Bulk
  session revocation) inside the restore transaction —
  `revoked_at_ms = floored now`, one
  generation increment each — which is why restore time is derived from the
  durable clock floor and relevant catalog maxima, not a raw wall sample: a
  future-dated or clock-rolled-back backup would otherwise set `revoked_at_ms`
  below `created_at_ms` and fail the DDL `CHECK`;
- deletes every verification challenge; and
- writes this declaration id as the final statement.

For catalog v4, a future restored authority deadline can move the durable clock
above the wall-clock sample solely to make terminal session timestamps
representable. That **artificial difference only** is added to the restored
password-attempt window and lock deadline in the same declaration transaction.
Natural elapsed time between backup and restore still ages the attempt ledger;
the fail-closed session frontier therefore cannot accidentally erase the
physical backup's lockout state.

Before computing that frontier, restore validates **every non-null value** in
every inventoried v1 timestamp column and, for `ReadyV2`, every additional v2
timestamp column. Each value must have SQLite storage class `integer` and lie
in `0..=9_007_199_254_740_991`; checking only a per-column `MAX` is invalid
because a valid positive value can hide a negative corrupt peer. Any malformed
value fails before the floor advance, revocation, purge, incarnation rotation,
or declaration marker. Nullable terminal columns participate whenever present.
Including future expiry/deadline columns can conservatively advance the restored
floor far enough that the first GC pass over-expires restored authority; this is
the availability-only residual accepted by LLP 0059's fail-closed clock floor.

For a restored `ReadyV2` catalog, LLP 0055 has lifecycle precedence: the same
non-idempotent transaction also terminates every restored agent credential,
grant, and scoped token and purges invitations and pairing requests before the
declaration id is written. A v1 declaration applies only the shared
session/challenge effects because those v2 authority tables do not exist.

The non-idempotent branch also records success in operator diagnostics without
a secret or source path. Item 5 adds authorization-stream incarnation
regeneration to this branch of the same transaction before sessions become
enableable. Thus accidentally retaining the same startup argument cannot revoke
sessions or purge challenges created after the first successful start; a newly
generated id is an explicit new destructive declaration.

After the transaction commits, startup removes the declaration file and clears
the capture mailbox. A crash before file removal is harmless because the durable
id makes retry a no-op. Ordinary restart carries no declaration and does none of
these things. An undeclared restore can resurrect backed-up sessions until
expiry; this is the explicit residual LLP 0039 pins.

## Concurrency, locks, and linearization

No cryptographic file I/O or mailbox wait occurs while the SQLite writer is
held except the bounded HMAC already required by the exchange transaction.
Lock order is:

```text
auth-maintenance gate
  -> keyed address/mailbox coordination (request-code, exchange, mailbox GET)
  -> keyring lock
  -> SQLite writer transaction
  -> mailbox map (publish/erase after commit)
```

Ordinary provider calls take the maintenance gate shared; backup, restore,
catalog activation, rescue, and reset take it exclusive. No code takes an
earlier lock while holding a later one.

An operation that owns a shared maintenance admission and keyed address stripe
for password planning releases both before projection `Begin`. The
independently owned durable commit then acquires one fresh shared admission
after `Begin` and carries only that guard through Local/SQLite. It MUST NOT
reacquire shared maintenance while retaining the planning guard. Tokio's fair
read/write gate blocks new readers behind a queued writer; nested read
acquisition would self-deadlock when periodic GC queued for the exclusive gate
while password signup, signin, recovery consume, change, or set was between
planning and commit. Exact durable predecessor checks make a same-address race
after planning a typed predecessor-change outcome, never a stale commit.

**Where this lock order meets LLP 0059's projection barrier, 0059 is
authoritative.** LLP 0059 requires every database/provider guard to be released
before projection `Begin` and prohibits a projection lock from overlapping a
provider/catalog lock. This document's maintenance/address/keyring/writer chain
sits entirely *below* that boundary: the provider completes its transaction and
releases these guards, and only then does projection run. The composed lock
graph — maintenance, address, keyring, database writer, then (disjoint)
topology, stream, and projection guards — is owned by LLP 0059's ordering; this
document contributes the provider-side sub-order and defers to 0059 for how it
composes with projection. An implementation that holds a maintenance or address
guard across projection `Begin` violates 0059, not this document, and
publishing the single composed graph with race/deadlock coverage is a named
cross-document obligation.

| Operation | Linearization point |
|---|---|
| request-code | challenge transaction commit; response only after mailbox publish |
| exchange wrong/lock | committed attempts update |
| exchange success | consume + identity + session transaction commit |
| refresh | tombstone + current-token swap commit |
| logout/family alarm | generation/revocation commit |
| session-cap eviction | same commit that creates the new session |
| reset | app + auth delete transaction commit |
| rescue | copy + manifest rewrite + source drop commit |
| key rotation | fsynced rename + parent fsync |
| backup | SQLite online snapshot and retained keyring bytes under quiescence |

Commit ambiguity is handled by **exact-durable reconciliation, matching LLP
0059** (`LLP 0059#rollback-and-ambiguous-commit`), not by unconditional
discard. After a storage error where commit success is unknown, the server
rereads the exact durable rows in a fresh transaction and resolves against what
it finds:

- exact planned-predecessor state ⇒ the mint/rotation did **not** commit; roll
  back in-memory, destroy the plaintext successor/code, and report unavailable;
- exact intended-successor state ⇒ the write **did** commit; the operation is
  finalized, and the plaintext credential already computed for that exact
  successor may be returned (it is the committed one, never a retry);
- any other valid state ⇒ reconcile against it without reverting; and
- contradictory, unreadable, or still-ambiguous state ⇒ terminal recovery
  posture (`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` / rebuild), never a guess.

The invariant a reader should carry away: the server **never re-executes** a
mint or rotation with a fresh plaintext credential on an assumed rollback; it
either confirms the exact durable outcome and returns that one, or fails
unavailable. (An earlier revision of this section stated unconditional
discard-and-unavailable; that contradicted LLP 0059 and the implementation,
which reconcile the exact successor, and is corrected here.)

## Security and redaction

The following are secret material and never appear in logs, diagnostics,
receipts, spans, panic messages, public/gated inspect payloads, runtime state,
change rows, exports, or ordinary `Debug`: codes, session bearers, session-token
hashes, code digests, key material, `sbic_`, and secret-read lease/root material.
Hashing a secret into telemetry is also forbidden by `LLP 0009#secrets`.

Canonical addresses may appear only in protected identity rows, protected
verification-challenge rows, and the fully gated mailbox response. They do not
appear in request/throttle/code diagnostics.
Admin identity/session projections may expose user/session ids, provider,
timestamps, and revocation state only through `AdminSecretRead`; they omit every
digest and key id.

All credential endpoints set `Cache-Control: no-store`; middleware must also
disable body capture/access logging for those routes. Request body and header
size limits run before parsing. CORS never treats possession of an admin,
console, secret-read, session, or impersonation string as interchangeable
authority.

## Acceptance

### Catalog and reservation

- Codegen rejects lower-, upper-, and mixed-case auth-reserved tables and
  indexes. Storage rejects auth-reserved tables, fields, and indexes on apply
  and stored-manifest reopen, and a runtime table-resolution negative proves
  the central storage boundary. This item does not claim a separate wrapper
  test for every future sync/live/export/admin-edit projection.
- `Uninitialized`, unmarked table collision, current-catalog global-name
  collision, exact legacy v1, exact current v2, unknown marker, corrupt marked
  catalog, and extra catalog-object states each produce the pinned result.
  A test-only fixture installs the exact frozen-v1 descriptor and marker,
  closes and reopens it as `ReadyV1`, completes an email-code exchange that
  creates a session, refuses an agent-principal write with no row created and
  no agent tables present, and proves current-catalog activation leaves marker
  `1` unchanged. A fresh production fixture activates directly to `ReadyV2`;
  no production path creates a fresh v1 catalog.
- Stage inspection is byte/WAL-frame read-only. Activation crash injection
  before/after keyring publication, each DDL group, marker insert, commit, and
  post-check yields only retryable pre-catalog or exact `ReadyV2` for a fresh
  database, while a pre-existing exact `ReadyV1` remains unchanged.
- Every auth write, reset, GC, and rescue assertion proves no app journal row,
  commit-version advance, receipt, or live wake unless the operation also
  changes ordinary app data as part of reset/rescue manifest handling.

### Keyring and crypto

- Fixed vectors pin NFC/full-string default lowercase output (including Greek
  final sigma), LP framing, HMAC bytes, base64url, CRC32, bearer length, and
  SHA-256 input bytes in Rust and JS fixtures.
- RNG failure, missing-after-catalog, corrupt JSON, unknown fields/version,
  wrong owner/mode, symlink/hardlink substitution, oversize file, duplicate key,
  missing active key, and interrupted atomic replacement all fail closed without
  overwriting prior bytes.
- First activation auto-mints mode `0600`; memory mode persists nothing.
  Rotation publishes before first use; keyring tests retrieve retired keys and
  prove pruning cannot remove a referenced key, while provider exchange selects
  the challenge row's stored `key_id` rather than the current active key.
- A marked catalog with a missing/corrupt keyring binds with the redacted health
  diagnostic, keeps session-digest resolution available, and makes every
  provider operation fail closed without replacement minting.

### Provider state machine

- Canonical-equivalent addresses converge; invalid/control/whitespace/length/
  multi-`@` cases reject without echo. There is no dot/plus/IDNA rewrite.
- Known and unknown addresses get the same accepted request shape/status and
  both create a challenge. The `test` profile proves the exact per-address
  boundary; every profile proves the global and mailbox boundaries; `dev` and
  `demo` prove repeated capture-only ceremonies do not hit the recipient-spam
  budget.
- Serialized admission/interleaving tests on one address leave exactly one
  active challenge and one mailbox entry; the stripe plus transaction is the
  linearization proof, and a late older publish is impossible. Consume,
  supersede, reset, expiry, and process death clear plaintext capture; mailbox
  commit-boundary tests never return a consumed, superseded, or reset entry.
- Wrong attempts 1–4 commit and return `CODE_INVALID`; wrong attempt 5 commits
  and returns `CODE_LOCKED`; correct attempt 5 succeeds; later attempts lock.
  Unknown, expired, consumed, and superseded are uniform invalid outcomes.
- Competing correct-exchange admissions serialize to one consumed challenge
  and one session; first-login transaction constraints converge one canonical
  address on one user and identity. The 21st live session revokes the
  deterministic oldest and never yields 21 live rows.

### Session generated interleavings

The item-3 suite runs deterministic generated and table-driven small-state
traces over the provider/storage state machine. It covers:

1. current N refreshes to N+1; N ordinary use inside/outside grace;
2. N refresh inside grace (`REFRESH_SUPERSEDED`, no revoke) and outside grace
   (revoke);
3. N-2 and N-3 ordinary/refresh reuse while tombstones remain;
4. two refreshes racing from N;
5. refresh commit with a lost response and no retained successor;
6. thief rotates first, victim cannot reconcile, and the family alarm is
   delivered, duplicated, delayed, or response-lost;
7. logout racing refresh and session-cap eviction; and
8. sliding use at just-before/at/after three days, sliding expiry, absolute
    expiry, restart, and GC.

Every provider trace asserts the exact matrix outcome, at most one current token, all
predecessors attributable until absolute expiry, monotone generation only for
revocation-class events, stable session/authority-instance ids across rotation,
and no revival after expiry/revocation.

Sleeping/woken client custody reload and a permanently offline alarm are
item-4/5 client-coordinator acceptance, not claims about the item-3 provider.
Family-alarm cases assert the fixed-minimum response gate, one opaque
status/body/header shape, and that only an attributable tombstone can change a
session. The SQL is one fixed implementation path; this version does not claim
instrumented query-plan or transaction-count equivalence.

### Credential non-substitution

For mailbox, mint-session, rescue, and impersonated function-run, the suite
crosses these presented carriers:

| Presented material | AdminWrite | AdminSecretRead | Impersonation effect |
|---|---:|---:|---:|
| ordinary admin token | yes | no | no |
| persisted console credential | declared admin scope only | no | no |
| `sbrl_` secret-read lease | no | scoped yes | no |
| secret-read minting root without `sbic_` | not serializable | n/a | no |
| session bearer | no | no | no |
| `sbic_` only | no | no | no (missing AdminWrite) |
| admin credential + live `sbic_` | yes | no | yes in allowed profile |

Wrong header, expired/restarted `sbic_`, prod profile, operation mismatch, and
browser-client attempts all refuse before the effect. The admin client never
persists or attaches `sbrl_` to mutation/action calls and never accepts/attaches
`sbic_` at all.

The profile matrix separately proves that `demo` may use mailbox/mint but may
not invoke collision rescue; rescue succeeds only in `dev` or `test`.

### Rescue, backup, restore, and hygiene

- Rescue is exercised for dormant and stored-manifest collisions, mixed-case
  names, rows containing duplicate/NULL/blob/JSON values, unique and partial
  indexes, incoming/outgoing foreign keys, external triggers/views, and every
  unsupported schema class. Failure injection after each algorithm step leaves
  source and manifest logically intact. A manifest rewrite clears artifact
  hashes and cannot attest matched until explicit reprovisioning. Success
  survives reopen and the next collision check.
- Recovery posture is loopback-only and exposes exactly health plus the selected
  rescue operation. Missing/wrong AdminWrite, missing/wrong/restarted `sbic_`,
  `demo`/`prod`, non-loopback, every other route/operation, and every crash before
  rescue commit produce no catalog, keyring, manifest, function, or app-data
  effect. Tests separately allow only the declared owner-only operator sidecars.
  Success still refuses app execution until restart.
- Backup runs with writes and key rotation attempting to race it. The restored
  database opens without WAL, every challenge's `key_id` exists in the captured
  keyring, hashes match, and no half-published output directory is accepted.
  A raw directory lacking the closed backup manifest is rejected as a restore
  source; byte-copy race behavior is deliberately not represented as backup.
  The exact frozen-v1 fixture records catalog version `1` in its backup
  manifest and reopens the restored image as `ReadyV1` with marker `1`; v2
  retains marker `2` through the same path.
  Publication tests assert `Published` for the clean path, `Unpublished` for a
  proven pre-rename failure, and `CommitAmbiguous` for a rename that takes
  effect but reports failure, post-rename validation failure, and parent-fsync
  failure; every error diagnostic carries the same machine-readable state and
  no ambiguous path destructively cleans the surviving unit.
- Declared restore revokes sessions and purges challenges; repeat of the same
  durable declaration id is idempotent even after new sessions exist; ordinary
  restart preserves both. Item 5's acceptance extends the non-idempotent branch
  of the same transaction with incarnation regeneration. A **future-dated or
  clock-rolled-back backup** restores without violating the
  `created_at_ms <= revoked_at_ms` check, because restore time is the durable
  floor; and the bulk-revocation transaction is asserted independently (every
  not-already-revoked session revoked with one generation increment, nothing
  deleted), including its consumption by the LLP 0058 downgrade path.
  A v2 fixture additionally proves LLP 0055's credential/token/grant
  termination and invitation/pairing-request purge in the same idempotent
  declaration transaction.
  ReadyV1 evidence proves the same shared restore path without querying absent
  v2 tables, and a populated nullable terminal field can be the frontier.
  Mixed valid-positive plus negative and valid-positive plus non-integer
  restored timestamp fixtures each refuse before every destructive effect and
  leave the floor, session, challenge, incarnation, and declaration marker
  unchanged.
- **Token-digest uniqueness** is proven across current and tombstone tables at
  issuance and rotation: a candidate colliding with a live tombstone is
  retried and, on the third collision, surfaces the retryable outcome (never
  the raw internal-collision diagnostic). Deterministic collision injection
  currently proves the storage/provider transaction and coordinator result
  seams; ordinary HTTP and host-operation tests prove their shared route loops,
  but this Spec does not claim deterministic first-/third-collision injection
  through both public projections.
- **Malformed family-alarm input** with a dummy digest deliberately collided
  against a retained tombstone revokes **nothing** (the parsed-ok predicate
  gates the write), while a well-formed attributable tombstone still revokes.
- **Commit-ambiguity reconciliation** for mint and rotation is fault-injected at
  the commit boundary and proves exact-predecessor rollback, exact-successor
  finalize (returning the committed credential, never a re-execution), and
  fail-closed divergence — never a fresh re-mint on assumed rollback. Rescue
  separately injects the SQLite commit boundary: a definite rollback preserves
  the source and refuses, a commit whose acknowledgement is replaced by an
  error returns the already-computed success only for the exact durable
  successor, and a committed but deliberately divergent state refuses rather
  than reporting success. Pre-commit injection still covers every algorithm
  step.
- **Rescue identity**: a sparse-`rowid` and a deleted-high-water `AUTOINCREMENT`
  source are each either preserved exactly or refused (never renumbered);
  valid LLP 0058 settled, pending-restart, and quarantined tuples whose active
  manifest names the collision are each refused by
  `SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED` without changing any of the
  four logical key values (including the settled staged-key absence) or either
  physical table name. A reserved source name outside the app-identifier
  grammar is still nameable to the recovery verb.
- Planted code/token/carrier and caller-controlled selector sentinels cover the
  credential-bearing request, result, debug, diagnostic, and keyring seams;
  existing config/receipt tests continue to own their separate redaction
  classes. Every inbound auth DTO has negative unknown/duplicate-field
  coverage, and representative output DTOs have positive schema instances;
  Rust schema-generation/serialized-fixture drift gates agree. The independent
  JS fixture pins the cross-language crypto bytes, not every DTO schema.

## Implementation hand-off

The expected code seams are:

- `crates/snapback/src/auth/{mod,crypto,keyring,mailbox}.rs` for the provider service;
- `crates/snapback/src/storage/auth.rs` for direct catalog/state transactions;
- `crates/snapback/src/admin_impersonation.rs` for the process-bound carrier;
- `crates/snapback/src/secure_file.rs` for the reusable fsyncing atomic-replace primitive;
- `crates/snapback/src/server.rs`, `crates/snapback/src/host_ops.rs`, and `crates/snapback/src/cli.rs` for registered
  projections;
- `crates/snapback/src/schema_export.rs` and committed `schemas/` for DTO authority; and
- codegen/storage/auth integration suites for the acceptance above.

Implementations may choose internal Rust type/module names and crate helpers.
They may not vary the wire spelling, DDL invariants, digest/checksum framing,
constants, state outcomes, carrier separation, rescue atomicity, or backup unit
without revising this Draft and its fixtures.

## Dated amendment: prefixed identifiers (2026-08-01)

[LLP 0148](./0148-prefixed-identifiers.decision.md) changes the spelling of the
four catalog object ids this Spec pins in §Randomness and identifiers. Recorded
here because this Spec is Accepted and 0148 may not silently reinterpret it.

**What changes.** `_auth_users.id`, `_auth_identities.id`, `_auth_sessions.id`,
and `authority_instance_id` are minted as `usr_`, `idn_`, `ses_`, and `aut_`
plus a 26-character Crockford base32 body. `usr_` takes 16 CSPRNG bytes rather
than UUIDv7 bytes, because a time-ordered user id reveals account-creation time
to every other user (LLP 0148 §D3); the other three stay time-ordered.

**What does not change:**

- **The catalog DDL, and therefore the catalog version.** These are `TEXT`
  columns with no format constraint, and §Catalog states compares DDL, not
  data. Exact v1/v2 recognition is unaffected and **no marker bump is taken**.
  A `CHECK` on the prefix would require one and is deliberately declined.
- **Every credential spelling.** `sbs_` bearers keep their 56-byte form, CRC-32,
  and base64url alphabet; `sbc_` and `sbak_` are untouched. §Session bearer and
  at-rest digest stands as written. LLP 0148 §D7 specifies an environment
  marker for bearers but defers it, gated on the first `deploymentCapable`
  target under LLP 0060.
- **Minting discipline.** Ids still come from the injected `RandomSource`, still
  fail closed as `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` when the CSPRNG is
  unavailable, still zeroize rejected buffers, and still retry a collision
  within the three-candidate bound.

**Compatibility.** There is no backfill and no rewrite. A catalog activated
before this amendment keeps hyphenated UUIDv7 ids in these columns
indefinitely, and every reader accepts both spellings — the shared predicate is
`ids::is_minted_identifier`. Refusing the older spelling would report data
Snapback itself wrote as corrupt.

**Non-substitution is unaffected.** §Credential non-substitution's guarantees
rest on digest resolution and the cross-table absence check, not on id shape.
Prefixes are advisory (LLP 0148 §D4) and no authorization, resolution, or
fencing decision reads one.

## Dated amendment: LTX-boundary capture discipline (2026-08-06, ratified by the author 2026-08-06)

[LLP 0188](./0188-ltx-sqlite-replication.rfc.md) (Accepted 2026-08-06)
builds continuous LTX replication of the instance database — which contains
this Spec's `_auth_*` catalog — and composes restores with this Spec's
declared-restore obligations. Its restore pairs a retained LTX transaction
boundary with the keyring snapshot governing that boundary, which security
boundary 4 ("one quiescence boundary") and §Consistent backup's raw-copy
exclusion do not admit as written. Recorded here because this Spec is
Accepted and LLP 0188 may not silently reinterpret it. Drafted at the
author's direction and ratified by the author in-session 2026-08-06.

**What changes.** A second physical-capture discipline is admissible for
the auth unit: a database materialized by LTX restore at a **retained
transaction boundary within LLP 0188's restorable frontier**, paired with
the **governing keyring snapshot** selected through LLP 0188 §2's
head-committed coverage chain. The consistency-equivalence argument,
accepted with this amendment: an LTX restore is transactionally exact at a
commit boundary — unlike the fuzzy raw copy the exclusion targets — and
the frontier's ordering invariant (keyring snapshot durable before any
dependent frame counts as replicated) guarantees the governing keyring is
at least as fresh as any `key_id` the boundary's catalog rows can
reference, with §Restore's missing-`key_id` check still failing closed on
any gap.

**What does not change:**

- **Boundary 4 for the quiesced lane.** `snapback auth backup` and its
  single-quiescence-boundary contract are untouched; the LTX discipline is
  additional, not a replacement.
- **The raw-copy exclusion.** A raw `cp` of database/WAL/keyring while the
  server runs remains explicitly not a Snapback backup; the LTX discipline
  qualifies only through LLP 0188's verified restore path (integrity
  check, checksum continuity, lineage binding).
- **Declared restore.** Every obligation of §Restore applies unchanged to
  an LTX-materialized instance: the output is non-servable until the
  declared-restore composition runs (bulk session revocation, challenge
  purge, `--restored-from-backup`), exactly as LLP 0188 §6 already
  requires. The "undeclared restore can resurrect backed-up sessions"
  residual gains no new surface.

## Dated amendment: the startup diagnostic names the missing sidecar (2026-08-08)

[LLP 0192](./0192-store-durable-state-set.decision.md) (Accepted 2026-08-08)
declares the complete durable-state set of a file-backed store and adds a
supported copy verb. Its D-4 changes one behavior this Spec pins, so it is
recorded here rather than left to drift.

**What prompted it.** A byte-identical copy of a sessions-mode database, taken
without `<db>.auth-keyring.json`, boots with a `Ready` catalog and refuses every
provider operation with `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` naming nothing. The
zerobugs `zb5-hot` gate burned a complete receipted attempt (`v4`, 2026-08-07)
probing in isolation to learn which file was missing
(`issues/20260808-sessions-store-copy-needs-auth-keyring-sibling.md`).

**What changes.** The code has two audiences and now two shapes:

- The **request-path 503** returned to HTTP clients is unchanged — no path, no
  `"keyring"` string, no details. §Security and redaction governs it and it
  reaches unauthenticated callers.
- The **startup/operator diagnostic** recorded at inspect time carries
  `{durableStateMember, path, cause, remedy}`: the exact
  `<db>.auth-keyring.json` path, whether it is `missing` / `corrupt` /
  `unavailable`, and a pointer to `snapback store export`. It carries no key id
  and no key material — §Security and redaction's secret list is unchanged, and
  a filesystem path is not on it. §Diagnostics' "details may include … object
  kind/name where the operator must repair schema" is read to include the
  path-bound sidecar the operator must repair.

**What does not change.** Startup still never mints a replacement ring for a
marked catalog, session resolution stays keyring-independent, and the health
fact stays `authProvider: unavailable`. `snapback auth backup` / `auth restore`
keep their neutral layout and destructive declared-restore semantics;
LLP 0192's `snapback store export` is a separate, non-revoking, directly
bootable copy that reuses this Spec's descriptor-bound capture and three-state
publication contract.

## Dated amendment: named effect-budget compatibility policy (2026-08-10)

[LLP 0215](./0215-effect-budgets.spec.md) wave 2c replaces the four independent
numeric authorities for request-code admission, challenge attempts, and
capture-mailbox occupancy with one named compatibility budget policy. This is
an ownership and vocabulary migration, not a limit change.

**Named ownership and classes.** The exact mappings are the four budget rows in
§Normative vocabulary and constants. Per-recipient delivery, global challenge
allocation, and mailbox occupancy are `SUCCESSFUL_EFFECT` rules. The
per-challenge guessing total is an `ATTEMPT` rule. Their axes, harms, recovery
classes, server-derived trust-tier shape, complete normalized-request retry
identity, and structured refusal fields are governed by LLP 0215. The active
compatibility policy currently resolves the same finite terms for all six
server-derived trust tiers; later tier scaling requires an explicit policy
amendment and cannot arrive from a request header or other client carrier.

**Profile overlay.** The base policy keeps the global 120-per-60-second rule,
five-attempt challenge total, and 1,024-entry mailbox occupancy finite in every
profile. The `dev` and `demo` overlays declare only the per-recipient
`auth.delivery` rule `not-applicable`, covered by the finite global
`auth.challenge-allocation` rule. The `test` and `prod` overlays apply the
per-recipient five-per-10-minute rule. No profile or trust tier is represented
as unlimited.

**Exact behavioral compatibility.** §Request-code transaction and §Challenge
states and exchange remain authoritative without reinterpretation:

- rolling rows still occupy `(now - window, now]`, so an event exactly one
  window old is excluded;
- the request-code rules charge only when the challenge transaction commits,
  and an admission refusal inserts no row;
- mailbox reservation is the occupancy charge, counts before durable challenge
  creation, and is released by every pre-commit refusal;
- wrong active-challenge submissions still commit attempts one through five,
  a correct fifth submission still succeeds, and the fixed total saturates
  rather than overflowing after lock;
- unknown, expired, consumed, and superseded challenges gain no new local
  credential charge; and
- due key rotation published before a later admission refusal remains the same
  independent maintenance effect.

**Diagnostics and hosted composition.** `SNAPBACK_AUTH_THROTTLED` and
`SNAPBACK_AUTH_CODE_LOCKED` remain the public compatibility codes and retain
their existing statuses and non-enumerating messages. They now carry LLP
0215's structured `budgetName`, truthful `retryAfter`, and fresh opaque
`correlationId` fields. LLP 0060 §D3's hosted source/global GCRA transaction
continues to compose outside these local compatibility counters: all applicable
hosted attempt buckets charge atomically on denial and fail closed when their
shared authority is unavailable. This amendment neither duplicates nor
weakens that hosted authority. LLP 0213 continues to own rehearsal grant/window
state and numeric rehearsal policy; ordinary compatibility budgets do not
rename or borrow those counters.

## Open questions

No open question blocks item 3's local-v1 implementation. The following are
explicit later-version questions and are not implementation latitude here:

- whether a future external provider restores an account table;
- whether address identity gains an IDNA/provider-specific migration;
- whether session credentials become sender-bound (DPoP/WebCrypto);
- whether hosted targets replace the process bearer with a platform operator
  identity; and
- whether a monotonic anchor outside the backup unit can detect undeclared
  restore.

## Status

**Accepted.** ENG-24596/item 3's v1 base is implemented and retained as exact
legacy recognition: the protected catalog and keyring, email-code provider,
capture mailbox, session-family state machine, operator impersonation carrier,
collision rescue, and quiesced database-plus-keyring backup/declared restore
are exercised by executable vectors, state-model traces, and failure
injection. The current composed implementation follows LLP 0055 precedence:
fresh catalogs are v2, exact legacy v1 remains usable without silent migration,
and v2 reset/restore includes its additional authority classes. Those artifacts
are the implementation acceptance authority; prose alone would not have been
sufficient.

Implementation completion alone did not make this Spec Accepted. ENG-25001
closed the material review findings, the blind FINAL4 Codex and Fable reviews
both returned READY, and Charlie Cheever explicitly ratified the resulting
Spec on 2026-07-15. That author decision advances this document only; it does
not advance frozen LLP 0039.

The ENG-24996 review gate obtained a cross-family GPT (Codex) review of this
document on 2026-07-14; its verbatim report and provenance are archived in
`reviews/0057-auth-provider-protocol.codex.md` (round 1, verdict: READY WITH
REVISIONS). A second dual-family round (fresh Codex ultra + fresh Fable Max,
blind, via /llp-super-refine) reviewed the committed revision at `b11a6fa` the
same day; both artifacts are archived with provenance in
`reviews/0057-auth-provider-protocol.{codex,fable}.md`.

### Review triage

The round-2 revision is the author-side triage of both rounds. Dispositions:

**Resolved in the specification text** (a spec incoherence or overclaim, now
fixed): the unspecified bulk-revocation transaction consumed by LLP 0058
(§Bulk session revocation); the commit-ambiguity contradiction with LLP 0059
(§Concurrency — this document no longer states unconditional discard); the
v1-base/v2-extension conflict with LLP 0055 (§Version composition and
precedence — fresh creation is v2 and legacy v1 is recognition-only); the
composed lock-graph precedence deferring to LLP 0059 (§Concurrency); the
`auth.mintSession` wire reconciliation with LLP 0024 (§Public provider DTOs);
the family-alarm malformed-input non-actionability (§Logout…); the declared-
restore clock-floor derivation and the LLP 0059 floor overlay on every durable
`now` (§Normative vocabulary, §Restore); the `generation` domain and the
JS-safe timestamp schema bound; the backup Unpublished/Published/CommitAmbiguous
naming and machine-readable exit projection (§Consistent backup); and restore
descriptor-bound inspection (§Restore).

**Named defect obligations** were closed in the ENG-25001 implementation lane:
cross-table token-digest uniqueness at issuance and coordinator-visible bounded
retry; explicit no-ready-file impersonation stdin intake; and rescue's
rowid-preserve/`AUTOINCREMENT`-refuse policy, commit reconciliation, managed
four-key refusal, and exact reserved physical-source reachability. These are
implementation reconciliations and did not themselves transition Status; the
explicit author ratification recorded above did.

**Historical review observations, superseded by ENG-25001:** the review ledger
recorded that issuance then skipped the tombstone check, restore then passed a
raw `SystemTime::now()`, and `TargetArgs` then had no stdin carrier. Those facts
are retained only as review provenance; the current behavior is the normative
implementation described above. Resolution's current-before-tombstone order
and LLP 0024's row-versus-descriptor question remain design evidence rather
than open implementation defects.

Implementation completion still did not make this Spec Accepted on its own;
the explicit author ratification recorded above did. LLP 0039 remains frozen.
The reviews advised; the author ratified.

**FINAL3 disposition (2026-07-15):** the blind GPT review's material finding is
closed by per-cell integer/range validation before frontier aggregation plus
mixed-corruption no-effect evidence; its ReadyV1 and nullable-field minor is
also covered. The concurrent Fable review was READY; its two wording minors are
resolved by the exact maximum-increment rule and the documented conservative
future-deadline availability residual. The verbatim artifacts and provenance
remain in this document's Codex/Fable review ledgers. This disposition does not
ratify or advance the Draft at that review stage; the later explicit author
decision recorded above advances this Spec to Accepted.
