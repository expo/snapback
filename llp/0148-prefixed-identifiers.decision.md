# LLP 0148: Prefixed identifiers

**Type:** Decision
**Status:** Active
**Systems:** Storage, Auth, Runtime, API, Client protocol, Client integration,
Code generation, Diagnostics, Admin API, Testing
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-08-01 (Accepted by author Charlie Cheever, and implemented in
the same motion — the registry, the per-table document prefixes, the codegen
reservation, the widened validators, the LLP 0057 dated amendment, and the
generated `schemas/id-registry.v1.json` all landed together. §What
implementation surfaced records the three design corrections the build forced.)
**Related:** LLP 0011, LLP 0031, LLP 0037, LLP 0039, LLP 0044, LLP 0055,
LLP 0057, LLP 0059, LLP 0060, LLP 0070

## Summary

Every identifier Snapback mints carries a short lowercase type prefix and a
fixed-length Crockford base32 body: `usr_3n5k7q2wx8mf4b9jd6thzcvr1p`,
`post_01k9m4x7p2q8we5rt3yu6ai0sd`. One registry owns the prefix vocabulary, one
helper mints, and app document ids take a prefix derived from their declared
table.

The prefix is **for humans and for fail-fast shape checks. Nothing branches on
it for a trust or routing decision.** That single constraint is what makes the
rest of this document cheap: prefixes may be stale, may collide across app
tables, and may be absent on rows written before this decision, and none of
those facts can cause a wrong answer.

## Context

### Three id regimes already coexist

Snapback did not lack an id convention. It had three, and the split is inverted
from the one that would help.

**Designed and prefixed — the LLP 0057 credential family.** `sbs_` session
bearers, `sbc_` challenges, `sbak_` keys, plus `sbs2_`, `sct_`, `sct2_`,
`sbrl_`, `sbrk_`, `sbrp_`, `sbrm_`, `sbat_`, `sbagt_`, `sbcc_`. These have
pinned alphabets, canonical unpadded base64url spellings, and a CRC-32 on the
session bearer. They are the most carefully specified strings in the system.

**Ad-hoc and prefixed.** Roughly two dozen `format!("xxx_{}", Uuid::now_v7()
.simple())` sites — `mut_`, `hop_`, `lease_`, `inv_`, `ack_`, `retry_`,
`conn_`, `cm_`, `sub_`, `proj_`, `owner_`, `nagle_`, `store_`, `schema_`,
`srt_`, `dryrun_`, `live_`, `legacy_`. No registry, no shared helper, no
validation, no consistency in prefix length or meaning.

**Bare UUIDv7 — and this is the problem.** `_auth_users.id`, `identity_id`,
`session_id`, `authority_instance_id`, receipt ids, declaration ids, and
**every app document id** (`new_id()` in `crates/snapback/src/storage.rs`).

So the secrets are well designed, the throwaway internal handles are casually
marked, and the durable object identities that users, app code, support
tickets, and URLs actually carry are the unmarked ones. That is backwards.

### The concrete defect

`_auth_sessions` carries `user_id`, `identity_id`, and `authority_instance_id`
adjacently. All three are canonical hyphenated UUIDv7 strings. All three flow
through the same wire DTOs. They are byte-shape identical, so a transposition
passes every validator in the tree and surfaces as a wrong-row read rather than
an error.

LLP 0057 already spends an acceptance section (§Credential non-substitution) on
exactly this hazard for *credentials*, because substituting one opaque string
for another is the dangerous class. Object ids got no such treatment. Prefixes
make the object-id half of that problem shallow: a swapped id fails a shape
check at the boundary instead of silently resolving.

### Why now

`new_id()` is one function today. App document ids are not yet in shipped user
data or in app source outside this repository. After apps ship, changing them
costs a data migration nobody wants to write and cannot fully perform, since
ids leak into app code, URLs, and exported bundles.

The cost curve is the entire argument for doing this in prerelease rather than
scheduling it.

## Options

**A. Leave it.** Free. Keeps three regimes, keeps the adjacent-UUID
transposition hazard, and forfeits the change window permanently.

**B. Prefix, keep the UUID body** — `usr_01912b4c-8f3a-7e21-...`. Rejected: the
worst of both. Standard UUID parsers no longer accept the string, yet the id
keeps 36 characters of hyphenated body. Hyphens also break double-click word
selection, which is a daily cost for a string people copy out of logs.

**C. Prefix with a compact order-preserving body.** Chosen. Details below.

**D. Prefix and add a checksum to every id**, matching the `sbs_` bearer.
Rejected for object ids: checksums earn their keep on strings humans transcribe
or paste across system boundaries (credentials, already done), and cost bytes
and a validation branch on strings machines pass around. Kept for credentials,
declined for object ids.

## Decision

### D1. Grammar

```text
id     := prefix "_" body
prefix := [a-z][a-z0-9]{1,11}
body   := 26 characters of lowercase Crockford base32
```

The body encodes exactly 16 bytes, most-significant byte first. 128 bits in
Crockford base32 is 26 characters, the same width ULID uses.

Total length is 20–38 characters depending on prefix.

### D2. Crockford base32, lowercase — not base64url

The LLP 0057 credential family stays base64url. Object ids do not, because the
two families have different consumers and the encodings optimize for different
things.

Credentials are machine-handled: pasted into `Authorization` headers and
environment variables, where length matters and nobody reads them.

Object ids are read aloud, typed into support tickets, embedded in URLs, and
double-clicked out of terminal output. Crockford base32 is the better fit:

- **No ambiguous characters.** The alphabet excludes `i`, `l`, `o`, and `u`,
  which removes the `1`/`l`/`I` and `0`/`O` transcription failures.
- **One selectable word.** The alphabet contains no `-` or `_`, so the only
  underscore in an id is the separator. Double-click selects the whole id in
  terminals and browsers. A base64url body containing `_` adjacent to the `_`
  separator is genuinely hard to read.
- **Case-insensitive**, so a lowercased or uppercased id still resolves if a
  system in the middle mangles case.
- **Order-preserving.** Crockford's alphabet `0123456789abcdefghjkmnpqrstvwxyz`
  is in ASCII order, so lexical sort over fixed-length bodies equals numeric
  sort over the underlying bytes. Time-ordered bodies stay time-ordered as
  strings, in SQLite indexes and in JavaScript `.sort()` alike.

Four extra characters versus base64url buys all of that.

### D3. Body bytes: UUIDv7 everywhere, random for `usr_`

Every id body is the 16 raw bytes of a UUIDv7 — time-ordered, so ids sort
chronologically and inserts stay local in B-tree pages.

**User ids are the single exception and use 16 CSPRNG bytes.**

The rationale is that the exception costs nothing exactly where the benefit is
highest, not that the risk is large:

- `_auth_users` **already carries `created_at_ms`.** The server can already
  sort and range-scan users by creation time. A time-ordered `usr_` body buys
  the server no capability it does not have.
- Users is the lowest-volume insert table in the system — one row per signup.
  The B-tree locality argument for time-ordered primary keys applies to hot,
  high-rate inserts, which is app documents, not users.
- `ctx.auth.userId` is the intended join key for app-owned profile tables
  (LLP 0011 §Authentication Model), so it lands in URLs and is seen by other
  users. It is the most-exposed id in the system.

A time-ordered user id tells any other user when an account was created, to the
millisecond. On a pseudonymous app, two accounts created 400 ms apart are
almost certainly one person's alt — a deanonymization vector for dating,
health, support-forum, and whistleblower-shaped apps. Snapback is a platform,
so this default is inherited by every app built on it and cannot be undone by
the app developer.

Two things this deliberately does **not** claim. UUIDv7 leaks *when*, not *how
many*: unlike sequential integers, two ids do not reveal how many rows lie
between them, so the count-a-competitor's-users attack does not apply and is
not the motivation here. And a random `usr_` is a partial mitigation, not a
guarantee — an app that creates a profile row at signup and exposes that row's
`v7` id reveals signup time anyway. What this fixes is the platform-issued
identifier that every app will inevitably expose.

Because D5 makes body randomness a per-kind property of a registry row, this
choice is a one-line revision per kind until apps store ids in production.

### D4. The prefix is never load-bearing

Normative, and the constraint the rest of this document depends on:

- No authorization, routing, table selection, or dispatch decision may read a
  prefix. Resolution consults the same storage and the same digests it does
  today. In the auth path specifically, `token_hash` resolution and LLP 0057's
  cross-table absence check remain the sole authority.
- A prefix mismatch may produce a **shape refusal at an input boundary** and
  nothing else.
- Readers MUST accept ids that predate this decision. There is no rewrite, no
  backfill, and no format gate on stored data.

### D5. One registry, one minting helper

A single registry — prefix, id kind, body randomness, owning subsystem —
generated into both Rust and TypeScript under LLP 0037's schema authority.
Adding an id kind is a registry row, not another `format!`.

`format!("{prefix}_{uuid}")` at a call site becomes a lint-visible defect once
the helper exists. The ad-hoc tier is folded into the registry: `mut_`,
`conn_`, `sub_`, `inv_`, and `hop_` keep their spellings and change only their
body encoding; `lease_` shortens to `lse_`; the rest are normalized.

### D6. App document ids take a per-table prefix

An app document's prefix is its **declared table name, ASCII-lowercased, with
non-alphanumerics removed, truncated to 12 characters.** `posts` yields
`posts_`, `blogPosts` yields `blogposts_`.

No inflection. Deriving a singular from a table name needs locale-dependent
rules that surprise people more often than they help; an author who wants
`post_` names the table `post`.

Two consequences, both accepted:

- **Renaming a table does not rewrite existing ids.** A table renamed from
  `post` to `article` holds `post_…` rows alongside new `article_…` rows
  indefinitely. Under D4 this is a cosmetic inconsistency, not a defect.
- **Truncation can collide.** `blogPostsArchive` and `blogPostsArchived` both
  yield `blogpostsarc`. Two tables sharing a prefix lose visual
  distinguishability and nothing else.

**An app table whose derived prefix equals a registered system prefix is a
schema error at codegen** (`SCHEMA_RESERVED_ID_PREFIX`). A table named `usr`
minting `usr_…` documents would make the human-recognition property actively
misleading, which is the one failure this document must not ship.

**Authoring time only — deliberately not at manifest validation**, which is
where the `_auth_*` reservation also runs. That reservation is enforced on
stored-manifest load at every database open (LLP 0057 §Reservation) because an
`_auth_*` table is a *physical collision* with the protected catalog: a
correctness problem. A shadowing id prefix is a legibility problem, which D4
says is explicitly not a correctness problem. Enforcing it on load would turn
a cosmetic concern into a data-availability incident for an app that already
has a table named `usr` — whose existing documents carry pre-0148 UUIDv7 ids
and shadow nothing. Codegen refuses the new schema; storage keeps serving the
old one.

### D7. Environment markers on credentials — specified, not yet built

Stripe's `sk_test_` / `sk_live_` split prevents the catastrophic mistake rather
than the merely annoying one: a test key cannot be pasted into production
because it is structurally refusable before any lookup. The Snapback analogue
is a dev-minted session bearer a hosted target can refuse on shape, composing
with LLP 0060's fail-closed admission.

**Deferred, with the gate named.** LLP 0057 is Accepted and pins the bearer at
exactly 56 ASCII bytes with a CRC-32 over the 32 random bytes and an acceptance
matrix that asserts the spelling. Changing it means amending an Accepted spec's
vectors. More to the point, a `dev`/`live` marker is premature while no target
is `deploymentCapable` — all three capability manifests currently report every
LLP 0060 axis negative, so there is no `live` to mark. This lands with the
first hosted-auth target, not before.

## Consequences

### What changes

- `new_id()` mints per-table prefixed ids; every app document written after this
  lands carries one.
- Auth object ids (`usr_`, `idn_`, `ses_`, `aut_`) change spelling. LLP 0057's
  §Randomness and identifiers pins them as "canonical lowercase hyphenated
  UUIDv7 strings" and takes a **dated amendment**, since 0057 is Accepted.
- Five committed schemas pin the UUIDv7 regex
  (`auth.credential.output`, `auth.session.output`, `client-mutation.ack.input`,
  `mutation.input`, `mutation.output`) and regenerate under LLP 0037.
- `validate_uuid_v7` in `crates/snapback/src/auth/invalidation.rs` becomes a registry-aware
  shape check that accepts both spellings.
- Client-minted mutation ids (`packages/snapback-client`) mint `mut_` through
  the generated TypeScript half of the registry.

### What implementation surfaced

Three things the design did not anticipate, recorded because each is a
constraint on any future id change, not an incident of this one.

**Eleven validators, not one.** Stored-state and wire validators asserting
canonical UUIDv7 were spread across seven Rust modules and three JavaScript
ones. Every validator covering an id LLP 0148 respells now calls the shared
`is_minted_identifier` / `isMintedIdentifier` predicate. Validators covering
`authorizationStreamIncarnation`, the projection startup id, and data-version
streams stay exact, because those are **opaque incarnation markers with their
own persisted-format contracts, not object ids** — LLP 0148 governs identifiers
that name an object across a boundary, and deliberately does not govern them.

**The service authority instance is derived, not minted.** LLP 0055's service
principals compute `authority_instance_id` as a SHA-256 of the credential axes,
implemented independently in Rust and JavaScript with a pinned cross-language
vector. It now spells `aut_` in both, so both arms of `ResolvedAppAuthority`
produce ids that read alike; the UUID version/variant bits the derivation used
to stamp are gone, since they described a shape it no longer produces. The
vector moved from `49082da1-0362-7c7d-bb41-1f6e925b688f` to
`aut_2910pt20v2xhyqpg8zdt95pt4f` in both implementations and the shared test.

**Client mutation ids no longer embed the function name.** They were minted as
`cm_<function>_<random>`, which the two-part grammar cannot express. The name
was dropped rather than accommodated: the queued outbox record already stores
`function` beside the id, so carrying it twice bought nothing. Separately, the
non-crypto minting fallback is **preserved** for time-ordered ids — React
Native/Hermes ships no WebCrypto and the LLP 0043 M2 offline queue must keep
minting there. That fallback is uniqueness without unpredictability, which is
the whole requirement for a dedup key. `Body::Random` ids never reach it and
refuse with `SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING` instead. **The
security-bearing/not distinction maps exactly onto §D3's random/time-ordered
split**, which is the strongest evidence that split is cut in the right place.

### What does not change

- **The auth catalog DDL.** Id columns are `TEXT` with no format constraint, and
  LLP 0057's exact-shape recognition compares DDL, not data. **No catalog
  version bump is required**, and none is taken — adding a `CHECK` on the prefix
  would require one and is deliberately declined.
- Credential spellings, lengths, alphabets, and the CRC-32 (LLP 0057 §Session
  bearer), untouched pending D7.
- Any authorization, resolution, or fencing path, per D4.

### Costs accepted

- Two encodings in the corpus — base64url for credentials, base32 for object
  ids — justified by D2 and worth restating whenever someone asks why.
- Mixed-format data forever, in both the app-table-rename case and the
  pre-decision-rows case.
- Ids grow from 36 to 20–38 characters. Auth ids get shorter; app ids with long
  table names get longer.

## Open questions

- Should the registry generate branded TypeScript types per id kind
  (`UserId`, `SessionId`) so transposition is a **compile** error and not only
  a runtime shape refusal? That is most of the remaining value of this change
  for TypeScript authors, and it is additive once the registry exists.
- Does `usr_` want a stronger guarantee than D3's partial mitigation — for
  instance, a documented pattern for app profile rows that keys off `usr_`
  without exposing a `v7` row id?
- Does the guide's capability index want an id-format row, or is this
  sufficiently invisible to authors to stay out of it?
