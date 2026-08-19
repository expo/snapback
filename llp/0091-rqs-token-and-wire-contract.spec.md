# LLP 0091: RQS token and wire contract (rollout clusters 0A + 0B)

**Type:** Spec
**Status:** Draft
**Systems:** Sync, Realtime, API, Auth, Client integration
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-24
**Revised:** 2026-08-03 (`single_table_v1@1` boundary: the exact shipped
`mset1`/`seq1` selector is copied into normalized node identity; token,
digest, and wire bytes remain unchanged, with no implementation/capability
claim.) 2026-08-02 (Accepted LLP 0136 staged wire fold: optional
live-search cursor on `LiveReplace`, implementation- and offer-gated);
2026-07-25 (dated amendment: step-5 native persistence knobs —
native cadence/budget pinned to the web §0A.5 values, the flush trigger
mapped to the host lifecycle seam, and constrained processes pinned as
never-writers, closing OQ2, ENG-25456); 2026-07-24 (dated amendments: step-1 implementation
reconciliation — `sbrq_` key-id prefix, the symmetric integral-double
refusal band, the interim content-derived `queryArtifact`; the rung-2
membership witness — wire format, caps, reconciliation rule, replay
algorithm, and two new refusal codes, closing OQ1 / LLP 0090 Q7 for rollout
steps 5a+6, ENG-25457; the step-5/step-3 reconciliation — the
eviction-ordering pin, the `versionStream`-as-identity arbitration pin, and
the standing interim `queryArtifact` note, ENG-25454; and the step-4
Cloudflare-arm reconciliation — DO-storage keyring table, Cloudflare
`generation`/`versionStream` minting, the still-standing interim
`queryArtifact`, and this arm's rung-1/3-only ladder, ENG-25455)
**Related:** LLP 0008, LLP 0031, LLP 0034, LLP 0039, LLP 0043, LLP 0051, LLP 0053, LLP 0077, LLP 0090

## Summary

LLP 0090 (Accepted) defines resumable query snapshots and names six
prerequisite contract clusters in its Rollout sketch. This spec **pins
clusters 0A (token & digest cryptography) and 0B (wire schemas)** so that two
independent implementers — the Rust local arm, the Cloudflare Worker/DO arm,
and the JS client — produce byte-compatible artifacts. Everything here is a
contract statement; no behavior ships with this document. Wire additions land
through LLP 0051's schema-governed drift gates (`crates/snapback/src/live_wire.rs`,
`crates/snapback/src/schema_export.rs`, `crates/snapback/tests/artifact_schemas_v0.rs`); endpoint changes take
LLP 0031 route-taxonomy entries in cluster 0D.

The seed for 0A is the Round-6 implementer-lens review of LLP 0090
(`llp/reviews/0090-resumable-query-snapshots.fable.md`, "Round 6 —
implementer lens"), which drafted a candidate contract with a 16-item
decision log and a 10-item spec-gap list. This spec ratifies or overturns
each of those decisions (see **Decision log disposition**) and closes every
spec gap; the RFC's v0.6 revision already absorbed most of the gaps into
0090's own text, and this document pins the parameters 0090 deliberately left
to 0A/0B.

Terminology is 0090's: `rqsEligible`, rungs 1–3, `CurrentAsOf`, reattach vs
resume, Channels A–C.

## 0A — Token and digest cryptography

### 0A.1 Token envelope, MAC, keyring, custody, expiry

**Wire form.** The resume token is an opaque, self-describing envelope:

```
tokenWire = "sbrt1." keyId "." b64url(bodyBytes) "." b64url(mac)
```

- `sbrt1` is the token-contract version; any future incompatible change to
  this section mints `sbrt2` tokens and continues verifying `sbrt1` through
  the keyring overlap window.
- `keyId = "sbrk_" <22-char base64url>` — a resume-keyring key id following
  the `AuthKeyId` shape (`crates/snapback/src/auth/crypto.rs` credential-prefix registry;
  `sbrk_` is a new prefix in that registry, 16 random bytes, base64url no
  pad).
- `bodyBytes` is the RFC 8785 (JCS) serialization of `tokenBody` (§0A.2's
  encoding, applied to the body object itself).
- `b64url` is base64url without padding (repo precedent: `URL_SAFE_NO_PAD`
  in `crates/snapback/src/auth/lease.rs`).
- Maximum accepted token size is **1 KiB** of `tokenWire` bytes; oversize
  refuses with `SNAPBACK_RESUME_TOKEN_OVERSIZE`.

**Body.** Per LLP 0090 D1 (v0.6):

```
tokenBody = { app, generation, versionStream, version,
              queryArtifact, argsHash, digestKind, contentDigest,
              issuedAt, authPartition? }
```

- `issuedAt` is u64 milliseconds since the Unix epoch, sampled from the
  server clock at mint (the name is 0090's pinned field name; the unit is
  stated here). It is the expiry anchor.
- `authPartition` is reserved and **absent** in v1 (not `null` — the key is
  omitted from the body and MAC'd as tagged-absent, `put_optional_string`
  with `None`, so the v2 door changes bytes only when the field appears).
- `digestKind` is `"mset1"` or `"seq1"` (§0A.4). `contentDigest` carries a
  matching self-describing prefix; a prefix/field mismatch is refused at
  admission (`SNAPBACK_RESUME_DIGEST_KIND_MISMATCH`).
- `queryArtifact` is the per-function generated-artifact hash carried in the
  served functions manifest for the query, `sha256:` + 64 lowercase hex.
- `argsHash = "sha256:" + hex(SHA-256("snapback-rqs-args-v1\0" || jcs(args)))`
  where `args` is the subscription's canonicalized argument object under
  §0A.2 (fingerprint style follows `mutation_input_fingerprint`,
  `crates/snapback/src/storage.rs`, with an added domain tag).

The token is **self-describing**: admission decodes `bodyBytes` from the
token itself, with unknown body fields refused (`deny_unknown_fields`
posture is safe because only the minting server family ever decodes its own
tokens; new fields require `sbrt2`). The clear `meta` copy (§0B) is never an
admission input.

**MAC.** HMAC-SHA256, untruncated (32 bytes), over a length-framed
transcript in the exact style of `crates/snapback/src/auth/lease.rs` (`put_string` =
u64-big-endian length then bytes; `put_u64` = 8 big-endian bytes;
`put_optional_*` = 0x00 for absent, 0x01 then value for present):

```
transcript = put_string("snapback.resume-token.v1")
             put_string(keyId)
             put_string(app)
             put_string(generation)
             put_string(versionStream)
             put_u64(version)
             put_string(queryArtifact)
             put_string(argsHash)
             put_string(digestKind)
             put_string(contentDigest)
             put_u64(issuedAt)
             put_optional_string(authPartition)   // absent in v1
```

The MAC is computed over the transcript, **not** over `bodyBytes`, so JSON
serialization ambiguity can never widen the forgery surface; admission
rebuilds the transcript from the decoded body plus the envelope `keyId` and
verifies in constant time. `keyId` is outside the body but inside the
transcript (the lease's own pattern). MAC verification failure refuses with
`SNAPBACK_RESUME_MAC_INVALID`.

**Keyring.** A dedicated resume keyring per served instance, reusing the
`crates/snapback/src/auth/keyring.rs` machinery pattern (active key mints; retired keys are
retained for verification; `rotate_if_due` cadence) but as a **separate ring
and file** from the auth keyring — resume-key compromise or loss must never
touch session/lease security, and vice versa. Parameters:

- Active-key rotation age: **30 days** (mirrors `AUTH_KEY_ROTATION_AGE_MS`).
- Verification overlap: the ring verifies under the active key plus the **2
  most recently retired keys**, each for at most **14 days** past its
  retirement. Within the window, routine rotation is invisible to clients.
- Past the window (key present but too old): refuse
  `SNAPBACK_RESUME_KEY_RETIRED`. Key id absent from the ring entirely:
  refuse `SNAPBACK_RESUME_KEY_UNKNOWN`. Both are distinct from
  `SNAPBACK_RESUME_GENERATION_STALE` per 0090 D1.1's diagnostics
  requirement.

**Custody per arm** (0090 0A: "Worker secret vs DO storage vs local store"):

- **Cloudflare arm:** the resume keyring lives in **coordinator Durable
  Object storage**, not a Worker env secret. The coordinator is the sole
  minter and verifier, DO storage is transactional with the data it
  protects, and rotation must not require a deploy.
- **Local arm:** a `resume-keyring.json` under the instance's `secure_file`
  discipline (`crates/snapback/src/secure_file.rs`), beside the auth keyring file, surviving
  restart. Dev-loop restarts therefore do **not** refuse outstanding tokens.
- **Key loss is availability-only** on every arm: a lost/wiped ring means
  every outstanding token refuses (to rung 3 — fresh `LiveReplace`); it is
  never a correctness or security event, and no recovery path may accept an
  unverifiable token.

**Expiry.** Admission refuses when
`serverNow - issuedAt > maxTokenAgeMs` with `SNAPBACK_RESUME_TOKEN_EXPIRED`.
Default `maxTokenAgeMs` = **30 days**, a server policy knob. Per 0090 v0.6,
expiry is a server-admission staleness backstop plus key hygiene only — it
does not bound offline retained display (LLP 0043's never-presented-as-
current rule governs that). A server clock earlier than `issuedAt` refuses
as malformed/implausible rather than negative-age-accepting.

### 0A.2 Canonical row encoding (shared Rust / JS-Worker / JS-client / native)

The canonical encoding for every digest and hash input in this contract is
**RFC 8785 JSON Canonicalization Scheme (JCS)**: UTF-8 bytes, object keys
sorted by UTF-16 code units, ECMAScript shortest-round-trip number
serialization, JSON string escaping exactly as RFC 8785 specifies, **no
Unicode normalization** (bytes as stored are hashed as stored).

**Mint-time refusal rules.** A row (or args object) is refused at mint —
the subscription simply gets no token / `resume: null`, never a wrong
digest — when it contains:

- a non-finite number (NaN, ±Infinity) — parity with `canonicalValue`'s
  refusal in `packages/snapback-client/external-store.mjs`;
- an integer with magnitude above 2^53 − 1, or any number whose JCS
  serialization does not parse back to an equal value (these cannot
  round-trip through JS clients);
- a string that is not well-formed Unicode (lone surrogates);
- for `mset1` digests: a row without a stable wire row id, or two rows
  sharing one id (duplicate ids are refused at mint exactly as they are
  refused in a rung-2 witness).

Negative zero needs no rule: JCS serializes it as `0`, matching
`canonicalValue`'s normalization.

`canonicalRowId` is the UTF-8 byte sequence of the wire row id — the same
string carried as `LiveDeltaWireOp.id` (`crates/snapback/src/live_wire.rs`) and stored as
`_snapback_changes.row_id`.

```
rowHash = SHA-256("snapback-rqs-row-v1\0" || jcs(row))        // 32 bytes
```

Hash domain tags in this spec follow the repo's hash-tag convention
(hyphenated name + NUL byte, as in
`targets/cloudflare/scripts/generate-deployment-identity.mjs`); MAC transcript
domains follow the dotted `put_string` convention of `crates/snapback/src/auth/lease.rs`.

### 0A.3 Leaf construction (domain-separated, length-framed)

Per 0090 v0.6's pinned form `H(tag || len(canonicalRowId) || canonicalRowId
|| rowHash)`:

```
leaf = SHA-256("snapback-rqs-leaf-v1\0"
               || u64_be(len(idBytes)) || idBytes || rowHash)   // 32 bytes
```

The length frame makes the encoding injective by construction rather than
by the fixed-length-suffix parse of bare concatenation, and the domain tag
separates leaves from row hashes and every other SHA-256 use in the system.
The leaf commits to the **keyed pair** (id → row hash), which is what lets
the rung-2 witness aggregate be jointly verifiable against the MAC-bound
root without admitting hash permutation among ids (0090 D1.3).

### 0A.4 `contentDigest` — constructions pinned by name and parameters

`contentDigest` is split by query shape (0090 D1); both kinds publish a
**fixed-size compressed root**, never accumulator state.

**`mset1` — incremental multiset digest** (DK-3-analyzable unordered
results). Construction: **LtHash-16** in the Bellare–Micciancio additive
hashing class, with these exact parameters:

- State: **1024 lanes × 16-bit unsigned, little-endian** (2048 bytes).
  The empty result is the all-zero state.
- Leaf expansion (fixed-output MGF1-style counter expansion over SHA-256 —
  chosen over a true XOF for dependency neutrality, see Decision log
  item 6):

  ```
  block_i  = SHA-256("snapback-rqs-xof-v1\0" || leaf || u32_be(i))   // i = 0..63
  expanded = block_0 || block_1 || ... || block_63                    // 2048 bytes
  ```

  interpreted as 1024 little-endian u16 lanes.
- Insert = lane-wise addition mod 2^16 of the expanded leaf; remove =
  lane-wise subtraction mod 2^16. Applying a delta is
  `remove(oldLeaf); add(newLeaf)` per changed row — O(changed rows).
- Published form:

  ```
  contentDigest = "mset1:" + hex(SHA-256("snapback-rqs-state-v1\0" || state))
  ```

  The full 2048-byte state is held privately server-side per live result
  (incremental maintenance) and recomputed client-side from persisted rows
  at verification time; tokens, `meta`, and envelopes carry only the
  ~70-byte published string. Rung-2 witness verification recomputes state
  from the witnessed `(rowId, oldRowHash)` leaves and compares compressed
  roots; the accumulator-update rule of 0090 D1.3 (touch only
  journal-affected ids; untouched witness leaves stay) operates on the
  recomputed state.
- Security margin: these are the parameters of Facebook's published
  LtHash-16; the construction class carries Bellare–Micciancio's
  SIS-style reduction, and the best published lattice/k-sum attacks against
  1024×16 exceed 2^128 work. XOR and narrow-sum combiners are explicitly
  forbidden (0090 D1). The v1 threat model remains 0090's narrowed one —
  corruption detection client-side, ratification prevention server-side —
  but the construction is chosen so the `authPartition` v2 door inherits an
  adversarially collision-resistant primitive.

**`seq1` — sequence-sensitive digest** (ordered / limited / replace-only
results):

```
contentDigest = "seq1:" + hex(SHA-256("snapback-rqs-seq-v1\0"
                                      || jcs(rowsArrayInDeliveredOrder)))
```

Computed only at `LiveReplace` boundaries and carried from mint through
rung-1 global proofs (0090's deliberate v1 simplification). A permuted
persisted result fails this check by construction.

**Kind selection.** The authoritative selector is the served manifest's
delta class for the `queryArtifact` (DK-3-analyzable unordered → `mset1`;
everything else resumable → `seq1`). The `digestKind` body field and the
digest's string prefix must both match it at admission.

> **Dated boundary note (2026-08-03, `single_table_v1@1` owner
> acceptance):** the host copies this exact shipped selector into the
> owner-normalized node identity as `rqsDigestKind`: empty `order` plus
> `limit: null` selects `mset1`; any non-empty order or explicit limit,
> including `0` or `1024`, selects `seq1`. The host recomputes and
> exact-compares that field. This adds no digest construction, token
> interpretation, credential prefix, or wire byte, and semantic acceptance
> grants no implementation or capability claim.

### 0A.5 Token refresh, persistence cadence, store budget and eviction

**Refresh rule** (restating 0090 D1 as contract): every result-changing
durable envelope for an `rqsEligible` subscription carries a fresh token
minted at the new `(version, contentDigest)` — initial `LiveReplace`, every
`LiveDelta`, replay completion, and `CurrentAsOf`. One mint is shared per
`(queryArtifact, argsHash, version, contentDigest)` across the entire
fan-out. Minting is suppressed entirely for non-`rqsEligible`
subscriptions.

**Persistence cadence** (web; the Web-Lock store holder is the single
writer, LLP 0008/0053 discipline):

- Atomic commit of `{rows, meta, token}` in **one IndexedDB transaction**.
- Trailing debounce of **1 s** after the last result-changing envelope,
  with a hard cap of **10 s** of continuous change before a forced write;
  plus an immediate flush on `pagehide` and on visibility transition to
  hidden.
- Before applying a delta sequence, the holder marks the persisted entry
  in-progress; an entry found in-progress at relaunch is invalid and falls
  back to fresh subscribe (0090 D1's interrupted-application rule).
- A failed persistence write never blocks rendering or the live
  subscription; the entry is invalidated (best-effort delete) so relaunch
  takes fresh subscribe (§0B.3 row P).

Native arms ride the DK-9 store-agnostic interface (LLP 0008) with the same
atomicity and in-progress rules; the native cadence/budget numbers are
pinned by the step-5 native amendment below (same values as web, host-
lifecycle flush trigger; formerly Open question OQ2).

**Store budget and eviction** (0090 D3): per-app RQS store budget of
**32 MiB or 256 entries, whichever binds first**, accounted as serialized
`{rows, meta, token}` bytes. Eviction is **least-recently-resumed** first,
where an entry's recency is the timestamp of its last successful
authoritative resume (0090 v0.6's definition), updated atomically with the
entry in the same transaction. A per-manifest-entry `persist: false`
opt-out is honored at write time. The RQS store holds only `rqsEligible`
snapshots; the LLP 0043/0053 lease store is a separate, untouched artifact.

### 0A.6 `generation` digest

```
generation = "gen1:" + hex(SHA-256("snapback-generation-v1\0" || components))
components = put_string(deploymentIdentity)
             put_string(schemaIdentity)
             put_string(functionsIdentity)
             put_string(capabilityIdentity)
             put_string(resumeConfigIdentity)
```

(`put_string` framing as in §0A.1; each component is itself a
`sha256:`-prefixed identity string or the literal noted below.)

- **Cloudflare arm:** components come from the generated deployment
  identity artifact (`targets/cloudflare/scripts/generate-deployment-identity.mjs`,
  format 2): `deploymentIdentity` = its `inputsHash`, `schemaIdentity` =
  its `schemaHash`; `functionsIdentity` and `capabilityIdentity` are the
  served instance's functions/capability manifest hashes. (The Round-6
  draft cited `crates/snapback/src/deploy.rs` `ReleaseCompatibility`, which exists only on
  the unlanded LLP 0074 tranche branch; this artifact is what main
  actually has. If the deploy-receipt work lands, its compatibility hashes
  slot into the same component positions without changing this contract.)
- **Local arm (content-derived minting, 0090 v0.6):** the served instance
  recomputes the digest at every schema/functions ensure from the served
  manifest hashes — `schemaIdentity`/`functionsIdentity`/
  `capabilityIdentity` are the ensured manifests' hashes, and
  `deploymentIdentity` is `"local:" + <snapback crate version>`. A no-op
  ensure reproduces identical components and therefore an identical
  `generation`; the "changes exactly when a bound component changes" rule
  is authoritative. (A locally rebuilt binary at the same crate version
  does not rotate `generation`; resume-relevant semantic changes are
  covered by the manifest and config components plus the digest-contract
  version below.)
- **`resumeConfigIdentity`** = `"sha256:" + hex(SHA-256("snapback-rqs-config-v1\0"
  || jcs(resumeConfig)))` where `resumeConfig` is exactly the four
  enumerated components of 0090 v0.6:

  ```
  resumeConfig = { journalPrunePolicy, authMode,
                   routeManifestHash, digestContractVersion }
  ```

  with `digestContractVersion = "rqs-0A-v1"` for this spec. Bumping any 0A
  construction bumps this string, rotating `generation` fleet-wide — the
  intended effect.

The same `generation` string appears in tokens, `meta`, bundle responses,
and Channel A embedded attestation facts, and is compared by exact string
equality at admission (`SNAPBACK_RESUME_GENERATION_STALE` on mismatch).

### 0A.7 `versionStream` crosswalk

`versionStream` is **the existing data version stream** — the UUIDv7 stored
in `_snapback_meta` by `ensure_data_version_stream_in` and rotated inside
the reset transaction by `rotate_data_version_stream_in`
(`crates/snapback/src/storage/auth_invalidation.rs`); it is the same identity the
`AuthorizedLease` carries as `data.versionStream` (`crates/snapback/src/auth/lease.rs`) and
LLP 0043 names `versionStreamId`. This spec introduces **no new stream
identity**. Normative crosswalk:

| Identity | Owner / definition | Rotates on | Carried in |
|---|---|---|---|
| `versionStream` | LLP 0043/0053; `_snapback_meta` UUIDv7 | reset, import, declared restore | `tokenBody`, `meta`, bundle responses, `AuthorizedLease.data` |
| `version` (commit version) | storage commit counter (`PORTABLE_STORAGE_VERSION_MAX` cap) | every commit | envelopes, tokens, receipts — comparable only within one `versionStream` |
| `generation` | this spec §0A.6 | any bound deployment component change | `tokenBody`, `meta`, bundles, embedded attestation |
| `AuthorizationVersion { incarnation, epoch }` | LLP 0039 | authorization-stream events (writeless included) | leases, auth invalidation frames — **not** in v1 tokens; reachable only through the reserved `authPartition` v2 door |

Admission compares `versionStream` by exact string equality
(`SNAPBACK_RESUME_STREAM_MISMATCH` on mismatch); a commit version from
another stream is never meaningful, which is the whole reason the field
exists (0090 D1's post-reset version-10 example).

## 0B — Wire schemas

All shapes land as serde+schemars types in `crates/snapback/src/live_wire.rs` (or the
local-input module for request shapes) and flow through the LLP 0051 drift
gates: schema export names below are additions to
`crates/snapback/src/schema_export.rs` / `crates/snapback/tests/artifact_schemas_v0.rs`, with the JS kit
pinned via `demos/_kit/tests/live-wire-schema.mjs`.

### 0B.1 The `resume` object and `meta`

One shared wire shape, exported as `live.resume-token.schema.json` (named
distinctly from the existing reattach schemas `live.resume.input/output` —
see §0B.4):

```
resume = { token: string,          // tokenWire, §0A.1, ≤ 1 KiB
           meta: { app, version, contentDigest, generation,
                   versionStream, queryArtifact, argsHash } }
```

`meta` is clear, client-advisory, and never an admission input. It carries
**every** identity field the Channel A/B arbitration of 0090 D3 compares —
including `app`, which 0090 v0.6's prose rule requires but its `meta`
grammar line omitted; this spec resolves that residue in favor of the prose
(Decision log, gap G2). The client's `digestKind` signal is
`meta.contentDigest`'s self-describing prefix; no separate `meta` field is
needed. `meta.version` carries the `PORTABLE_STORAGE_VERSION_MAX` schemars
range cap.

### 0B.2 `CurrentAsOf` envelope

A new `LiveEnvelope` variant on the durable lane (serde tag
`current_as_of`, snake_case fields per durable-lane convention):

```
CurrentAsOf {
  subscription_id: String,
  function: String,
  version: u64,          // current head N; PORTABLE_STORAGE_VERSION_MAX cap
  resume: resume,        // fresh token minted at N — the fresh-token field
}
```

Semantics (0090 D1.3 rung 1): "your held rows are current as of N" — the
client adopts the fresh token and advances its version **without touching
rows**. `resume` is mandatory on this variant (the variant exists to
advance the token). No capability negotiation: the server sends it only to
a subscriber that presented `resumeFromToken` or subscribed
refresh-capable, so decode ability is implied by the request.

**Refreshed-token fields on existing envelopes:** `LiveReplace` and
`LiveDelta` gain an **optional** `resume` field
(`skip_serializing_if = None`), populated for `rqsEligible` subscriptions
per §0A.5. `LiveEnvelope` variants carry no `deny_unknown_fields`, so old
decoders ignore the addition — the old-decoder tolerance case of 0090's 0B
cluster. (`CurrentAsOf` as a whole new variant is *not* old-decoder
tolerable, which is exactly why it is gated on the subscriber having asked
for resume.)

### 0B.3 Client transition table

State per subscription: held rows at version `V`, freshness ∈
{retained/pending, current}, persisted entry `E` (rows, meta, token),
optimistic overlay `O` (post-connect pending mutations rendered above the
authoritative base; a client with a non-empty *relaunch* outbox never sent
`resumeFromToken` at all — 0090 D3's LLP 0043 outbox rule).

| # | Event | Client transition |
|---|---|---|
| T1 | Boot with persisted/preloaded entry: recomputed digest of rows equals `meta.contentDigest` | Render rows as **retained/pending**; subscribe with `resumeFromToken` |
| T2 | Boot: digest mismatch, decode failure, truncation, or entry marked in-progress | Discard `E`; subscribe fresh (no token). This is corruption detection, not tamper-proofing (0090 D1 threat model) |
| T3 | `CurrentAsOf(N, resume')` with `N > V` | Keep rows; set version `N`; adopt `resume'`; mark **current**; persist per §0A.5 cadence |
| T4 | `CurrentAsOf(N, resume')` with `N == V` | Same as T3 (idempotent); duplicate delivery of the same frame is a no-op |
| T5 | `CurrentAsOf(N, …)` with `N < V` | Ignore the frame entirely (never regress version, rows, or token); keep existing state |
| T6 | `LiveReplace(N, rows', resume'?)` (any `N` relation) | Replace base rows; adopt `resume'` when present; mark **current**; re-apply `O` on top; persist |
| T7 | `LiveDelta(N, ops, resume'?)` with contiguous version | Apply ops to base; adopt `resume'`; verify post-apply digest against `resume'.meta.contentDigest` when present — mismatch ⇒ discard `E`, request fresh subscribe (client-side rung 3); re-apply `O`; persist |
| T8 | Replay completion after token resume | Client independently verifies the post-replay digest **before** treating the result as authoritative (0090 D1.3 rung 2); failure ⇒ as T7 mismatch |
| T9 | Persistence write fails (quota, storage error) | In-memory state unaffected; invalidate `E` best-effort; never surface to the subscription; next relaunch takes T2's fresh path |
| T10 | Optimistic overlay present at any of T3–T8 | Transitions touch only the authoritative base; `O` re-applies above the new base unchanged (the base version advance never silently drops an optimistic layer) |
| T11 | `ResyncRequired` / `AuthorizationInvalidation` | Existing state machine, unchanged — plus purge of the persisted copy per 0090 D3; resume added an entry point, not a new failure mode |
| T12 | Old decoder receives `LiveReplace`/`LiveDelta` with `resume` | Field ignored; behavior identical to today (never sent `CurrentAsOf`, so no undecodable variant arrives) |

### 0B.4 Token-resume wire naming, and dispatch against the reattach route

**Naming.** The existing `POST /live/{name}/resume` is the **reattach**
operation — subscription-id continuation of a server-retained subscription,
schemas `live.resume.input/output.schema.json`, already exported and
drift-gated (`crates/snapback/src/schema_export.rs`, `LiveResumeInput` in
`crates/snapback/src/local/live_protocol.rs`).
Per 0090 D1, nothing is renamed. Token resume is **not a new route**: it is
the optional `resumeFromToken` field on the existing subscribe input
(`live.subscribe.input.schema.json` / `LiveSubscribeInput`), named in
camelCase with a snake_case alias per that struct's `authorizationNamespace`
precedent:

```
LiveSubscribeInput += resumeFromToken?: { resume: resume }
```

The wrapper object carries the rung-2 `membershipWitness` field, whose
shape is pinned by the dated rung-2 amendment below (W1). The new
exported schema names are `live.resume-token.schema.json` (§0B.1) plus the
revised subscribe/envelope schemas — the token-resume vocabulary never uses
the bare word "resume" in a schema filename, keeping the two operations
lexically distinct in the schema inventory.

**Client dispatch rule** (0090 D1's "Relationship to the existing reattach
route", made procedural):

1. Holding a live *retained* subscription id within the server's retention
   window (socket blip): **reattach** via `POST /live/{name}/resume`.
2. Otherwise, holding verified `rqsEligible` persisted/preloaded state with
   a token, and the relaunch outbox is empty: **subscribe with
   `resumeFromToken`**.
3. Otherwise: **fresh subscribe** (today's path, unchanged).

A refused reattach falls through to step 2; a refused token (any
`SNAPBACK_RESUME_*` cause) is answered by the server with rung 3 — a fresh
`LiveReplace` on the same subscribe — so the client never retries the token
on its own. The client reconnect path still always re-enters through a
fresh `subscribe_live` (`packages/snapback-client/index.mjs`); the token
only seeds it — the LLP 0034 §2.4 amendment in 0090's 0F cluster records
this as "maybe-`CurrentAsOf`-with-subscribe".

### 0B.5 Cloudflare forwarding decision

- **Token resume: forwarded from day one, by construction.** It rides the
  subscribe operation, and the gateway's `KIT_ROUTE` already forwards
  `/live/{name}/subscribe` to the coordinator DO
  (`targets/cloudflare/src/gateway.js`); admission runs in the coordinator, which
  holds the resume keyring (§0A.1). The only gateway-adjacent obligation is
  that body-size limits admit the ≤1 KiB token (and, later, the rung-2
  witness cap — a 5a concern).
- **Reattach: stays local-arm-only in v1.** `KIT_ROUTE` continues to
  forward only `subscribe|unsubscribe` on the live POST path; the reattach
  route is not added. Cloudflare clients skip dispatch step 1 (they never
  hold a reattachable retained subscription across the gateway today) and
  go straight to token resume or fresh subscribe. Extending reattach to the
  Cloudflare arm is future work under LLP 0051's rules, not blocked and not
  required by any v1 channel. Acceptance (rollout step 1/4): a Cloudflare
  subscribe carrying `resumeFromToken` reaches coordinator admission; a
  reattach POST against the gateway keeps failing exactly as today.

### 0B.6 `SNAPBACK_RESUME_*` refusal-code registry

Stable, append-only registry (LLP 0010 style), paralleling
`SNAPBACK_BUNDLE_*` (cluster 0D). Every refusal answers with rung 3 (fresh
`LiveReplace`) — a coded refusal is an observability fact, never a
subscription failure. Per-cause codes, one per cause named in 0090 D1.1:

| Code | Cause |
|---|---|
| `SNAPBACK_RESUME_TOKEN_MALFORMED` | framing/base64/JSON/schema decode failure, unknown body field, implausible timestamps |
| `SNAPBACK_RESUME_TOKEN_OVERSIZE` | tokenWire exceeds 1 KiB |
| `SNAPBACK_RESUME_MAC_INVALID` | MAC verification failure under the named key |
| `SNAPBACK_RESUME_KEY_UNKNOWN` | `keyId` not present in the resume keyring |
| `SNAPBACK_RESUME_KEY_RETIRED` | `keyId` retired beyond the §0A.1 overlap window |
| `SNAPBACK_RESUME_TOKEN_EXPIRED` | `issuedAt` older than `maxTokenAgeMs` (staleness backstop) |
| `SNAPBACK_RESUME_APP_MISMATCH` | token `app` ≠ served instance app |
| `SNAPBACK_RESUME_GENERATION_STALE` | token `generation` ≠ served instance generation |
| `SNAPBACK_RESUME_STREAM_MISMATCH` | token `versionStream` ≠ current data version stream |
| `SNAPBACK_RESUME_QUERY_MISMATCH` | `queryArtifact`/`argsHash` ≠ the subscription being opened |
| `SNAPBACK_RESUME_NOT_ELIGIBLE` | named query is not `rqsEligible` in the served manifest (undeclared, non-closed-inputs, or auth-scoped) |
| `SNAPBACK_RESUME_DIGEST_KIND_MISMATCH` | `digestKind`, digest prefix, and the manifest delta class disagree |
| `SNAPBACK_RESUME_VERSION_IMPLAUSIBLE` | token `version` ahead of the served head |
| `SNAPBACK_RESUME_JOURNAL_FLOOR` | rung-1 table-set / rung-2 coverage refused by `journal_resume_requires_resnapshot` |
| `SNAPBACK_RESUME_WITNESS_INVALID` | rung-2 witness decode ambiguity: count mismatch, non-canonical hash, out-of-order or duplicate ids (live since the rung-2 amendment) |
| `SNAPBACK_RESUME_WITNESS_OVERSIZE` | rung-2 witness exceeds the entry or byte cap (live since the rung-2 amendment) |
| `SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH` | rung-2 witness aggregate ≠ the token's MAC-bound `contentDigest` root (rung-2 amendment) |
| `SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED` | rung-2 post-replay accumulator ≠ the fresh head digest (rung-2 amendment) |
| `SNAPBACK_RESUME_BUDGET_EXCEEDED` | replay CPU/time or journal-distance budget exhausted |
| `SNAPBACK_RESUME_RATE_LIMITED` | per-authority resume rate exceeded |
| `SNAPBACK_RESUME_POLICY_REPLACED` | server chose rung 3 under the replay-versus-replace policy knob |

Observability counters key on these codes (0090 §Scalability's
"refusals by coded reason").

## Decision log disposition

The Round-6 implementer-lens draft logged 16 decisions. Disposition here;
"ratified" means this spec pins exactly the draft's pick (with parameters),
"overturned" states the replacement and why.

1. **Token self-containment — ratified** (self-describing envelope; `meta`
   never an admission input). 0090 v0.6 adopted this into the RFC.
2. **Framing + transcript — ratified** (dotted `sbrt1.` framing;
   lease-precedent length-framed transcript; `keyId` outside body, inside
   transcript). Domain string spelled `snapback.resume-token.v1` to match
   the repo's MAC-domain convention rather than the draft's hyphenated
   spelling.
3. **HMAC-SHA256 — ratified** (repo precedent; `hmac`/`sha2` already in
   `Cargo.toml`).
4. **Expiry anchor — ratified in substance, renamed**: the field is
   `issuedAt` (0090 v0.6's pinned name), not the draft's `issuedAtMs`; the
   millisecond unit is pinned in §0A.1 prose instead.
5. **RFC 8785 JCS + mint-time refusal — ratified**, with the refusal list
   extended (well-formed Unicode; duplicate row ids at mint, not only in
   witnesses).
6. **Multiset construction — ratified as LtHash-16 1024×16 LE; leaf
   expansion overturned**: BLAKE3-XOF is replaced by an MGF1-style
   SHA-256 counter expansion (§0A.4). Reason: no BLAKE3 dependency exists
   in either language arm today (Rust has `sha2` only; the JS arms have no
   vendored BLAKE3, and WebCrypto/`node:crypto` provide SHA-256
   everywhere including the constrained socket-less surfaces of Channel C);
   the expansion target is fixed-length, so a true XOF buys nothing but a
   dependency. SHA-256-CTR is the standard fixed-output instantiation for
   this use.
7. **Compressed-root published form — ratified**, with a domain tag added
   over the raw state before compression (`snapback-rqs-state-v1`).
8. **Widened `meta` — ratified and extended**: the draft added
   `queryArtifact` + `argsHash`; this spec also adds `app`, because 0090
   D3's arbitration compares `app` and v0.6's prose ("repeats every
   identity field D3's arbitration compares") requires it while its grammar
   line omitted it.
9. **`argsHash`/`queryArtifact` representation — ratified** (`sha256:`-hex;
   per-function artifact hash from the served functions manifest), with a
   domain tag added to the args hash.
10. **Local-arm content-derived `generation` — ratified.** 0090 v0.6
    adopted it.
11. **Resume-relevant config enumeration — ratified** (the four components,
    now also carried in 0090 v0.6's text).
12. **Keyring overlap — ratified with parameters** (active + 2 retired,
    14-day window, retired-code past window; 30-day mint-key rotation
    mirroring `AUTH_KEY_ROTATION_AGE_MS`).
13. **Custody — ratified** (coordinator DO storage; local `secure_file`
    ring), sharpened to a **separate ring** from the auth keyring.
14. **Sequence digest — ratified** (SHA-256 over domain tag + JCS rows
    array).
15. **Length-framed, domain-tagged leaf — ratified.** 0090 v0.6 adopted it.
16. **Knobs — ratified** (1 s/10 s debounce, 32 MiB/256 entries, 1 KiB
    token cap, `SNAPBACK_RESUME_*` namespace, tagged-absent
    `authPartition`), with the refusal namespace expanded into the full
    per-cause registry of §0B.6.

**Citation correction:** the draft's §0A.5 sourced Cloudflare `generation`
components from `crates/snapback/src/deploy.rs` (`ReleaseCompatibility`). That file exists
only on the unlanded `agent/llp-0074-competitive-tranche` branch; on main
the deployment identity artifact is
`targets/cloudflare/scripts/generate-deployment-identity.mjs` (§0A.6 uses it).

**Spec-gap closure:** of the Round-6 review's 10 spec gaps, G1 (issuedAt),
G3 (self-describing token), G4 (compressed root), G5 (JCS + framed leaf),
G7 (local-arm generation), G8 (keyring overlap), G9 (config enumeration),
and G10 (`SNAPBACK_RESUME_*` namespace) were absorbed into 0090 v0.6 and
are pinned with parameters here; G2 (`meta` width) is closed by §0B.1
including `app`; G6 (constructions by name and parameters) is closed by
§0A.4.

## Dated amendment: step-1 implementation reconciliation (2026-07-24)

LLP 0090 rollout step 1 (ENG-25452, commit 390a6f22) implemented this
contract in `crates/snapback/src/rqs.rs` / `packages/snapback-client/rqs.mjs` and reported
three divergences. Per LLP 0004 the docs track the code; the implemented
behavior is normative and the sections above read as amended here:

1. **Key-id prefix is `sbrq_`, not `sbrk_`** (§0A.1). The drafted `sbrk_`
   prefix collides with the secret-read root key class already registered in
   the `crates/snapback/src/auth/crypto.rs` credential-prefix registry; the collision-free
   spelling `sbrq_` landed instead (`ResumeKeyId`, `RESUME_KEY_PREFIX`).
   `keyId = "sbrq_" <22-char base64url>`; everything else in §0A.1 is
   unchanged.
2. **The integer refusal is a symmetric band rule** (§0A.2). "An integer
   with magnitude above 2^53 − 1" is implemented as: an **integral double
   whose magnitude lies in the open band (2^53 − 1, 1e21) is refused at mint
   on both arms** — in that band the JCS serialization is full decimal
   digits, indistinguishable on the JS arm from a lossy big integer, so the
   Rust arm refuses symmetrically rather than emitting bytes the JS arm
   must refuse. At and above 1e21 the ECMAScript exponent form is canonical
   and unambiguously a double, so those values are allowed. True
   >2^53 − 1 integers (i64/u64-typed) remain refused as written.
3. **`queryArtifact` is interim content-derived** (§0A.1). The served
   functions manifest carries no per-function generated-artifact hash yet —
   that field is cluster-0C work — so step 1 derives the identity from the
   served `FunctionDefinition` itself:
   `"sha256:" + hex(SHA-256("snapback-rqs-query-artifact-v1\0" ||
   jcs(functionDefinition)))` (`query_artifact_hash`, `crates/snapback/src/rqs.rs`). The
   identity is stable within a generation and rotates whenever the function
   artifact changes — the property admission needs. When 0C lands the
   manifest-carried per-function artifact hash, it replaces this derivation
   (a `generation` rotation, so no mixed-identity tokens survive the swap).

## Dated amendment: rung-2 membership witness (2026-07-24, ENG-25457)

LLP 0090 rollout steps 5a+6 decided Q7 here — the witness wire format,
size-cap defaults, reconciliation rule, and replay algorithm — and the
local arm implemented them (`crates/snapback/src/rqs.rs` witness decode/aggregate,
`crates/snapback/src/local.rs` `rqs_attempt_delta_replay`, the `subscribe_live` rung-2 arm;
`packages/snapback-client/rqs.mjs` `membershipWitnessOfRows`). This
amendment closes OQ1. The sections above read as amended:

**W1 — wire format** (§0B.4's reserved field, now schematized through the
LLP 0051 drift gates as part of `live.subscribe.input.schema.json`):

```
resumeFromToken = { resume, membershipWitness? }
membershipWitness = { count: u32,
                      entries: [ { id, oldRowHash } ] }
```

- One entry per row the client holds at the token's version: `id` is the
  wire row id (`LiveDeltaWireOp.id`, §0A.2's `canonicalRowId`) and
  `oldRowHash` is base64url (no pad) of the 32-byte §0A.2 row hash — raw
  `(rowId, oldRowHash)` pairs, no recoverable/compressed encoding (the raw
  form is the only one whose decode has no ambiguity to reconcile).
- Entries are **deterministically ordered**: ascending UTF-16 code-unit
  order of `id` (the §0A.2 JCS member order; `cmp_utf16` in both arms).
  Ordering makes duplicates a structural decode failure rather than a
  last-wins hazard.
- `count` is explicit and must equal `entries.length`, so truncation in
  any intermediary is a detectable decode failure.
- The witness accompanies `resumeFromToken` only when the token's
  `digestKind` is `mset1` and the held result is within the client-side
  entry cap; `seq1` results are never witnessed. A witness-less resume is
  never refused for its absence — rungs 1 and 3 remain available.

**W2 — size caps** (the §0D.6 "reserved" row of LLP 0092, now pinned;
server policy knobs, LLP 0092's resource-limit style): at most **4096
entries** and at most **1 MiB** of serialized witness bytes; above either,
`SNAPBACK_RESUME_WITNESS_OVERSIZE` → rung 3. The client does not send a
witness above the entry cap (it would only be refused).

**W3 — reconciliation rule** (0090 D1.3's "formats that admit uncertainty
must reconcile such that decode failure or ambiguity falls back to rung 3
and can never suppress a required removal"): every anomaly is fail-closed
and per-cause coded, and every refusal answers rung 3 — a full fresh
`LiveReplace`, which cannot suppress a removal by construction:

| Anomaly | Code |
|---|---|
| `count` ≠ `entries.length`; hash not exactly 32 base64url bytes; entries out of ascending UTF-16 id order (includes any duplicate id) | `SNAPBACK_RESUME_WITNESS_INVALID` |
| over the entry or byte cap | `SNAPBACK_RESUME_WITNESS_OVERSIZE` |
| witness aggregate root ≠ the token's MAC-bound `contentDigest` (omitted/extra/substituted entries, correct-id-wrong-hash, hash permutation — defeated by the §0A.3 keyed leaf) | `SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH` |
| post-replay accumulator root ≠ the fresh head digest (journal incompleteness, impurity, any wrong-but-root-matching witness) | `SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED` |

The two new codes extend the §0B.6 registry (append-only), and the two
formerly reserved codes are live as of this amendment.

**W4 — replay algorithm and policy knob** (0090 D1.3 rungs, implemented):
after D1.1 admission, with the token's `version` at or above the journal
floor and the query `mset1`:

1. Enforce W2's caps; decode per W3.
2. Aggregate the witness leaves (§0A.3/§0A.4) and require the compressed
   root to equal the token's MAC-bound `contentDigest` **before** any
   replay — token and witness are jointly verifiable.
3. Collect the **distinct journal-affected row ids** for the query's table
   strictly after the token's `version`
   (`changed_row_ids_for_table_since`). **Replay-vs-replace knob:** replay
   proceeds only while `affectedIds ≤ max(1, witnessCount × percent/100)`
   with default `percent = 100` — once more rows were touched than the
   client ever held, the delta cannot be smaller than the replacement, so
   the server answers rung 3 under `SNAPBACK_RESUME_POLICY_REPLACED`.
4. For each affected id, diff the witnessed old membership against the
   current post-image result (exits are derivable exactly because the
   witness names old hashes): witnessed-only → `remove`; present-only →
   `add`; both with differing hashes → `update`; both equal or neither →
   no op (touched-but-reverted rows stay silent). Accumulator update
   touches **only these ids** — subtract witnessed leaves, add post-image
   leaves — so untouched witness leaves remain (0090 v0.6's rule).
5. Require the updated accumulator root to equal the fresh head digest
   (W3's diverged code otherwise), then answer: a single `live_delta` at
   the head version carrying the ops and the mandatory fresh token minted
   at `(head, freshDigest)`, enqueued under the same atomic
   answer-and-register cut as rungs 1/3; the subscribe output carries no
   rows. An empty op set upgrades the answer to rung 1 (`current_as_of`).
   The client applies §0B.3 T7/T8: post-replay digest verification before
   the state is authoritative, and verification failure discards the
   entry client-side (rung 3 by fresh subscribe).

Observability (0090 §Scalability): `deltaReplayAnswers`, `replayOps`, and
`replayBytesAvoided` (serialized replacement rows minus serialized ops,
saturating — envelope overhead and the fresh token are identical between a
rung-2 and rung-3 answer) join the step-1 counters, with refusals keyed by
the W3 codes.

## Dated amendment: step-5/step-3 reconciliation (2026-07-24)

Rollout step 5's web arm (ENG-25456, commit b2570c91) and rollout step 3
(ENG-25454) pinned three further points; per LLP 0004 the implemented
behavior is normative:

1. **§0A.5 eviction ordering.** "Least-recently-resumed first" is ascending
   `resumedAt` with **never-resumed entries first** (their recency is 0),
   and `savedAt` as the tiebreak. Recency is bumped *only* by a successful
   authoritative resume — a mere persist write never refreshes it
   (`evictionOrder`, `packages/snapback-client/rqs-store.mjs`).
2. **`versionStream` is an identity axis in the D3 arbitration, never a
   comparable.** The Channel A-vs-B arbitration compares `app`,
   `generation`, `versionStream`, `queryArtifact`, and `argsHash` by exact
   string equality; "higher `version` wins" applies only inside full
   identity equality, and ANY mismatch — including `versionStream` —
   discards both candidates for a fresh subscribe
   (`arbitrateResumeCandidates`). A cross-stream version comparison is
   never performed anywhere client-side; server admission separately
   refuses `SNAPBACK_RESUME_STREAM_MISMATCH`.
3. **The interim content-derived `queryArtifact` stands after cluster 0C.**
   Step 3 landed 0C (routes manifest, `publicInline`, derived
   `rqsEligible`) without adding a manifest-carried per-function
   generated-artifact hash, so item 3 of the step-1 amendment above remains
   the standing rule; the swap is now expected with the step-4 Cloudflare
   arm (see LLP 0092's dated amendment).

## Dated amendment: step-4 Cloudflare-arm reconciliation (2026-07-24, ENG-25455)

LLP 0090 rollout step 4 landed RQS on the Cloudflare arm
(`targets/cloudflare/src/rqs-host.mjs` + coordinator/gateway integration), sharing —
never forking — the `packages/snapback-client/rqs.mjs` algebra by relative
import, the same mechanism the coordinator already uses for
`packages/snapback-harness/envelope.mjs` (esbuild and Wrangler both bundle
it into the deployed Worker). Per LLP 0004 the implemented behavior is
normative; the sections above read as amended:

1. **§0A.1 custody, implemented shape.** The Cloudflare resume keyring is
   the `_snapback_rqs_keys` table in coordinator DO SQLite — storage-resident
   with **no in-memory copy**, so hibernation, eviction, and DO restart
   preserve it by construction. Rotation/overlap parameters are §0A.1's.
   Like `_snapback_config_cursors`, the table deliberately **survives
   destructive `/reset`** (it is deployment security state, not app data);
   reset invalidates outstanding tokens through the `versionStream` rotation
   below. Key loss remains availability-only.
2. **§0A.6 Cloudflare components, pinned values.** `functionsIdentity` and
   `capabilityIdentity` are the canonical (`sha256:` over JCS) identities of
   the served `functions` array and capability manifest; `journalPrunePolicy`
   is `"retain-versions:1000"` (the coordinator's journal retention) and
   `authMode` is `"cloudflare-connection-grant-v1"`; `routeManifestHash` is
   the canonical identity of the compiled routes manifest, or `"none"`.
3. **§0A.7 `versionStream` on the Cloudflare arm.** The coordinator mints a
   UUID into `_snapback_meta` (`rqs_version_stream`) on first use and
   destructive `/reset` rotates it (reset drops `_snapback_meta`; the next
   read mints a fresh stream, refusing every outstanding token with
   `SNAPBACK_RESUME_STREAM_MISMATCH`). This is the crosswalk row's owner on
   this arm — the local `_snapback_meta` UUIDv7 machinery does not exist
   here, and no new comparable identity was introduced.
4. **The interim content-derived `queryArtifact` stands after step 4.** The
   step-5/step-3 amendment expected the manifest-carried per-function
   artifact-hash swap with this step; step 4 kept the content derivation
   (both arms, one rule — the compiled Cloudflare function entries carry no
   per-function generated-artifact hash either, and the content derivation
   already has the admission property). The swap remains future 0C work and
   is still a `generation` rotation when it lands.
5. **This arm's ladder is rungs 1 & 3 only.** The Cloudflare live wire is
   replace-only (fan-out re-queries and pushes `live_replace`; no
   `live_delta` lane exists), so rung-2 witness replay and the rung-1
   table-set proof are deferred — the witness/`JOURNAL_FLOOR` refusal codes
   never fire on this arm, and a behind-head token always answers rung 3.
   `resumeFromToken` is accepted on both subscribe entry points (the kit
   HTTP subscribe and the live-socket subscribe frame); a rung-1 answer is
   the `current_as_of` frame on the socket, with the kit HTTP subscribe
   output carrying `snapshot: null` plus `current_as_of: {version, resume}`.
   §0B.5's acceptance obligation is discharged in
   `targets/cloudflare/test/acceptance.rqs.mjs`: a subscribe carrying
   `resumeFromToken` reaches coordinator admission through the gateway's
   existing forwarding, and a reattach POST keeps failing exactly as today.

## Dated amendment: step-5 native persistence knobs (2026-07-25, ENG-25456)

Rollout step 5's native arm (the DK-9 file-backed store,
`packages/snapback-client/rqs-store-file.mjs`) pins the native
cadence/budget values §0A.5 left to OQ2; per LLP 0004 the implemented
behavior is normative:

1. **Cadence: the web numbers, unchanged.** Trailing debounce of **1 s**
   after the last result-changing envelope with the **10 s**
   continuous-change cap, plus flush on client `pause()`/`dispose()`. The
   envelope rate that drives persistence is transport-bound, not
   platform-bound, and the client cadence machinery is store-agnostic — a
   divergent native number would buy nothing and split the fixture.
2. **Flush trigger: mapped to the host lifecycle seam.** Web's
   `pagehide`/visibility-hidden flush has no native event; the native
   analogue is the embedding shell calling `handle.flushResumeState()` on
   its app-backgrounded / scene-resigns-active transition (the handle
   method exists for exactly this; the web listeners are registered only
   where `addEventListener` exists). An embedding that never wires the
   lifecycle call still persists on the debounce cadence and flushes on
   pause/dispose — the lifecycle flush narrows the loss window, it does not
   carry correctness.
3. **Budget: the web numbers, unchanged.** **32 MiB or 256 entries,
   whichever binds first**, accounted as serialized `{rows, meta, token}`
   bytes via the shared `rqsEntryRecordBytes`, with the same
   least-recently-resumed eviction (`rqsEvictionOrder`) — device app
   containers are not tighter than browser origin storage here, and one
   number keeps the budget fixture cross-arm.
4. **Constrained processes never persist.** Widget/extension-class
   processes are read-mode Channel C consumers in v1 (0090 D4's
   public-bundle limit); they never construct a persisted-store writer, so
   OQ2's "constrained-surface knobs" collapse to *no writer, no knobs*. If
   the v2 authenticated-extension door opens, per-surface knobs are decided
   with it.
5. **Single-writer discipline without Web Locks.** The DK-9 native store
   replaces the Web-Lock role with an exclusively created on-disk lock file
   plus a same-process registry, serialized behind one in-process mutex
   (DK-9's single-connection discipline). Staleness is a **liveness**
   verdict (dead pid, own-pid-without-registration, unreadable lock) —
   never a timing lease — matching LLP 0008's rejection of lease-based
   ownership; a live foreign holder demotes the instance to a reader that
   adopts persisted tokens and skips writes, and ownership is re-attempted
   on every operation so takeover follows the holder's close or death.
6. **Corrupt-store posture (DK-9, inherited).** An unparseable or
   unknown-format blob is preserved byte-for-byte; reads raise
   `SNAPBACK_RQS_STORE_CORRUPT`, writes refuse, and `wipe()` — the
   user-switch/reset surface — is the caller-authorized reset. Entry-level
   corruption stays under `verifyPersistedResumeEntry` fail-closed
   verification, identical to web.

## Open questions

- **OQ1 — rung-2 witness wire format.** ~~Owned by 0090 rollout step 5a
  (Q7).~~ **Closed** by the dated rung-2 membership-witness amendment
  above (2026-07-24, ENG-25457).
- **OQ2 — native persistence knobs.** ~~Web cadence/budget values are pinned
  (§0A.5); whether the same numbers suit constrained native surfaces
  (widget/extension processes, DK-9 stores) is decided when rollout step 5
  reaches native, not here.~~ **Closed** by the dated step-5 native
  persistence-knobs amendment above (2026-07-25, ENG-25456).
- **OQ3 — resume-keyring rotation knob exposure.** The defaults are pinned
  (§0A.1); whether operators get a config surface to change rotation age /
  overlap per app (as auth-mode config does) is a cluster-0D/route-taxonomy
  question, since it interacts with the admin surface, not with the
  cryptography.

## Conformance — parity obligations

Cross-language property-based parity tests (0090 0A) must hold between the
Rust arm and the JS arms for every construction in this spec. Scaffolded
stubs land with this document and are ignored/skipped until cluster
implementation begins (they are named obligations, not CI gates):

- `crates/snapback/tests/rqs_digest_parity_v0.rs` — Rust side, `#[ignore]`d.
- `packages/snapback-client/rqs-digest-parity.test.mjs` — JS side, skipped
  via `node:test` skip; deliberately **not** added to the package's `test`
  script until implementation.

Obligations (property corpus must include numeric edge cases, duplicate
rows, Unicode-normalization-sensitive strings, and adversarial key
ordering):

1. **Canonical encoding parity** — identical JCS bytes for the shared
   corpus; identical mint-time refusals (non-finite, >2^53−1, lone
   surrogates, duplicate ids); negative zero serializes as `0` in both.
2. **Leaf parity** — identical 32-byte leaves for (id, row) pairs,
   including ids that are prefixes of one another (length-framing check).
3. **Multiset digest parity** — identical state bytes and published
   `mset1:` roots; insert/remove commutativity; incremental update equals
   from-scratch recomputation; a strict-subset change preserves untouched
   leaves (0090's accumulator-update fixture).
4. **Sequence digest parity** — identical `seq1:` digests; permuted row
   order changes the digest.
5. **Token MAC transcript parity** — identical transcript bytes and HMAC
   tags for fixture keys; refusal vectors for bad MAC, unknown/retired
   key, expired `issuedAt`, oversize token, and each §0B.6 admission
   mismatch expressible at mint time.

## Dated amendment: live-search replace cursor — 2026-08-02

Accepted LLP 0136 reserves one optional `cursor` string member on
`LiveEnvelope::LiveReplace`, populated only for live-search deliveries. On
such a delivery, absence means the page is terminal; a cursor-mint failure is
a failed wake that takes `resync_required`, never a cursor-less nonterminal
page. The member is absent on every other replacement. Its wire addition is
unknown-field-tolerable for old decoders but semantically load-bearing, so a
server may admit live search only on a connection bound to the cursor-aware
protocol in LLP 0094; tolerance is not negotiation.

This is a staged accepted contract, not a schema or implementation claim.
Landing it requires regenerated Rust-owned schemas, kit and LLP 0093 fixture
updates, cursor-present/cursor-absent and old-decoder cases, and absorption by
every LLP 0094–0096 replace renderer.
