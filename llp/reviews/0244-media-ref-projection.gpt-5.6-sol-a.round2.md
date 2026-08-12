# Round-2 delta review — LLP 0244 MediaRef projection

## Provenance

- **Model:** GPT-5.6-sol
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-12
- **Reviewed content SHA-256:** `d3fb99c4422dc1d82ec5b13c7374d63dcb44aeeedf25c62baa15c6da95d5866d`
- **Review mode:** Fresh reviewer-A delta review against the round-1 artifact and
  its bound predecessor SHA-256
  `af19d1ae7b0b79ea286984ce3b284e82611f6bff8df4d795320fce088149801b`.
- **Blindness statement:** I did not author LLP 0244, its round-1 review, or its
  revision; I received no private author rationale and did not communicate with
  the author during this review.
- **Method:** Verified the target hash before review; read the revised Spec and
  round-1 artifact completely; isolated the revision delta; checked the
  charter-named governing sections and cited runtime/storage seams; traced the
  staged Ibex mutation, OCC, same-id settlement, and exact recovery paths; and
  ran `./ref-check --verbose` successfully.

## Overall assessment

The revision directly answers all four round-1 MATERIAL findings and the MINOR
wording concern. The class-M-aware `via-references` rule is now complete, the
source-field token match is exact, mutation egress names one post-write cut, and
the settlement carrier can detect a valid-JSON edit while its seal remains
present.

The new mechanisms are not ready to implement, however. The commit-egress race
acceptance contradicts the inherited pinned-read/OCC rule; the new token has no
closed lifecycle across the actual preview/commit/retry carrier; the all-null
legacy branch is indistinguishable from a stripped new seal; and the digest is
not bound to the client-mutation settlement identity. All four concerns arise
in the revision delta. I found no MATERIAL `PRE-EXISTING` concern.

## Round-1 closure verdicts

### R1 MATERIAL 1 — class-M-masked reverse-edge authority: CLOSED

D2 now requires the asset authorizer to evaluate the exact referencing field's
class-M condition in its pinned storage snapshot, ignore a masked edge, and
capture the edge, source row/field, condition-input reads, policy identity, and
decision in the invalidation witness. It also places the field-keyed writeback
refusal before parsing or looking up any proposed asset id and makes the public
bytes independent of candidate lifecycle/kind. Acceptance 6 and 7 exercise both
halves. This closes the oracle identified in round 1 rather than merely fencing
`MediaKindProjectV1`.

### R1 MATERIAL 2 — mutation disclosure cut: CLOSED as an ambiguity; the selected rule creates M1 below

D1 now names the final post-write **commit-egress snapshot**, applies it to both
HostPlan and Ibex, re-resolves the exact cell/field generation/class-M condition
and finalized asset record, maps masked to `null`, and refuses an absent or
mismatched source. That closes the original underspecification. The new claim
that this cut alone decides concurrent races is inconsistent with the inherited
handler-read dependency/OCC contract, which is a distinct `IN-DELTA` concern.

### R1 MATERIAL 3 — JS source-field equivalence: CLOSED as to match semantics; token custody creates M2 below

The sidecar key now records table, field, field generation, row, asset id, kind,
policy identity, and snapshot. A result occurrence must match the exact source
table/field/generation; cross-field laundering refuses; only the original
host-tagged value retains the token through alias/selection. The acceptance
matrix covers cross-field reuse and provenance-losing copies. That is the exact
match relation round 1 requested. The new token's lifetime outside the handler
handoff remains unowned, as M2 explains.

### R1 MATERIAL 4 — settlement corruption carrier: PARTIALLY CLOSED

For a row whose complete seal remains present, canonical-byte comparison plus
the domain-separated digest detects malformed bytes and a valid-JSON semantic
edit such as changing only `kind`, before recovery publication. The revision
also states an intended predecessor policy. The policy is not yet executable
fail-closed because erasing every seal field produces the same observable row as
a genuine predecessor, and the digest does not bind the settlement identity;
M3 and M4 therefore leave this finding only partially closed.

### R1 MINOR — no-observing-position sentence: CLOSED

D2 now scopes the logical/physical fence to the masked cell and skipped media
operator, while explicitly permitting ordinary JS computation over a disclosed
`MediaRef`.

## New findings

### MATERIAL — IN-DELTA — M1: commit-egress “alone decides” conflicts with pinned handler dependencies and OCC

The revision says the committing transaction re-establishes media disclosure in
its final post-write view, deliberately distinct from LLP 0235's handler-read
snapshot. That can safely describe effects written by the same already-admitted
transaction. Acceptance 4 goes further: races between handler observation and
commit may change the source cell or its class-M condition, and “the final
post-write commit-egress snapshot alone decides.”

LLP 0235 requires condition lookups to use the invocation's pinned persisted
snapshot and enter the captured dependency set. The cited Ibex commit path
validates that captured set before applying buffered writes
(`src/storage.rs:3990-3993`), and a moved dependency refuses with
`SNAPBACK_MUTATION_CONFLICT` / `retryPolicy: reject`
(`src/storage.rs:10090-10100`). That validation protects not only the result but
all handler effects computed from the earlier view.

Two plausible implementations therefore diverge materially:

1. Preserve OCC. A concurrent source/condition change after handler observation
   refuses the mutation before commit-egress; only this mutation's own staged
   writes can affect its post-write disclosure decision. Acceptance 4's race
   outcome is false.
2. Let commit-egress alone decide as written. The kernel suppresses or exempts
   those dependencies, rebases only the returned media value, and may commit
   other buffered effects that the handler computed from a stale disclosed
   value or stale policy fact.

The second opens a TOCTOU/stale-authority seam; the first contradicts the new
acceptance contract. Repair by separating **external movement** from
**transaction-local post-write movement**: validate every handler-captured
source and class-M dependency under ordinary OCC, make external movement
conflict, then evaluate commit-egress over this transaction's admitted overlay.
If rebasing external movement is desired, it needs a new closed proof that all
handler effects are independent of the moved facts, not a media-result-only
normalizer. Acceptance must test the two cases separately.

### MATERIAL — IN-DELTA — M2: `MediaProvenanceTokenV1` has no closed preview/commit/retry lifecycle

The new text calls the token invocation-private and says it supplies the Ibex
source tuple to the commit kernel, but it does not define the host-owned carrier
or lifetime that makes both statements true. The real HTTP path executes Ibex,
places its plain JSON `result` into `BufferedCommitPayload`, dry-runs the payload,
and later performs the authoritative guarded commit
(`src/local.rs:11705-11764`, `11930-11956`). The current carrier has no result
provenance sidecar. A failed commit may then be followed by fresh execution;
concurrent same-id attempts may lose to a settlement inserted after their first
lookup and return the winner (`src/storage.rs:3797-3849`); an already-settled
replay returns before handler selection (`src/local.rs:11483-11545`). Warm Ibex
realms add another boundary at which a host-tagged object can remain reachable.

Plausible implementations can consume the token during preview and leave the
authoritative commit unprovenanced, serialize/reuse a source tuple across a
fresh retry, or keep a VM-global token registry that accidentally makes a tagged
object from an earlier invocation live. Those choices differ in retry success,
settled bytes, and whether earlier disclosure becomes a reusable kind oracle.

Define an exact lifecycle, analogous to LLP 0044's transaction-scoped asset
admission: mint under an invocation nonce/principal/generation/pinned snapshot;
move the sidecar into a typed process-local staged-result carrier before the JS
realm returns to the pool; permit non-authoritative preview without consuming
it; admit exactly the associated authoritative commit attempt; and invalidate
it after commit, conflict, refusal, cancellation, or losing concurrent
settlement. It must never enter JSON, `ctxLedger`, mutation identity, output, or
settlement bytes. Exact settlement recovery uses no token. Any fresh execution,
including same-id re-entry after no settlement exists, reruns the read and mints
fresh tokens. Acceptance needs preview→commit, OCC rejection→fresh execution,
same-id race, and warm-realm stale-object fixtures.

### MATERIAL — IN-DELTA — M3: the all-null legacy branch permits an undetectable seal downgrade

D1 says both that (a) every absent seal field means a predecessor row and follows
legacy checks, and (b) a media-projected row without a complete seal fails
closed. Recovery cannot implement both rules from the specified carrier. It may
run after the old function/result contract is gone, and a legacy `unknown`
result may structurally contain `{ assetId, kind }`; output shape is therefore
not an authoritative discriminator. If every seal column on a new media row is
missing or erased, its stored state is identical to the declared predecessor
case and silently downgrades to checks that do not detect a changed `kind`.

“No pre-capability artifact can claim `mediaRef.v1`” is true semantically but is
not a durable row witness after the active artifact disappears. One
implementation must treat all-null as legacy and accept the downgrade; another
must guess from output shape/current bundle and can reject genuine predecessors
or depend on code that recovery explicitly does not require.

Add an independently migrated row-format discriminator outside the nullable
seal group. Before capability activation, classify existing rows as an explicit
`legacy-settlement.v1` using migration-time provenance, not result bytes; new
media settlements atomically write an explicit sealed format. Missing, unknown,
or sealed-format-plus-incomplete-seal then fails closed. State the corruption
threat model as well: an unkeyed digest detects accidental inconsistency but
does not authenticate against an actor able to rewrite both data and digest.

### MATERIAL — IN-DELTA — M4: the seal is not bound to the client-mutation settlement identity

`settlementDigest` covers only `resultContractHash`,
`mediaProjectionProfileHash`, and `output`. It omits the retained row's
client-mutation/function/input/auth/authority identity. LLP 0043 already defines
`settlementId` as the stable digest over exactly those axes. Consequently, a
complete `(output_json, seal)` carrier can be transplanted between two rows with
the same result/projection contracts and compatible output versions—especially
two no-op/read-result mutations at one head—and each digest still verifies while
replay returns the other mutation's result.

That violates exact identity recovery even though neither JSON nor seal is
individually malformed. Include the canonical settlement identity (preferably
LLP 0043's existing `settlementId`/activity digest with its domain and all
identity axes) and the explicit row format in the digest preimage, persist the
bound identity beside the seal, and compare it to the request-derived identity
before publication. Add a cross-row substitution fixture, not only an in-place
`kind` edit.

## New MINOR findings

None.

## Author questions

1. Should a source-cell or class-M condition change committed by another writer
   after Ibex observation remain the ordinary OCC conflict, with commit-egress
   applying only after that proof and only to this transaction's own overlay?
2. What exact host carrier owns `MediaProvenanceTokenV1` from JS handoff through
   preview and the authoritative attempt, and when is it invalidated on conflict,
   same-id settlement loss, cancellation, and warm-realm reuse?
3. Which durable fact distinguishes a genuine pre-capability settlement from a
   new media settlement whose entire nullable seal was erased, without consulting
   output shape or the current function bundle?
4. Should the seal bind LLP 0043's existing `settlementId`, and is its integrity
   claim limited to accidental corruption rather than malicious database
   rewriting?

The Spec should remain Draft, close M1–M4, and receive another delta review.

VERDICT: NOT READY
