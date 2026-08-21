# LLP 0277: Coterie and Clique run observations

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Benchmarks, Agent experience, Developer
experience, Auth, Application data API, Live Queries, Ephemeral state, Assets,
Memberships, Code generation, Runtime, Client integration, Exact/Contract
integration, Diagnostics, Guide, Testing
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-17
**Revised:** 2026-08-21 (P17 follow-through: records the packed external Expo
Metro cycle repair); 2026-08-20 (0.1.24 matrix amendment: adds the completed
three-model-family x two-profile x two-app published-package run, preserves
its calibration-only claim posture, enumerates the positive and negative
findings, and analyzes where wall clock, output tokens, and correction loops
accumulated; routes straightforward defects to filesystem tickets and the
cross-cutting remainder to LLP 0295)
**Revised:** 2026-08-17 (initial Draft: synthesizes the Coterie
Exact/Contract benchmark arc of Diary 0086 — the 2026-08-15 backendless
baseline through the 2026-08-17 M1–M3 program closure — together with the
Clique 0.1.21 sweep deltas that LLP 0236's synthesis does not already own)
**Related:** LLP 0013, LLP 0056, LLP 0059, LLP 0061, LLP 0201, LLP 0208,
LLP 0236, LLP 0240, LLP 0243, LLP 0252, LLP 0253, LLP 0258, LLP 0264,
LLP 0266, LLP 0267, LLP 0269, LLP 0270, LLP 0274, LLP 0278, LLP 0279,
LLP 0280, LLP 0281,
Diary 0078, Diary 0079, Diary 0080, Diary 0081, Diary 0082, Diary 0083,
Diary 0084, Diary 0085, Diary 0086, Diary 0092, Diary 0093, Diary 0094,
Diary 0095, Diary 0096, Diary 0097, Diary 0098, Diary 0099, Diary 0100,
Diary 0101, Diary 0102, Diary 0103, LLP 0295

## Summary

The latest run of the social-messenger benchmark family — the Clique 0.1.21
five-backend sweep and the Coterie Exact/Contract benchmark through its M1–M3
program closure — is the first run in which the architectural bet at the
center of both programs held end to end: **one provider-neutral declaration
stayed byte-frozen while a deterministic memory provider and a real Snapback
backend implemented it, and no presentation route changed when the backend
did.** Snapback's sessions auth, asset admission, and server-authoritative
live queries carried three milestones of a real messaging product, and the
two-client stream proofs repeatedly looked like ordinary Convex live queries
rather than stitched invalidation.

The friction that remains clusters in four places, none of which is the core
data model:

1. **Relational and paged live-query composition.** Whole-list provider
   contracts versus 1,024-row live windows, hand-built keyset pagination,
   chunked `in()` semi-joins, and per-entity aggregate stream fan-out were
   the run's largest sources of adapter machinery (routed to LLP 0278).
2. **Cross-system write seams.** Credential issuance, asset finalization, and
   application writes cannot be one transaction; every honest composition
   (partial registration, persona replacement, terminal sign-out, attach
   residue) was discovered per-app instead of paved (routed to LLP 0280).
3. **Exact/Contract generator and runtime gaps.** The Contract UI and the
   provider seam were strong; the surrounding generator, error envelope,
   mock boundary, and dev loop produced a long tail of discoverable-only
   sharp edges (routed to LLP 0279).
4. **Instrument observability.** The frozen choreography still cannot observe
   media composition, semantic receipts, sender avatars, or membership
   lifecycle, and one required-check red was a measurement artifact (routed
   to LLP 0281).

The published 0.1.24 matrix materially advances that result. All six Clique
lanes completed M1-M3 green, all twelve lanes completed, and 35 of 36
milestone cells were green; the one red was an Exact choreography defect, not
a Snapback capability failure. Three model families completed both authoring
profiles from npm with no source-checkout escape. The architectural center is
now repeatably buildable. The remaining tax is concentrated at the perimeter:
dev attach and carrier lifecycle, auth custody and transitions, handler-dialect
discoverability, client/provider lifecycle, membership projections, and
instrument-driven correction loops.

This document is a descriptive synthesis with routing. LLP 0236 continues to
own the earlier Clique cross-model register; this amendment supplies its
published-0.1.24 rerun evidence. LLP 0266 owns the Coterie benchmark, LLP 0281
owns instrument observability, and LLP 0295 coordinates the matrix-derived
cross-cutting improvement program. Implementation routes to the subsystem
owners and tickets named below.

## Evidence boundary

### Runs included

1. **The Coterie Exact/Contract benchmark, M1–M3** (LLP 0266), recorded in
   [Diary 0086](../diaries/0086-coterie-exact-contract-backendless.diary.md):
   the backendless Contract shell and deterministic memory provider
   (2026-08-15), the provider-neutral declaration freeze, the Snapback M1–M3
   backend lanes, the Snapback `ContractDataProvider` adapter growth to an
   M1+M2+M3-minus-typing claim, the dual-review fault-cut rounds, and the
   2026-08-17 envelope ruling and program closure. The closing shared
   acceptance artifact reported 28 passed claimed steps and two typing skips
   across both boot states, with memory as the full-surface client lane.
2. **The Clique 0.1.21 exploratory sweep** (Diaries
   [0079](../diaries/0079-clique-0121-snapback-familiar.diary.md),
   [0080](../diaries/0080-clique-0121-supabase.diary.md),
   [0081](../diaries/0081-clique-0121-snapback-simplified.diary.md),
   [0082](../diaries/0082-clique-0121-pocketbase.diary.md),
   [0083](../diaries/0083-clique-0121-snapback-explicit.diary.md),
   [0084](../diaries/0084-clique-0121-instantdb.diary.md),
   [0085](../diaries/0085-clique-0121-convex.diary.md)) and the earlier
   two-model familiar pilot
   ([Diary 0078](../diaries/0078-clique-familiar-convex-pilot.diary.md)).
   LLP 0236's 2026-08-15 revision already synthesizes these lanes, records
   which observations were corrected on main, and owns the residual
   Explicit/Familiar agenda. This document does not re-own that synthesis; it
   records only the deltas that survived it or that the Coterie run
   independently corroborated.
3. **The published 0.1.24 model x profile x app matrix**
   (`benchmarks/runs/2026-08-17-model-profile-app-matrix/`), recorded in
   Diaries 0092-0103. It crossed GPT-5.6 Sol, Grok 4.6, and Claude Opus 5
   with Explicit and Familiar authoring over Clique (Expo Router web) and
   Coterie (Exact/Contract web). All twelve lanes used published npm 0.1.24;
   no lane read the Snapback source checkout. The retained external run
   workspace contains harness event streams, per-lane run logs, load samples,
   receipts, and `meta/final-metrics.json`; the committed run record is the
   durable aggregate.

### Claim posture

All lanes are N=1 exploratory or calibration evidence. Nothing here is scored,
claim-eligible, a profile-default decision, or a population comparison; LLP
0189 and LLP 0201 govern publication-grade claims. In particular, host-load
contamination and one interrupted Opus lane make cross-lane wall comparisons
unsafe. The Coterie evidence is strongest where it is
narrowest: headless generated-binding acceptance, two-client stream proofs,
and conformance reports with stated operation scope. It is deliberately not
browser-context, native-host, durability, or population evidence, and the
diary says so at every boundary.

### Confidence vocabulary

As in LLP 0236: **convergent** (independently observed at least twice),
**repeated** (multiple diaries, not fully independent), **single-run**, and
**historical** (valid at observation time; a later landing closed it).

## What worked and must be preserved

These are the run's positive findings — the properties later friction work
must not regress.

- **The provider seam is real.** One provider-neutral `coterie` declaration
  and manifest, a digest handshake that fails closed on a wrong manifest, and
  a factory-scoped backend choice meant none of Coterie's `.contract` routes
  changed across memory → Snapback M1 → M2 → M3-minus-typing. The review
  round that forced this shape (a `coterie-memory`-identified declaration
  could never admit a Snapback-emitted one) was the program's most valuable
  single correction. *Repeated.*
- **Claims-gated affordances beat provider branches.** `listProviderClaims`
  (LLP 0266 D11) let a milestone-partial adapter render an honest subset —
  unavailable actions are absent, not inert — with no provider identity in
  presentation code. This pattern generalizes to any capability-partial
  backend and belongs in the guide's vocabulary. *Single-run, structurally
  load-bearing.*
- **Sessions-mode auth was the big win.** `defineAuth` supplied signup,
  sign-in, recovery, durable bearer custody, and revoking logout;
  `auth: 'authenticated'` plus `ctx.auth.userId` ownership comparison plus
  unique indexes made the M1 authority model structural. The Convex control
  had to build all of this by hand. *Convergent across Coterie M1 and both
  Clique pilots.*
- **The asset path was cohesive.** One `defineAssetUpload`, one typed
  `v.assetRef`, one `ctx.assets.attach` delivered admission, trusted type
  detection, GPS stripping, renditions, reference tracking, and
  public-immutable delivery. The guide's explicit warning that post-finalize
  mutation failure can retain residue was exactly the fact an honest adapter
  needed. *Repeated.*
- **Codegen feedback and determinism.** The implicit-visibility warning named
  its guide anchor; declaring intent left zero warnings; consecutive runs
  produced byte-identical generated output. *Repeated.*
- **The brief is the contract.** Both the M1 field-limit drift and the M2
  video ceiling pinned to a fixture's byte size were caught by dual review
  against `benchmarks/briefs/social-messenger.md`, not by the build pass.
  Validation written from taste drifts; review against the brief is the
  correction mechanism that worked twice. *Repeated.*
- **Live delivery kept its shape under adaptation.** Two independent clients
  over one ephemeral server observed profile edits, posts, like counts,
  messages, and receipt transitions on already-armed streams with polling
  disabled, at M1, M2, and M3. The diary repeatedly judged this "closer to an
  ordinary Convex live query" than the workaround architectures it replaced.
  *Repeated.*
- **Honest evidence boundaries.** Milestone refusal errors citing LLP 0266
  D7, conformance reports with stated operation scope, DESTRUCTIVE-WITH-RESEED
  posture statements, and skipped-by-claim acceptance steps kept partial
  claims from looking whole. This discipline is what made the program's
  closure countersignable. *Repeated.*

## Findings register

### F1. Whole-result provider contracts meet windowed live queries — convergent

Snapback's authored live-query/result contract caps one window at 1,024 rows.
Coterie's frozen provider contract declares whole chat/message lists. The
first adapter reconciliation built a live head plus a merged keyset-page
archive — and the final review found that architecture held a split-brain
state (live head rows beside stale receipt/membership projections). The
superseding envelope ruling — 1,024 messages per conversation, 1,000 chats,
whole envelope in one live window, loud provider error past the bound — was
*simpler and stronger*, and deleting the pagination machinery improved the
proof. The same seam appeared earlier as Diary 0078's generated `take(4096)`
runtime refusal (the generation-time ceiling refusal has since landed) and as
the M2 feed's hand-built "newest page live, older pages snapshot" accumulator
with its intent overlay and reset rules.

**Learning:** the platform's windowing rules are sound, but every app is
currently designing its own page envelope, boundary witness, cursor
vocabulary, and live/snapshot composition from first principles. Routed to
LLP 0278 (paged live results); envelope growth options are ticketed in
`issues/20260817-coterie-message-envelope-growth.md`.

### F2. Aggregate projections do not compose across entity sets — single-run, structurally significant

`listProfiles@2` is one list, but `profileStats` is keyed to one profile. The
adapter retained a stats stream per visible profile, joined snapshots, and
fanned updates to every observer — and transited real failure modes on the
way (zero-count exposure while streams opened; auth-establishment throttling
on rebuild). A backend list-shaped stats projection or a first-class
generated multi-query composition would have removed the whole layer. Routed
to LLP 0278.

### F3. The `in()` operand bound turns membership feeds into bespoke query planning — repeated

The 500-operand bound would have refused the benchmark's 500-follow probe
user. The M2 backend chunked actor IDs at ≤499, ran an indexed top-20 per
chunk, and merged by immutable page key — exact and provable, but an opaque
plan the author designed from first principles. The guide's paged-list recipe
covers one ordered table; the `feedEvents` normalization and cursor ownership
had no paved analogue. Routed to LLP 0278 (closed semi-join helper);
interim guide recipe ticketed in
`issues/20260817-guide-gap-chunked-semijoin-feed-recipe.md`.

### F4. Cross-system write seams are real and unpaved — convergent

Three concrete seams, all from adversarial review rounds rather than happy
paths:

- **Partial registration.** Password issuance and the profile mutation cannot
  be one atomic write; a forced handle race bricked the email until Coterie
  declared `PartialRegistrationError`, cleared custody, and let a later
  login enter a recognized incomplete-profile state.
- **Persona replacement.** Snapback correctly refuses to silently adopt Bob
  over Alice's live bearer; the adapter had to express login-over-live-bearer
  as two explicit authority transitions (settle predecessor logout, then
  issue successor) after first misreading the refusal as a credential error.
- **Terminal sign-out and adoption rollback.** Local sign-out had to become a
  `finally`-style terminal path when remote revocation is unknown, and a
  capture-scoped custody clear was needed when a projection failed after a
  bearer was adopted.

The asset finalize→attach seam is the same shape: a refusal after trusted
finalization leaves a ready asset, and the adapter's owner/digest reuse
mapping was invented, not paved. Routed to LLP 0280.

### F5. Ephemeral state needed membership-backed permission lowering — historical, now closed at the platform layer

The M3 review correctly ruled that `allow.all()` typing was observable and
spoofable by former members, so Snapback shipped "messaging core minus
typing" while the memory provider carried typing alone. The platform gap
closed on main on 2026-08-17: `allow.members` now lowers a declared canonical
membership relation into the protected ephemeral permission backing, with
current-row (not incarnation) authority, terminal removal, write scoping, and
first-class negative fixtures
(`issues/closed/20260817-ephemeral-membership-permission-backing.md`).
Residuals: role narrowing
(`issues/20260817-ephemeral-membership-role-narrowing.md`), the overlay's
missing terminal Error arm
(`issues/20260817-ephemeral-overlay-missing-error-arm.md`), and Coterie's own
adoption — its schema uses incarnation-oriented membership and must migrate
to a canonical `membership()` declaration first
(`issues/20260817-coterie-typing-allow-members-adoption.md`).

### F6. Authorization census blind spot for helper-mediated writes — historical, now closed

At M2 the codegen authorization review saw only writes lexically inside
handlers, so helper-mediated writes projected zero checks. Closed on main:
the census now shares the splice-resolved helper reachability with execution
and classifies dynamic dispatch as `opaque`
(`issues/closed/20260816-codegen-authorization-census-helper-writes.md`).
Retained here as regression evidence for LLP 0274's governance surface.

### F7. Membership incarnations versus bounded reads — single-run, high value

Modeling leave/rejoin as distinct membership rows fit the brief's
send-time recipient semantics cleanly, but the review's best catch was that
bounded reads over unbounded incarnation history could silently drop an
active member from access checks. The fix — an indexed current-membership
projection queried separately from history, locked by a 640-cycle churn test
— is a pattern the guide should carry alongside the membership recipes, and
the same current-versus-history distinction is exactly what `allow.members`
v1 binds (F5). Removal cutoffs similarly belong in the query layer on every
read path, including fixture helpers, where review caught a bypass.

### F8. Video admission cannot express codec or duration facts — single-run

Upload intents bound media type and byte size, but the brief's H.264/AAC and
60-second ceilings are inexpressible, so M2 video admission is honest about
enforcing less than the product rule. Ticketed as
`issues/20260817-upload-intent-codec-duration-admission-facts.md`; the
storage graduation plan (LLP 0269) is the natural owner.

### F9. Exact/Contract carries its own friction register — repeated

The Contract authoring model (plain values, callback props, leaf-event
currying, one source for web and native) repeatedly kept the portable UI
small, and Acto's native tree caught real portability defects the web
compiler could not. Around that core, the run accumulated a specific list:
the declared-error envelope drops typed `code` fields; mutations have no core
compatibility-token schema key; the generator emits self-referential type
aliases on result-name collisions and widens `string | null` sidecar fields;
provider list queries have no typed page envelope; the mock boundary
subscribes one anchor table; there is no file-input primitive, no ephemeral
descriptor generation, no app-environment projection for native, no
in-process Acto mount for routed graphs; and the dev loop's typecheck follows
the dirty sibling checkout. Each item is small; the sum was the largest
discoverable-only tax in the Coterie program. Aggregated with priorities in
LLP 0279 and its tickets.

### F10. The instrument still cannot observe what the products now do — convergent

Every lane in both programs recorded the same structural skips: no
media-picker test ID, no semantic receipt tokens, no sender-avatar or
membership-lifecycle observability. The Clique typing red of Diary 0081 was
root-caused to the choreography's observation boundary (clock includes the
synthetic typing action), not delivery latency — the platform measured 1.68
ms where the instrument reported 2,045+. Selector breadth (a group preview
matching a DM regex), suite-status linkage omissions surfacing as late
non-greens, and missing provider-credential preflight (the Supabase lane
burned its whole budget on absent authority) complete the register. Routed to
LLP 0281.

### F11. Small client/codegen papercuts — single-run each

- The generated `api.mjs`/`api.d.ts` pair is correct for consumers, but a
  bundler-mode resolver did not infer the declaration for a relative `.mjs`
  import, forcing a typed bridge
  (`issues/20260817-generated-api-dts-bundler-resolution.md`).
- Memoizing presence options widened the unique `skip` sentinel to a generic
  symbol until constrained from the exact reference signature
  (`issues/20260817-presence-skip-sentinel-type-widening.md`).
- Fixture aliases sharing bytes made `avatarSourceDigest` unable to
  distinguish same-byte sources; the adapter maps digests to canonical refs
  and returns `null` rather than inventing provenance. Recorded as a
  vocabulary caution for fixture design, not a platform defect.

### F12. Clique 0.1.21 deltas beyond LLP 0236 — mostly closed since observation

LLP 0236's closed-corrections table already retires the sweep's
generated-directory, operation-name, take-ceiling, schema-lowering,
descriptor-admission, binding-remint, logout-race, auth-churn, video-intent,
and elevated-read findings, pending external-package reruns. Since that
revision, additional observed gaps landed: native durable custody shipped in
the 0.1.24 closure (Experimental; LLP 0258 phase record), the media
happy-path phases landed (assetCollection, defineMediaCommand), the
password-provider minimum-length default was corrected
(`issues/closed/20260815-password-provider-min-length-default.md`), and the
auth queue-store isolation series closed the owner-keyed custody/queue
classes behind the 0.1.24 gate. The rerun obligation stands: none of these
corrections has been revalidated by a fresh external-package Clique lane, and
LLP 0236's recommended rerun protocol remains the instrument for that.

## Published 0.1.24 matrix findings

### Result and efficiency envelope

The matrix completed. Clique was 18/18 milestone cells green across six
lanes; the whole matrix was 35/36 green, with the single red attributed to
Exact's SPA link-detachment behavior. This is a qualitative phase change from
the 2026-08-13 pilot, where Familiar was unpublished, source-package closure
dominated M1, and Grok's Familiar M3 never became green.

The raw totals are useful as an accounting envelope, not a profile ranking:

| App | Profile | Wall seconds (three lanes) | Output tokens | Approx. cost |
| --- | --- | ---: | ---: | ---: |
| Clique | Explicit | 35,338 | 649,428 | $192.68 |
| Clique | Familiar | 36,461 | 758,637 | $233.45 |
| Coterie | Explicit | 26,380 | 788,664 | $215.66 |
| Coterie | Familiar | 22,916 | 682,322 | $164.58 |

Across all six lanes per profile, Explicit and Familiar were nearly equal:
1,438,092 versus 1,440,959 output tokens and 61,718 versus 59,377 wall
seconds. That superficial tie hides a repeatable **app/profile interaction**:
every Clique Familiar lane used more output tokens and cost than its same-model
Explicit pair, while every Coterie Familiar lane used fewer. Harness activity
counts point in the same direction where they are comparable: Grok used 214
versus 271 usage events on Clique Explicit/Familiar and 425 versus 314 on
Coterie Explicit/Familiar; Opus used 434 versus 541 turns on Clique and 421
versus 336 on Coterie. This is exploratory, but it is strong enough to reject
one global statement such as "Familiar is cheaper" or "Explicit is cheaper."

Wall does not adjudicate the profiles. Grok Clique Familiar shared the
heaviest machine load; Opus Clique Explicit was interrupted by an API 500 and
later ran browser checks at load averages near 150-700. The correct next
question is why profile fit changes by client stack, measured with repeated,
load-isolated lanes and per-phase usage.

### What was consistently good

#### G1. Published closure and cross-family completion — convergent

All three model families built both profiles from npm without reading the
Snapback source checkout. None of the six pre-cut release-gate defect families
(live subscriptions, auth queue-store isolation, Expo WASM export, and
visibility stragglers among them) recurred on paths every lane exercised. The
release-gate work converted a previously source-only experiment into a public
surface agents could actually finish.

#### G2. Server-homed invariants and exact references — convergent

Every family praised the same center: generated exact references, idempotent
set-state mutations, unique indexes for likes/reposts/DM pairs, server-derived
principals, and domain functions whose authorization is inspectable. Explicit
made the declarations maximally greppable; Familiar made ordinary schema and
function code compact without moving authority to the client.

#### G3. Live two-client behavior without transport code — convergent

Profiles, feeds, counters, messages, and receipts propagated through the same
query surfaces the UI already consumed. Builders did not implement a second
WebSocket protocol or manual cache invalidation layer. When query shape and
client lifecycle were correct, visible changes normally arrived within one
network turn or well under a second.

#### G4. Ephemeral state, membership, and assets — repeated

The Opus lanes called membership-backed typing and TTL expiry category-level
advantages over Convex-style durable heartbeat rows. Membership bootstrap and
transition matrices turned multi-step group authority into one atomic command.
Typed asset references plus declared delivery/image policy were a positive
surprise where the correct intent and hook were reached. These mechanisms must
not be weakened to make the first-use path shorter.

#### G5. Refusals and diagnostics — convergent, with silent exceptions

Typed refusals often named the stale identity, violated rule, source span,
repair alternatives, and guide anchor. Multiple diaries judged this best in
class and credited it with turning redesigns into sub-thirty-minute loops.
The negative findings below are therefore especially diagnostic: time exploded
where a failure was silent, crossed a package boundary, or carried technically
correct but incomplete remediation.

### Pain-point register

The register separates a **straight repair** (ticketable without a new product
decision) from a **design/program item** (requires a cross-subsystem ruling or
sequencing). Ticket paths are the current live owner; LLP 0295 owns only the
cross-cutting plan and success measures.

#### P13. Fixed-origin and supervised dev attachment are not one paved path — convergent

Pinned benchmark ports forced agents outside `snapback dev --expo`; they then
reconstructed startup artifacts, attach semantics, binding delivery, and
sessions-compatible regeneration by reading package source and refusal text.
Some paths restarted and reseeded on every schema milestone. Existing ticket:
`issues/20260818-guide-gap-fixed-origin-dev-attach-recipe.md`. The higher-level
question—one lifecycle for supervised and externally hosted clients—routes to
LLP 0295 W1 and LLP 0223/0261.

#### P14. Password auth is first-party but excluded by the Vite relay — convergent

Coterie lanes independently found that `@expo/snapback-vite`'s `__snapback`
relay omitted `/auth/password/*` and `/auth/recovery/*`. They added pre-Vite
middleware or split auth and live-data origins, then paid additional handshake,
CORS, and stream-continuity debugging. Straight repair:
`issues/20260820-vite-password-auth-relay-allowlist.md`.

#### P15. Auth custody scope is correct but undiscoverable — convergent

The default Expo template's volatile custody silently failed Clique's reload
requirement; multiple headless clients in one process shared a principal until
given distinct `storagePartition`s; retained-query/auth stores were mistaken
for one database file; and repair text sometimes named only SQLite while
keyring siblings preserved the deployment pin. Existing tickets:
`issues/20260818-guide-gap-node-client-storage-partition-default.md` and
`issues/20260818-guide-gap-custody-store-repair-text-not-one-file.md`. This
cluster consumed both correctness work (silent persona drift) and wall (serial
re-authentication/reseed).

#### P16. Authority transitions still have silent or misleading client states — repeated

Three distinct cases appeared: an `optional-user` live query blanked at sign-in
and never resubscribed while reporting ready/empty/disconnected; an
authenticated query started while signed out could hang without issuing HTTP;
and background receipt/outbox writes during an auth barrier serialized
foreground sends. Straight defects:
`issues/20260820-optional-user-live-query-auth-transition-stall.md` and
`issues/20260820-authenticated-query-signed-out-settlement.md`. The background
authoring recipe is already ticketed at
`issues/20260818-guide-gap-background-writes-during-auth-transitions.md`; the
composition ruling belongs to LLP 0295 W2 and LLP 0059/0107/0218.

#### P17. Published Expo packages contain a Metro initialization cycle — single-run, blocking

The Familiar Opus lane died before first render because
`@expo/snapback-expo` -> app-client -> index re-exported
`DEFAULT_AUTH_STORAGE_PARTITION` through a temporal-dead-zone cycle under
Metro CJS interop. Importing the client package first was a load-order
workaround. Resolved 2026-08-21: the default moved to a no-import leaf and a
packed external Expo/Metro fixture now reaches first render without that
workaround
(`issues/closed/20260820-expo-metro-default-storage-partition-cycle.md`).

#### P18. Familiar's first-generation and result-contract phases disagree — repeated within one lane

`v.doc` functions required a schema-only bootstrap before normal generation,
and a mutation `v.doc` result could pass generation then fail at runtime.
Agents repeatedly regenerated schema first and preserved/reseeded stores around
the mismatch. Straight parity ticket:
`issues/20260820-familiar-vdoc-generation-runtime-parity.md`.

#### P19. Familiar feels like TypeScript until its closed dialect appears — convergent

Agents reached quickly for `query`/`mutation`, `v`, `ctx.db`, and `api.*`, then
learned by refusal that dynamic computed access, captured constants, helper
imports, result forms, clock-dependent visibility, and some sequence surfaces
are restricted. The refusals were usually good; the consolidated pre-authoring
map was not on the Familiar first-read path. Straight guide repair:
`issues/20260820-guide-gap-familiar-handler-dialect.md`. Whether to broaden the
dialect is a design question routed to LLP 0237/0252/0253 and LLP 0295 W3.

#### P20. Storage and type contracts expose mismatched boundaries — repeated

The run found an independent 32 KiB aggregate structured-value ceiling after
child validators passed, an error that said "expected string, actual string"
instead of naming `maxBytes`, optional persisted values returned as `null`
while generated types suggested absence, and an AssetRef retype diagnostic
that printed "AssetRef to AssetRef" without the differing intent identity.
Straight diagnostic ticket:
`issues/20260820-structured-value-ceiling-diagnostic.md`; the nullability and
typed-structured-value model remain design-owned by LLP 0211 and the AssetRef
identity issue is ticketed at
`issues/20260820-schema-asset-ref-retype-diagnostic.md`.

#### P21. Private membership authority needs a first-class product roster pattern — convergent

Private roster rows correctly prevent accidental disclosure, but chat apps
also need display names, join times, send-time recipient sets, and aggregate
receipt membership. Builders independently maintained ordinary projection
tables beside the authority relation and learned bootstrap/app-column rules by
refusal. Straight teaching ticket:
`issues/20260820-guide-gap-membership-roster-projection-recipe.md`. Whether
projection maintenance should be generated, transactionally coupled, or
remain app-authored is LLP 0240/0278 and LLP 0295 W4 work.

#### P22. Presence APIs are strong but their lifecycle vocabulary causes write amplification — convergent

Builders accidentally published for the lifetime of a nonempty draft, renewed
leases every 400 ms, or modeled typing as durable expiring rows. The resulting
write queues missed observation ceilings and in one case competed with
foreground work. Existing ticket:
`issues/20260818-guide-gap-presence-heartbeat-vs-bound-value.md`. A supported
activity-presence recipe exists; retrieval and profile parity are the missing
links.

#### P23. Asset hooks and intent requirements have small but recurring sharp edges — repeated

`useSnapbackAssetUrl` throws on an empty ID while its sibling image hook accepts
null; mixed image/video intents require both location policies although examples
usually show one; several lanes discovered hook or generated-reference paths by
source inspection. Straight hook contract ticket:
`issues/20260820-asset-url-hook-nullability.md`; broader asset ergonomics remain
with LLP 0210 and the media program.

#### P24. Provider connection lifecycle and budgets are under-taught — repeated

Coterie adapters opened excess connections, issued nested queries from live
callbacks, or rebuilt streams during auth establishment. The stable designs
shared managers, subscribed after authority settled, deduplicated
transport-only publications, and bounded fan-out; these rules came from
failure traces rather than the provider guide. Straight guide ticket:
`issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`. The
cross-client provider architecture remains LLP 0278/0280/0293 W5 work.

#### P25. Exact/Contract integration still adds generator and route-lifecycle tax — repeated

Current lanes reproduced or added Exact-side issues: result alias collisions,
multiline object types embedded in quoted metadata, controlled-input event
gaps, scroll/flex sizing, route-link detachment, and whole-tree republishing on
transport-only changes. These are not Snapback repository tickets. LLP 0279
remains the Exact program owner; `issues/20260818-exact-spa-link-detachment-under-choreography.md`
is the local cross-repo pointer for the one matrix red.

#### P26. The benchmark instrument creates avoidable correction loops — convergent

All lanes rediscovered profile navigation, Edit-first heading order, retained
route DOM, quote-control nesting, and selector breadth. Media, semantic receipt,
avatar, and membership checks remain structurally unobservable. Repeated
best-of-three browser runs can poison one shared page and turn one route failure
into several unrelated timeouts. LLP 0281 owns these repairs; the existing
`issues/20260809-per-milestone-token-metering.md` is still open.

### Where wall clock and tokens went

The run meters lane totals but not tokens by milestone or correction episode,
so the following is an evidence-bound attribution, not a causal allocation.

1. **M1/setup dominated clean lanes.** Sol Clique Explicit spent 2,408 seconds
   to M1 green, then 369 on M2 and 607 on M3. The recurrent M1 work was not
   profiles: package/skill reading, scaffold correction, runtime qualification,
   startup-carrier construction, fixed-origin binding, password/custody setup,
   and first replay/acceptance harness construction.
2. **Correction-loop count tracked output tokens better than profile name.**
   Clique Familiar reported more loops/turns than Clique Explicit; Coterie
   Familiar reported fewer than Coterie Explicit. The token direction matched
   in all six same-model pairs. This supports investing in loop removal rather
   than syntax terseness alone.
3. **Source inspection was the expensive fallback.** Lanes inspected Vite
   allowlists, Expo provider/environment modules, app-client custody,
   generated bindings, Exact provider runtime, and route interception when the
   guide or diagnostic stopped short. A good refusal collapsed a loop; a silent
   lifecycle state or packaging seam created a bisection session.
4. **Restart/reseed cycles multiplied every schema correction.** Leaving the
   supervised loop made sessions identity exactness expensive: regenerate,
   rebuild startup artifacts, restart, restore or reset, replay personas, then
   rerun suite and choreography. Correctness is not the problem; lack of one
   supported fixed-origin successor loop is.
5. **Browser reruns amplified local defects.** Shared-page poisoning, fixed
   10-second waits under load, Fast Refresh during assertions, and
   action/remount races caused repeated full choreography segments. The one
   Coterie red consumed many attempts after its feature suite was already
   22/22 green.
6. **Reactive write/read amplification was a hidden application tax.** Eager
   receipt effects, unconditional watermark patches, per-keystroke durable
   writes, per-conversation message scans, and rendering asset hooks on every
   card degraded the client until unrelated operations timed out. Generated
   N+1 advice helped at authoring time; runtime query/mutation/paint phase
   attribution did not yet make these loops direct.
7. **The reporting protocol itself is nonzero but not dominant.** The twelve
   retained run-log/diary/essay/final-report sets total roughly 61,000 words,
   while harness output totaled about 2.88 million tokens. Consolidating
   repeated narrative facts would help, but the larger win is reducing the
   hundreds of agent turns and correction loops that produced them.

The next run needs boundary snapshots for tokens, semantic-action counts, and
failure-to-recovery traces per LLP 0186/0201. Without those, a precise statement
such as "P14 cost 12% of tokens" would be invented.

## Learnings worth institutionalizing

1. **Freeze the contract before the second implementation.** Every Coterie
   slice that froze a declaration (with milestone-scoped claims) before an
   adapter grew was cheap to verify; the one seam that drifted
   (`setAvatar` vocabulary across concurrent lanes) was caught precisely
   because the shared declaration made divergence loud.
2. **Adversarial dual review is where product semantics come from.** Field
   limits, the video ceiling, receipt monotonicity, the incarnation
   bounded-read catch, the split-brain pagination, and both projection-alias
   bugs all came from review rounds, not build passes. The cost was
   repaid every round.
3. **Simplification after a ruling can strengthen a claim.** The 1,024
   envelope ruling deleted an entire consistency mechanism and made the live
   proof stronger. When a bound is real, designing *inside* it honestly beats
   engineering around it.
4. **Refusal-first partial claims scale.** Milestone refusals, claims-gated
   affordances, and skipped-by-claim acceptance let a partial adapter stay
   green without overclaiming — the pattern that let three backends coexist
   against one declaration all program long.
5. **Instrument defects steer API design if left unfixed.** The typing
   observation boundary made seven platform mitigation attempts look
   ineffective before the instrument was measured. Fixing the instrument is
   product work (LLP 0281).

## Routing and hand-off

| Cluster | Owner |
| --- | --- |
| Paged live results, semi-join/fan-in composition, list-shaped aggregates, envelope growth | LLP 0278 (new RFC) |
| Exact/Contract generator, envelope, mock, dev-loop program | LLP 0279 (new Plan) + tickets |
| Cross-system write seams (signup, persona replacement, sign-out, attach residue) | LLP 0280 (new RFC); composition surface LLP 0258 |
| Benchmark instrument observability and outcome classification | LLP 0281 (new Plan) under LLP 0201/0266 |
| Ephemeral role narrowing, overlay Error arm, Coterie typing adoption | existing tickets + `issues/20260817-coterie-typing-allow-members-adoption.md` |
| Published 0.1.24 cross-cutting authoring/lifecycle/efficiency program | LLP 0295 (new Plan), with mechanisms retained by their subsystem owners |
| Clique Explicit/Familiar historical register and prior rerun protocol | LLP 0236; superseding matrix evidence is in this amendment and LLP 0295 |
| Media/codec admission facts | LLP 0269 + `issues/20260817-upload-intent-codec-duration-admission-facts.md` |
| Ceremony-reduction classification | LLP 0275 (already Draft; this run's evidence corroborates its derivation rule) |

## Open questions

1. Does the claims-gated affordance pattern (F-D11) deserve first-class
   platform support — a generated capability-claims query for any Snapback
   app — or is it a benchmark-local idiom?
2. After LLP 0278 lands, does the Coterie adapter's remaining machinery
   reduce to translation-only, and does the M6 growth choice (larger engine
   windows versus cursor continuation) become unnecessary for the benchmark
   envelope?
3. Should the second Coterie conformance lane (LLP 0266 OQ3) run before or
   after the Exact improvements in LLP 0279, given how much of the adapter
   tax was Exact-side?
4. **Answered by the 0.1.24 amendment:** the architectural positives survived
   and all twelve lanes completed from public packages; the residual perimeter
   register is P13-P26. Which profile is cheaper remains open and must be
   answered per client stack under LLP 0295's load-isolated, phase-metered
   rerun.
