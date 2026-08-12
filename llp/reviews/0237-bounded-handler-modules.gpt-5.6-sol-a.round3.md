# LLP 0237–0243 lockstep review — round 3, reviewer A

**Review date:** 2026-08-12  
**Reviewer:** OpenAI Codex, GPT-5.6-sol, xhigh reasoning, reviewer A  
**Round:** 3, final delta review  
**Topology:** one lockstep review of LLP 0237–0243  
**Adaptation:** author-directed single-family `llp-super-refine`; Claude was
intentionally skipped  
**Blindness:** fresh capsule-only review. I did not read the live targets, any
prior `llp/reviews` artifact, orchestrator notes, or reviewer-B instructions or
output, and I did not communicate with reviewer B. The review was composed
before this artifact was written.

## Provenance and revision binding

- Capsule: `/tmp/snapback-llp-super-refine-r3-origin.K7mI2t`
- Capsule basis: fresh `origin/main` at
  `b92bcd412622d63300105883154ae767d5927401`, with candidate LLP 0236 and
  LLP 0237–0243 overlaid.
- Origin context included the newly landed LLP 0234 and LLP 0235. The candidate
  family was mechanically renumbered research 0234 → 0236 and RFCs 0235–0241
  → 0237–0243.
- Reviewer instruction SHA-256:
  `49aa6dde232617d172989df237d2064436525deefc42ce889ed80885529dde5b`
- Research input LLP 0236 SHA-256:
  `237a50ebdedbcdadbdd197babcd04184f1ddf251b1a4ed6a4d4f88fec6ba93f8`
- Governing newly landed context SHA-256:
  - LLP 0234:
    `214568dcda09f5b1d36de47fb7eb89eff2287f01c22232cbb2edadf27f1ab7b3`
  - LLP 0235:
    `270051855a996b19e12580c410344ca5da56dd4e8a4222d01c63813dc63f92f7`
- Additional exact predecessor contracts checked for the repaired deltas:
  - LLP 0218:
    `82a0a7cf2f871c263d5abb65769defe0320a47000fa98dcd3b3ddd90cbdae8b3`
  - LLP 0224:
    `69ec2e7d7958b2aef203528b546bd483fa1d668ea218416bad0fba622d401943`

Frozen target SHA-256 vector:

| Target | SHA-256 |
| --- | --- |
| LLP 0237 | `a85c91ee9781814d4f1480daa7e9414a0e640159b754cee0227ac0f523cd6e3d` |
| LLP 0238 | `34f25e6b8c7a554d57b7970188353c03726e513643d328eac6a3baa7f1d4ddf5` |
| LLP 0239 | `b5d3958b3075582861ead50d8227c6714aa6d9a0f964e8ac4292f1617ba2aae9` |
| LLP 0240 | `71e85b361e31bc564d3847ef142d7858d0c268bb05e74df319915a3a2974e955` |
| LLP 0241 | `17ab2d020caaa8e020a6a465b445b8e6ff2a9a690eacc597147b7204906c083f` |
| LLP 0242 | `0f5a7cdf136e8e3774382dbb055c475df6be319515038c59a6d22f51f53e4a12` |
| LLP 0243 | `992fb4ca522e37495fa7415bf74b36c62f4b05cbc590c89b0b1948922203ef55` |

All verdicts below bind exactly to that hash vector. I know of no later
revision and reviewed no later revision.

## Delta reviewed

The final delta claims three semantic repairs plus mechanical renumbering:

1. LLP 0238 D2 exposes LLP 0218's exact additive-open durable mutation
   disposition union and maps absent, ACK-consumed/collected, and inaccessible
   predecessor partitions to non-enumerating `unknown`.
2. LLP 0241 D4–D5 uses a pre-pointer `ActivationCandidateV1`, fixed custodian
   roster, bounded readiness leases, server commit as the activation
   linearization point, pointer repair, bounded abort/crash behavior, and
   post-commit stale deadlines including zero-deadline quiescence.
3. LLP 0242 D5 proves the complete authorized scope set at one snapshot by
   invariant or bounded 257th-scope probe and binds the proof into the cursor.

For this round, a MATERIAL concern would require two main-honest
implementations to diverge on public, durable, authority, identity, failure,
rollback, or security semantics. Each MATERIAL concern would be classified
`IN-DELTA` if caused by these repairs or the mechanical renumbering, otherwise
`PRE-EXISTING`. Ordinary implementation-Spec detail is MINOR.

## LLP 0237: Bounded handler modules

### Summary

The RFC chooses a coherent middle ground between self-contained handlers and an
ambient Node graph: codegen owns a bounded relative-ESM graph, rejects unsafe
syntax and capabilities before artifact replacement, and binds the complete
normalized graph and executable bytes into identity. The cycle/re-export rule,
v1 `.js`/`.mjs` custody, profile-selection evidence, cross-target admission,
and conservative agreement with LLP 0241 remove the material ambiguity that a
bundler or host loader might otherwise create.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern.

### MINOR

1. D3's phrase that negative, fractional, non-finite, out-of-range, or
   unproved index forms “refuse at the source span” should be split in the
   implementation Spec between static admission refusal and a runtime checked
   refusal attributed to that span. The RFC already chooses the closed grammar
   and length guard; this is diagnostic/operational detail, not an unresolved
   language decision.
2. After the renumber/rebase, add LLP 0235 to `Related` and state that its
   class-M `ctx.db` template extraction and field-use audit traverse the whole
   admitted helper graph. LLP 0235 already requires this fail-closed behavior,
   so the omission does not authorize raw masked-field access.

### Author questions

None blocking. The implementation Spec can choose the exact static-versus-
runtime diagnostic subcodes without reopening the module profile.

VERDICT: READY

## LLP 0238: Explicit client lifecycles

### Summary

The RFC gives each operation kind a truthful verb, makes continuing resources
observable and disposable, preserves durable mutation settlement outside a
process-local promise, and gives auth a closed current-principal projection.
The repaired D2 now matches LLP 0218 exactly: `pending`, `settled`, `failed`,
`stranded`, `quarantined`, `resultGone`, and `unknown`; observation is
non-consuming; `resultGone` remains distinct; and inaccessible predecessor,
absent, and collected states reveal no existence fact through `unknown`.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern. In particular,
the Round-2 durable-disposition concern is closed `IN-DELTA` without creating a
new tombstone, enumeration oracle, or consumption cut.

### MINOR

1. When LLP 0235 class-M results are supported, D3's public
   `snapshotVersion` must be documented as the authorized principal/query
   `viewRevision` (or an equally noninterfering public revision), never a raw
   row, app-commit, or storage snapshot version. LLP 0235 already imposes that
   rule; adding the cross-reference prevents the generic handle vocabulary from
   being misread.
2. Add LLP 0235 to `Related` when making that clarification. This is a
   renumber/rebase editorial integration, not a lifecycle defect.

### Author questions

None blocking.

VERDICT: READY

## LLP 0239: Asset collections and the media field

### Summary

The RFC keeps asset references addressable and policy-bearing while giving apps
ordinary optional and bounded-many media shapes. The closed
`MediaCommandBindingV1`, ordinary-mutation-host transaction ownership,
command-only direct-call fence, inherited LLP 0180 ambiguity/cancellation
contract, deterministic non-reused item identity, and commit-time authority
revalidation are mutually coherent. No upload completion is confused with an
application commit, and no convenience path bypasses attachment/grant custody.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern.

### MINOR

1. Add LLP 0235 to `Related` and make explicit in the implementation Spec that
   app media fields and generated collection-record fields receive the exact
   class-M field treatment required by that Spec; an asset-bearing field is not
   an unclassified exception to the all-fields fence. This is already implied
   by LLP 0235's universal fence.
2. The eventual video rendition profile must freeze MIME/container/codec and
   fallback semantics before advertising `media.video.playable.v1`, as the RFC
   already acknowledges in its open question. That is qualification detail,
   not a missing authority decision.

### Author questions

None blocking.

VERDICT: READY

## LLP 0240: Application authority profiles

### Summary

The RFC is a strict facade over one LLP 0056 membership relation and LLP 0231
table-policy identity, rather than a second roster or evaluator. The real owner
role, central writer seam, final-state last-holder invariant, exact generated
roster operations, strict-versus-coarse custom-policy split, non-enumerating
reads, and independently gated asset composition close the dual-roster problem
without weakening server-derived authority.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern.

### MINOR

1. Add newly landed LLP 0234 to `Related` and say explicitly that a profile or
   role-lattice edit which broadens or is incomparable to the predecessor
   ordinary visibility policy is subject to LLP 0234's remotely prior,
   content-bound ordinary-policy transition approval and exact-set ratchet.
   D2's identity rotation and requalification are compatible with, but do not
   replace, that governance prerequisite.
2. Add LLP 0235 to `Related` for generated roster projections. Conditional
   field disclosure remains class M; a visible roster field list is not a
   masking bypass.

### Author questions

None blocking. These are cross-document integration notes produced by the
renumber/rebase, not new authority mechanisms for this RFC to design.

VERDICT: READY

## LLP 0241: Semantic artifact generations

### Summary

The split between semantic, executable, evidence, bundle, and unique generation
identity is conservative and preserves exact stale-reference fences. The
per-consumer disposition map remains authoritative, with the total order used
only for display. The repaired activation protocol now has a clear global
linearization point: immutable candidate and expected predecessor, fixed
required roster, process-bound leased ACKs after quiescence, server transaction
before pointer CAS, prepared exposure only after the authenticated committed
fact, bounded abort, crash recovery on both sides of commit, and post-commit
stale refusal. Zero-deadline security cuts require owned first-party custodians
to be quiesced before commit and refuse predecessor work immediately after it.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern. The Round-2
pre-pointer/partial-activation concern is closed `IN-DELTA`: pointer lag after a
successful server commit is repairable projection staleness, while failure or
expiry before commit leaves the predecessor authoritative and resumes it only
after acknowledgements are invalidated.

### MINOR

1. Add LLP 0234 and LLP 0235 to `Related` when their generated policy artifacts
   enroll. A governed visibility widening has an LLP 0234 approval prerequisite,
   and a class-M policy-program or physical-certificate change has LLP 0235's
   authorization-event/fresh-replacement disposition. D3's generated
   per-consumer map can already represent both; naming them avoids an
   implementation treating such changes as ordinary server reloads.
2. The implementation Spec should name whether the fixed roster identifies a
   custodian slot or a process instance. The text already permits a controlled
   restart to ACK the same candidate while binding each ACK to a process
   instance, so this is schema detail rather than an activation ambiguity.

### Author questions

None blocking.

VERDICT: READY

## LLP 0242: Bounded query composition

### Summary

The four-shape algebra remains deliberately shallow, exact, bounded, indexed,
authority-aware, and target-qualified. Children use one-snapshot composite
completeness; aggregates are exact-or-sealed and reject residual hidden-row
policies; activity is a bounded source union; feeds use exact bounded top-k
frontiers rather than per-scope truncation. The repaired D5 now establishes the
complete authorized scope set before any item read, using either a cardinality
invariant plus exact enumeration or an authority-pushdown-complete 257th-scope
probe. Overflow produces one sealed refusal with no rows, cursor, count, or
item read, and the cursor binds ordered-set digest/count, exhaustion, proof
identity, snapshot, and authority generation.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern. The Round-2
partial-scope-feed concern is closed `IN-DELTA`: no implementation may produce
a page or cursor from only the first 256 of a larger authorized scope set, and
scope proof work is separately accounted from item work.

### MINOR

1. Add LLP 0235 to `Related` and require each new `ProjectionPlanV1` node to
   publish the class-M field-use inventory and target physical certificate (or
   refuse class-M sources) for filters, ordering, joins, aggregate inputs,
   cursors, indexes, and derived output. LLP 0235 already makes unknown plan
   positions fail closed, so this is explicit integration rather than an open
   security choice.
2. D5 groups snapshot-retention loss, scope/authority change, and cursor-size
   overflow under a fresh-snapshot requirement. The implementation Spec should
   give structurally oversized cursors a repair that can actually converge
   (for example, narrow `maxScopes`/key shape or use a future server-held cursor)
   rather than promising that an unchanged fresh snapshot will necessarily fit.
   The current 64-KiB refusal remains fail-closed and returns no incorrect page.

### Author questions

None blocking.

VERDICT: READY

## LLP 0243: Policy-aware protected retention

### Summary

The RFC chooses a narrow generated-plan-only protected view and extends the
existing LLP 0043/0053 query-instance and `AuthorizedLease` carrier instead of
inventing a cache authority. Exact descriptor identity, server-issued bounded
leases, pre-store exclusions with derived-field provenance, partitioned
fail-closed real storage, deterministic eviction, omitted logical backups,
ordinary watch/hook freshness, reconnect resnapshot, and coarse-safe
invalidation collectively preserve the distinction between retained and
current data. It also states the honest security limit: a disconnected honest
device may display stale authority only within the unextendable lease window;
MAC authentication remains server-only exactly as LLP 0053 requires.

### MATERIAL

None. I found no `IN-DELTA` or `PRE-EXISTING` MATERIAL concern.

### MINOR

1. Add LLP 0235 to `Related` and explicitly state the class-M composition:
   only the principal-visible masked projection and `viewRevision` may enter
   the retained fragment; a known disclosed→masked transition immediately
   quarantines; an unreachable device's residual exposure is bounded by the
   same declared lease, not by a raw snapshot/version carrier. D4 and D7 plus
   LLP 0053 already imply this outcome, but the cross-reference would make the
   security posture unmistakable.
2. Generated media-field retention should point back to LLP 0239's intent and
   grant generation when explaining why a normal asset id is retainable while
   a view-once/pending grant or delivery URL is not. The decision is already
   present; this is explain/provenance detail.

### Author questions

None blocking. The author may wish to state the class-M/lease interaction in
one normative sentence before acceptance because it spans two newly adjacent
documents.

VERDICT: READY

## Set-level consistency

The seven RFCs form one consistent improvement set:

- LLP 0237 supplies the bounded executable graph whose semantic/evidence split
  LLP 0241 activates.
- LLP 0238's reference and handle vocabulary projects LLP 0239 commands, LLP
  0240 roster operations, LLP 0242 plans, and LLP 0243 retained views without
  taking custody from their underlying durable owners.
- LLP 0239 and LLP 0240 gate their cross-composition independently, avoiding a
  cyclic activation prerequisite.
- LLP 0240 supplies a closed authority profile that LLP 0242 may consume for
  complete feed scopes and LLP 0243 may consume only in its strict eligible
  lane; neither downstream RFC treats profile declaration as offline authority.
- LLP 0241's per-consumer dispositions can carry the migration,
  reauthorization/resnapshot, retention purge, restart, and manual prerequisites
  produced by every sibling without collapsing them into its display maximum.
- LLP 0242 exposes server/live/local/retained eligibility separately, so it
  does not confer LLP 0243 custody by being server-portable.

The mechanical renumbering is internally coherent across the target vector. It
did leave the newly occupied LLP 0234/0235 out of several `Related` lists and
point-of-integration sentences. The per-RFC MINOR notes above should be folded
in as editorial/cross-governance hardening, but the governing documents already
fail closed and no target text contradicts them. They therefore do not create a
MATERIAL divergence.

The three final-delta repairs are mutually consistent and introduce no new
MATERIAL concern. I found no MATERIAL concern in pre-existing text. No later
unreviewed target revision is included in this verdict.

SET VERDICT: READY
