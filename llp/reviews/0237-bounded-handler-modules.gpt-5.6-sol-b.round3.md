# LLP 0237–0243 lockstep final delta review — reviewer B, round 3

## Provenance

- **Reviewer:** B
- **Model:** OpenAI Codex GPT-5.6-sol, xhigh reasoning
- **Review mode:** author-directed single-family `llp-super-refine`
  adaptation; final lockstep delta round
- **Date:** 2026-08-12
- **Capsule:** `/tmp/snapback-llp-super-refine-r3-origin.K7mI2t`
- **Base:** `origin/main` at
  `b92bcd412622d63300105883154ae767d5927401`
- **Isolation:** reviewed only the frozen capsule; did not inspect another
  reviewer, any prior review artifact, or the live candidate workspace
- **Primary input:** LLP 0236 plus candidate RFCs LLP 0237–0243 and capsule
  `AGENTS.md`
- **Governing seams checked:** the capsule copies of LLP 0043, LLP 0053,
  LLP 0056, LLP 0180, LLP 0218, LLP 0231, LLP 0234, and LLP 0235 where
  mutation custody, command ambiguity, membership authority, visibility,
  invalidation, retention, and masking constrain this set

### Frozen input hashes

- LLP 0236 research:
  `237a50ebdedbcdadbdd197babcd04184f1ddf251b1a4ed6a4d4f88fec6ba93f8`
- LLP 0237:
  `a85c91ee9781814d4f1480daa7e9414a0e640159b754cee0227ac0f523cd6e3d`
- LLP 0238:
  `34f25e6b8c7a554d57b7970188353c03726e513643d328eac6a3baa7f1d4ddf5`
- LLP 0239:
  `b5d3958b3075582861ead50d8227c6714aa6d9a0f964e8ac4292f1617ba2aae9`
- LLP 0240:
  `71e85b361e31bc564d3847ef142d7858d0c268bb05e74df319915a3a2974e955`
- LLP 0241:
  `17ab2d020caaa8e020a6a465b445b8e6ff2a9a690eacc597147b7204906c083f`
- LLP 0242:
  `0f5a7cdf136e8e3774382dbb055c475df6be319515038c59a6d22f51f53e4a12`
- LLP 0243:
  `992fb4ca522e37495fa7415bf74b36c62f4b05cbc590c89b0b1948922203ef55`

## Delta audit

The claimed round-3 delta is present and internally closed:

1. LLP 0238 adopts LLP 0218's exact additive-open durable observation union,
   preserves `resultGone` as outcome-known/result-expired, and maps absent,
   collected, or inaccessible-predecessor facts to non-enumerating `unknown`.
2. LLP 0241 selects one pre-pointer candidate/readiness protocol with an exact
   predecessor, fixed roster, process-bound acknowledgements, a non-extendable
   60-second deadline, pre-commit drain, server commit as the linearization
   point, post-commit pointer repair, crash handling, zero-deadline behavior,
   and stale-custodian refusal.
3. LLP 0242 proves and enumerates the complete authorized scope universe at
   the page snapshot before item reads, seals the page without rows/cursor at
   the 257th scope, accounts for scope enumeration separately from item work,
   and binds the completeness proof into the authenticated continuation
   cursor.
4. The research/RFC headings, filenames, metadata, `Related` entries, and
   within-set cross-references consistently use LLP 0236–0243. References to
   LLP 0234 and LLP 0235 correctly refer to the origin override-governance and
   class-M documents, not stale pre-renumber identities.

No MATERIAL finding exists, so there is no finding to classify `IN-DELTA` or
`PRE-EXISTING`.

## LLP 0237 — Bounded handler modules

### Summary

The main-honest state machine is clear: snapshot and resolve the literal
relative ESM graph; refuse cycles, forbidden forms, capability escapes, path
escapes, mutation during read, or exceeded bounds; emit an immutable admitted
bundle and profile; then invoke only that bundle with no ambient resolver.
Codegen owns resolution, scanning, transform custody, and diagnostics; the
server owns invocation-time capability checks. Semantic/executable identity
binds canonical reachable code, normalized graph topology, declarations,
versions, and final bytes, while source prose and spans are evidence. Adoption
is additive and profile-versioned, first by explicit app capability and later
by `required-by-import`; old valid profiles are not reinterpreted. Every unsafe
candidate refuses before replacing the last complete generation.

### MATERIAL

None.

### MINOR

- The implementation Spec should label the D2 graph-record `source digest` as
  canonical-executable or raw-evidence explicitly. D4 already makes the
  intended boundary derivable, but the field name alone invites an accidental
  raw-byte contribution to executable identity.
- The integer-expression grammar and same-snapshot reread protocol properly
  belong in the promised AST/golden-vector Spec; the RFC has selected the
  public semantics and need not inline those vectors.

### Author questions

1. Should the graph-record schema carry two named digest fields immediately so
   an implementer cannot overload one digest across D2 and D4?

VERDICT: READY

## LLP 0238 — Explicit client lifecycles

### Summary

The RFC produces one usable lifecycle model rather than aliases over distinct
owners. One-shot reads settle directly; watches are explicit disposable
observables; mutation dispatch reports settled versus queued; the existing
outbox record remains the sole durable settlement owner; command tasks retain
their own terminal/ambiguity rules; presence stays latest-state ephemeral; and
the auth coordinator remains the source of `currentPrincipal`. Reference kind,
canonical contract values, authority partition, and normalized options form
resource identity. Existing APIs migrate through adapters/deprecation and are
removed only at a declared compatibility epoch. Kind mismatch, disposed
refresh, invalid canonical input, queueing, and custody refusal all fail at the
calling boundary with a typed next move.

The round-3 settlement seam is exact: `mutation(id)` exposes LLP 0218's
`pending | settled | failed | stranded | quarantined | resultGone | unknown`
union, remains non-consuming, creates no second ACK/collection cut, and does
not turn collected or inaccessible predecessor facts into an existence oracle.

### MATERIAL

None.

### MINOR

- The handle implementation Spec should freeze whether an initial queued
  subscription notification is suppressed when its unsubscribe runs before
  that microtask. Either choice is compatible with the selected public model,
  but parity fixtures should not discover the ordering independently.

### Author questions

None blocking.

VERDICT: READY

## LLP 0239 — Asset collections and the media field

### Summary

The durable workflow is coherent: validate sources and one binding; finalize
zero or more uploads; invoke the command-only mutation exactly once under a
persisted attempt identity; validate its result; then let the ordinary mutation
host reauthorize and stage parent, collection, attachment, and grant changes in
one transaction. The command/task facade never becomes a second commit owner.
Lost commit response is `ambiguous`; retry reuses the attempt/item plan and
returns a successor task; cancellation after invocation cannot claim rollback.
Collection identity is generation-scoped, deterministic, non-reused, and
preserved for retained assets. Existing asset APIs remain valid; adoption is
explicit, and legacy columns/rows move only through a reviewed migration plan.
Invalid descriptors, unbound direct dispatch, unsafe policy widening, unknown
renditions, and partial commit paths refuse without minting authority.

### MATERIAL

None.

### MINOR

- The binding-IR Spec should pin the exact path grammar for
  `parentResultPath` and argument/collection mappings. The RFC has correctly
  excluded callbacks, branches, and transforms, so this is serialization
  precision rather than an unresolved authority choice.

### Author questions

1. Will the v1 path grammar be property-only, or may it include bounded array
   positions in exact mutation results? The safer minimal reading is
   property-only until separately specified.

VERDICT: READY

## LLP 0240 — Application authority profiles

### Summary

The authority model has one source and one writer. The app membership table is
both product roster and LLP 0056 authority relation; the facade lowers to the
existing membership/policy IR, while all writes cross the central writer-class
seam and final-state owner invariant. Creation seats an eligible owner through
the creation witness; transfer is the only ordinary owner-changing operation;
resource teardown uses the deletion witness. The profile generation and every
dependent policy/search/asset plan rotate together. Migration is previewed,
refuses co-active authorities, and never chooses a winning roster
automatically. Strict custom policy refuses undeclared authority inputs;
non-strict policy remains coarse-global, online-only, and unable to make a
retention or pushdown claim.

### MATERIAL

None.

### MINOR

- The target-capability Spec should enumerate what counts as the conservative
  `coarse-global` wake universe. The RFC already requires refusal when a target
  cannot provide it, so no fail-open ambiguity remains.

### Author questions

None blocking.

VERDICT: READY

## LLP 0241 — Semantic artifact generations

### Summary

The identity and activation model is conservative and implementable. Immutable
cuts have distinct semantic, executable, evidence, bundle, and unique
generation identities; the per-consumer disposition map, not its display
maximum, governs activation. A candidate names the exact predecessor and fixed
custodian roster; custodians stage, pause predecessor admissions, drain owners,
and acknowledge zero ownership under one deadline; the server transaction is
the global activation linearization point; the local pointer is an owner-written
projection repaired from authenticated server inspection. Before commit,
expiry/crash/non-readiness returns to the predecessor. After commit, the
successor remains authoritative even if pointer projection or a custodian
crashes. In-flight and durable work remains generation-fenced; third-party
predecessor admission is compatibility- and `staleAfterMs`-bounded. Migration
dual-emits legacy identity and earns automatic reload one custodian at a time.

### MATERIAL

None.

### MINOR

- The envelope Spec should explicitly exclude root address fields from the
  bytes hashed into their own `bundleId`/`generationId`. D1–D2 clearly intend a
  domain-separated Merkle envelope, but `generation.json`, `integrity.json`,
  and "all five identities" otherwise permit a literal self-hash reading.
- The coordinator Spec should state whether an early byte-limit response is an
  immediate abort or a request for controlled restart. D5 permits a controlled
  restart under the same candidate before deadline and also says a byte-limit
  refusal causes abort; selecting the transition ordering avoids two faithful
  implementations making different availability choices. Neither reading can
  expose a half generation because the server commit still requires the full
  positive roster.

### Author questions

1. Is `restart-required` during preparation a provisional disposition that may
   be replaced by a positive acknowledgement before the deadline, or is it a
   terminal negative acknowledgement that aborts the candidate immediately?

VERDICT: READY

## LLP 0242 — Bounded query composition

### Summary

Each plan compiles to a closed, versioned IR with explicit indexes, authority,
bounds, result contract, dependency set, target capability, and common-snapshot
completeness witness. Runtime either proves an exact result at one snapshot or
returns a sealed refusal; it never substitutes a scan or partial answer.
Children resnapshot the whole composite, aggregates are exact-or-refuse,
activity is a bounded self-contained merge, and feeds prove the full authorized
scope universe before reading items, then run an exact bounded top-k frontier.
The plan/cursor/auth/snapshot identities fence continuations. Existing query
forms remain; migration is opt-in and semantic rather than sample-inferred.
Hidden-row-sensitive residual policies refuse at generation, and scope/work
overflow returns no partial rows, counts, cursor, or frontier details.

The final delta closes the feed hole: same-snapshot scope exhaustion is proved
through an invariant-backed full enumeration or a `maxScopes + 1` probe; the
257th scope seals before item reads; scope enumeration and item examination
have separate accounted ceilings; and the cursor binds the ordered-set
digest/count, exhaustion proof, proof identity, authority generation, and every
scope frontier.

### MATERIAL

None.

### MINOR

- The cursor-wire Spec should demonstrate the 64-KiB ceiling against the
  maximum-width admitted scope key and 256 frontier witnesses. Cursor overflow
  is already a typed refusal, so correctness is preserved; this fixture is
  needed to substantiate the advertised portable 256-scope floor rather than
  discover an availability-only lower limit in one target.

### Author questions

None blocking.

VERDICT: READY

## LLP 0243 — Policy-aware protected retention

### Summary

The lifecycle is fail-closed and preserves one owner: an eligible generated
projection receives a server-issued LLP 0053 lease at an exact authoritative
snapshot; the client atomically stores the excluded projection and all identity,
instance, invalidation, deadline, and clock facts; cold open validates them
before observation; valid data renders only as retained; known negative facts
quarantine/delete; reconnect reauthorizes and fresh-snapshots before current
release. The existing lease/query-instance coordinator remains authoritative,
one durable store writer owns eviction, and MAC verification stays correctly at
the server keyring. Descriptor contract, unique producing generation, authority
partition, query instance, and witness form identity. Predecessor protected
records migrate deletion-only unless exact mapping is proved; app caches are
retired explicitly. Ineligible plans, custom/coarse policies, missing durable
carriers, corrupt facts, and incompatible generations refuse before storing or
rendering protected bytes.

### MATERIAL

None.

### MINOR

- LLP 0043's dated JS-carrier text currently chooses delete-on-obligation
  because that implementation lacks a retained `pendingByScope` map, whereas
  D5/D7 of this RFC add a quarantined protected-view state. The implementation
  landing should amend that dated carrier text explicitly so the intentional
  availability improvement is not mistaken for two co-active state machines.
  Both states are fail-closed today; this is documentation/migration custody,
  not a security ambiguity in this RFC.
- The client projection Spec should pin the displayed `freshness` when an
  optimistic layer is composed over retained server data. The RFC correctly
  keeps the two facts separately inspectable and forbids `current`; choosing
  `optimistic` versus `retained` as the primary label is UI vocabulary, not an
  authority decision.

### Author questions

1. Should a retained base with optimistic presentation report primary
   freshness `optimistic` plus retained-base metadata, or primary freshness
   `retained` plus a separate optimistic flag? Either must remain visibly
   non-current.

VERDICT: READY

## Set-level consistency

### State machines and ownership

The set has no double owner. Codegen owns handler admission and generated IR;
the mutation host owns media commits; LLP 0056's central seam owns membership
writes; the server activation transaction owns generation currentness while the
local pointer is only its projection; the projection executor owns exact query
proof; and the existing LLP 0053/0043 query instance and store writer own
protected retention. LLP 0238 projects those owners rather than introducing
new transport, outbox, auth, or task custody.

The cross-RFC transitions line up: bounded module and policy/query/retention
changes enter LLP 0241's semantic cut; authority changes force
reauthorize/resnapshot; LLP 0242 supplies the common-snapshot result witness
that LLP 0243 retains; LLP 0240 supplies only strict generated policy to LLP
0243; LLP 0239 uses LLP 0238's task grammar without weakening LLP 0180
ambiguity; and LLP 0238 observes LLP 0218 settlement without consuming it.

### Identity

The set consistently separates stable public ids from semantic/executable
versions and evidence provenance. LLP 0237 and LLP 0241 use the same
conservative graph-edge rule. Media collection item ids are never reused;
authority profile generations rotate dependents; projection cursors bind plan,
snapshot, authority, and completeness; retained fragments bind descriptor,
generation, partition, and never-reused query instance. No sibling silently
retargets durable or in-flight work.

### Migration order

A non-cyclic implementation order exists:

1. land LLP 0237 preflight/profile and LLP 0238 lifecycle facades against their
   existing owners;
2. dual-emit LLP 0241 identities/envelopes before enabling automatic activation;
3. lower LLP 0240 to the existing LLP 0056/0231 authority IR;
4. land LLP 0242 plan nodes and common-snapshot witnesses;
5. land LLP 0239 media field/collection and mutation binding, enabling its
   LLP 0240 sharing composition only after both capabilities qualify; and
6. land LLP 0243 last, per durable carrier, consuming qualified LLP 0240/0242
   facts while retaining the legacy activation hash during LLP 0241 dual
   emission.

The RFCs themselves preserve narrower independent rollout orders, so this is a
dependency order rather than a mandate to batch publication.

### Refusal behavior

The set is consistently fail-closed. Bad module candidates do not replace
artifacts; wrong lifecycle kinds fail before transport; incomplete media
bindings fail before handler execution; ambiguous or co-active authority
profiles fail generation/activation; incomplete custodian rosters cannot commit
a generation; query work/scope overflow seals without partial data; and
unprovable/corrupt protected retention never writes or renders bytes. The
repairs are attached at the point of refusal without using observed hidden data
as diagnostic detail.

### MATERIAL

None.

### MINOR

The minor items above are suitable implementation-Spec/companion-document
closure work. None permits divergent public authority, durable result,
rollback, failure, or security semantics at the RFC decision level.

### Author questions

None blocking acceptance of the lockstep set.

SET VERDICT: READY
