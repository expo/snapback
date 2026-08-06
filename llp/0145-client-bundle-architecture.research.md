# LLP 0145: Client bundle architecture options

**Type:** Research
**Status:** Draft
**Systems:** Client SDK, Client integration, Packaging, Code generation, Realtime, Auth, Offline sync, React, Developer experience, Testing, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-01
**Revised:** 2026-08-01 (v0.2, round-1 super-refine corrections — both families
NOT READY; reviews in `reviews/0145-client-bundle-architecture.codex.md` and
`reviews/0145-client-bundle-architecture.fable.md`. Substantive changes: the
Signal Desk Supabase row corrected against the version the fixture actually
pins; the hosted sender-constraint mandate (LLP 0077, LLP 0096 §7) recorded as
already decided rather than open; the authority-generation fence and the
invalidation obligation/ACK seam added to the minimal runtime contract; a
conformance-corpus gate, an operational-cost gate, and a whole-application byte
line added to Phase D; the React extraction reclassified from packaging to an
LLP 0114 public-seam amendment and renamed to the real `@expo/snapback-*`
packages; the existing Swift clean-room client recorded as F8; Firestore Lite
added as the closest precedent; Option 10 added; "Parity" removed as a
packaging label.)
**Revised:** 2026-08-01 (v0.4, round-2 super-refine corrections — Fable READY,
Codex NOT READY; round-2 sections appended to both review artifacts.
Substantive changes: `terminalDelete` split out of the blank-and-resnapshot
discharge path, which v0.2 got wrong; the `auth/live` offer/namespace carriers
and explicit unsubscribe added to the minimal contract; gates 11a, 11b, and 12a
added after the LLP 0095 corpus was found to cover neither demand release nor
`auth/sender`; gates 13–14 given pass ceilings instead of measure-only escapes;
the hosted posture marked ratified-but-currently-unavailable per LLP 0096 §2.6;
the "neither is expensive" claim withdrawn as unmeasured; the thin profile
moved off the already-published `/online` subpath; Option 10's amortization
claim bounded by cache partitioning; Phase B's admin decision routed to LLP
0041/0115 rather than to LLP 0122, which makes no decisions.)
**Revised:** 2026-08-01 (v0.6, round-3 super-refine corrections — both families
NOT READY, converging independently on the hosted-availability defect that v0.4
introduced. Substantive changes: the hosted correction rebuilt on both
referents, with LLP 0098's adapter, its Draft/no-capability status, and the
expired serving window recorded; minimal-contract items 10 and 11 scoped to the
declared posture instead of universal, and the `auth/live` WebSocket upgrade
restatement added; the blanket cross-tab nonclaim withdrawn for the sessions
and hosted postures per LLP 0059 and LLP 0077; the unsupported "server rejects
operation-identity mismatches" claim replaced with a named admission mechanism
and gate 11c; actions added to gate 5 and result validators to gate 4; gate 11b
made tuple-specific per LLP 0064; Phase B routed to executing LLP 0115 decision
4's CLI-fold rather than re-deciding it; OQ17 split by fixture home.)
**Revised:** 2026-08-01 (v0.8, round-4 super-refine corrections — both families
NOT READY. Substantive changes: the posture scoping table rebuilt per axis,
adding the `auth/rr`-only request/response row and correcting item 11 to
selected axes rather than a bundle; gate 11c tightened to refuse before any
effect and to cover argument contracts; gate 11d added for cross-context
custody, which §F7 required and the gate list omitted; gate 11b's LLP 0064
receipt demand recorded as unsatisfiable for a profile disclaiming optimism and
retention, with the class-minting problem named; gate 12a required to be driven
by the client under test rather than the existing Node harness, and separated
from target qualification; gate 14 barred from comparing the reduced spike
against full-workout baselines; the "explaining about 98%" causal claim
weakened to corroboration; the Signal Desk row relabelled as an unrecorded
workspace state; admin removed from Options 2 and 6 per LLP 0115 decision 4;
Option 4's build-time-validation claim narrowed; the profile artifact given
capability class, carrier identity, and digests; the LLP 0053 dev-mode drift
surfaced as OQ23.)
**Revised:** 2026-08-01 (v0.9, round-5 super-refine corrections — Fable NOT
READY on one MATERIAL plus residue. Substantive change: item 11's `auth/live`
condition corrected from "auth-scoped live" to *any* live subscription in
sessions mode, because LLP 0096 §2.2 states that authority independence is a
server fact clients cannot branch on and "always offering is the conformant
rule" — the v0.8 rebuild had imported §7's deployment-floor phrasing into the
client contract, where it inverts. Also: the scoping and posture tables
reconditioned to match; the gate count corrected to nine entries after v0.8
added 11d; the hosted row's release cell made inheriting; admin decision
reattributed as 0127 decision 4 recorded in LLP 0115; LLP 0041 cited rather
than orphaned in Related; the LLP 0053 `clear_retained` dev-path projection
added as evidence for OQ23; OQ24 added on whether codegen may branch on
declared `authorityIndependent`.)
**Revised:** 2026-08-01 (v1.0, round-5 super-refine corrections — both families
NOT READY; both judged the loop should close after one frozen consistency pass.
Two genuine mechanism defects, neither a propagation failure: exact-identity
admission is non-atomic with an effectful invocation (a deployment change
between admission and call leaves a TOCTOU window that re-inspection does not
close), so §Minimal runtime contract and gate 11c now require one of three
atomic mechanisms and rollout-interleaving negatives; and gate 12a had
attributed LLP 0077's *specification* requirements to the existing 43-check
instrument, which contains no refresh, logout, or key-loss checks at all, so
the gate now requires extending the matrix rather than reusing it. Also: items
10/11/12 given three distinct predicates with the authority-independent-live
row the collapsed table could not express; `authProfileSet` and `custodyOwner`
added to the profile artifact, with gate 11d rescoped by custody rather than
posture; gate 12's class list completed to all ten item-9 classes; gate 11b's
spike-carrier exception replaced with "unqualified experimental evidence"; the
dev-obligation scope qualified as current-code behavior in both categorical
sites; the browser default corrected to persistence-preferred with reported
memory fallback.)
**Revised:** 2026-08-01 (renumbered from LLP 0143 to LLP 0145 while reconciling
with main, which had independently assigned LLP 0143 to the Expo
push-notification seam; no substantive design change.)
**Revised:** 2026-08-01 (v1.1, round-6 close-out — the loop's final frozen pass;
Fable READY, Codex NOT READY on one blocking gate defect, both families
recommending no further broad review after these corrections. Gate 12a's
extension list, which v1.0 had enumerated as four families, now requires every
remaining LLP 0077 Acceptance class the existing runner does not witness —
reconnect, rotation, expiry, reset/restore, and authorization invalidation
among them — because enumerating four and stopping reproduced the very defect
the gate was written to remove. Also: OQ20 recast around the three atomic
identity mechanisms with admission-alone explicitly excluded; OQ22's
spike-own-carrier exception deleted; gate 12 now requires that nothing publish
*or change durable state* and its LLP 0059 attribution corrected; pre-handler
refusal distinguished from post-commit suppression; the profile artifact's
teaching example moved off the disavowed auth-scoped conditioning; row 4's byte
saving conditioned on OQ24; the fifth artifact field attributed to gate 11d
rather than the corpus; F2's line count pinned to the published 0.1.8 artifact;
OQ14's self-reference repaired after the renumber; an orphan table header,
a misplaced list conjunction, and the Revised ordering fixed.)
**Revised:** 2026-08-01 (v1.2, author adjudication — Charlie Cheever decided
OQ14, OQ22, OQ6, and OQ23 and abstained on the Phase C posture; recorded as
D-A through D-D in a new §Decisions, with the four open questions converted to
pointers, gate 13 carrying D-B's relative bar, and a companion dated amendment
landed in LLP 0053 for D-A. Status stays Draft: the super-refine loop closed
without dual-READY, so promotion remains the author's call.)
**Revised:** 2026-08-01 (successor link — Draft LLP 0147 now owns the proposed
Full/Micro profile contract and ahead-of-time compiled client boundary under
D-D; this Research remains the evidence and option-analysis base.)
**Revised:** 2026-08-02 (Phase A's landed instrument gained versioned,
prospective supplemental ledgers when LLP 0143's optional push registry became
the first post-baseline public capability. The original 24-profile baseline
remains immutable; the push ledger freezes against its implementation commit.)
**Revised:** 2026-08-03 (Phase A's instrument gained declared
workload-version rollover ledgers for LLP 0166's intentional evolution of the
existing Full/RQS workload and closures that consume its root surface. Each
rollover SHA-binds and leaves every predecessor receipt byte-identical,
supersedes only an exact profile-id set, and keeps every unaffected historical
ceiling active.)
**Revised:** 2026-08-04 (the final wave rollover records LLP 0091's rowless
token-resume ordering correction across the 15 affected Full/root closures,
binding the finite-carrier receipt as its immutable predecessor and executing
the shared memory, file, Expo, and native Channel B suites before freezing.)
**Related:** LLP 0000, LLP 0005, LLP 0008, LLP 0012, LLP 0041, LLP 0043, LLP 0053,
LLP 0059, LLP 0060, LLP 0063, LLP 0064, LLP 0077, LLP 0090, LLP 0091,
LLP 0092, LLP 0093, LLP 0094, LLP 0095, LLP 0096, LLP 0098, LLP 0107, LLP 0108,
LLP 0112, LLP 0114, LLP 0115, LLP 0122, LLP 0126, LLP 0129, LLP 0130,
LLP 0133, LLP 0137, LLP 0138, LLP 0139,
LLP 0147,
Diary 0050,
https://firebase.google.com/docs/firestore/solutions/firestore-lite,
https://pocketbase.io/docs/how-to-use/,
https://docs.convex.dev/client/javascript/overview,
https://supabase.com/docs/reference/javascript/initializing,
https://firebase.google.com/docs/firestore/query-data/listen,
https://appwrite.io/docs,
https://www.instantdb.com/docs/init,
https://spacetimedb.com/docs/clients/typescript/,
https://zero.rocicorp.dev/docs/introduction,
https://doc.replicache.dev/,
https://github.com/electric-sql/electric

## Summary

Snapback's current browser client is large because one apparently simple import
closes over most of the client platform: online requests, streaming, the React
admission path, authorization invalidation, sender-constrained auth, retained state,
offline replay, the RQS store family, result validation, and substantial
generic manifest interpretation. The current `SnapbackClient` benchmark is
250.9 kB minified / 70.1 kB gzip. In the PocketBase incident-room bakeoff, the
60.9 kB full-application gap and the 59.5 kB isolated-SDK gap agree to within
1.4 kB gzip — two independent measurements corroborating that the SDK closure
dominates the difference. This is principally an architecture and
package-boundary problem, not an application problem or a minifier problem.

Supabase is useful here, but the common premise that its whole client is tiny is
incorrect. The measured full `@supabase/supabase-js` closure is 214.6 kB
minified / 56.3 kB gzip. What *is* tiny is its PostgREST-only data client:
15.8 kB / 5.0 kB gzip. Supabase can offer that slice because it is mostly a
generic HTTP request builder over server-owned semantics. Auth, Realtime, and
Storage are separate libraries; a full Supabase import brings them back.

The most promising Snapback direction is therefore not code golf. It is a
two-profile client architecture:

1. preserve a compatibility **Full client** for offline, retained-state,
   sender-proof, and advanced invalidation semantics; and
2. add a conservative **Online microclient**, assembled from static capability
   modules or generated per application, which delegates authoring intelligence
   to codegen, checks, types, server admission, and structured diagnostics.

The Online profile can remain sound while being intentionally less clever. It
can resnapshot after reconnect or authority change, refuse automatic retry
after an ambiguous mutation, and omit every capability the application did not
select. A 10–25 kB gzip runtime is a plausible research target, not a finding;
only a working spike can establish it.

Two constraints bound that profile before any code is written, and both are
already ratified rather than open. First, a browser client on a hosted
sender-constrained deployment **must** carry the sender lane: LLP 0077 makes
`senderConstraint` required on a hosted target with "no bearer-only fallback,"
and LLP 0096 §7 fixes the hosted floor at `auth/rr` always, `auth/live` for any
client subscribing to auth-scoped live functions, and `auth/sender` for
browser-class clients. A thin profile may omit the sender lane only by
declaring itself local/external-auth-only, not by deferring the question.
Second, an Online client inherits LLP 0059's authority fence in **every**
posture, and — under the sessions and hosted postures — LLP 0053's invalidation
obligations on any auth-scoped live subscription. Those are wire semantics, not
Full-client conveniences, and they sit inside the contract rather than outside
the budget. The posture qualifier on the second half is load-bearing: a
local-dev target claims no auth profile and negotiates no carriers, so **as the
code behaves today** it receives no obligation frames at all. That last
qualifier is not hedging — LLP 0053 as Accepted carves out no mode, so the
dev-mode scope is an unreconciled spec/code drift this research surfaces rather
than settles (OQ23), and it is listed among this document's constraints as
current behavior, not as a ratified guarantee. §Minimal runtime contract's
scoping table is the authority on which items each posture takes; this summary
must not be read as making all of them universal. How much they cost is genuinely unmeasured: the
4.0 kB attributed to sender proof in §F2 is module-own attribution, which
§F2 itself warns is a lower bound rather than a marginal composition cost, and
the shipped hosted facade imports the entire client root today. Treating the
mandatory auth floor as cheap is exactly the kind of unsupported claim this
document should not make — see OQ4.

The recommended sequence is: install repeatable bundle budgets, make the
low-risk package splits, then build one generated Online microclient for the
PocketBase incident-room fixture. Do not first rewrite the current full client,
change the wire protocol, or pursue property mangling. Those approaches have
more semantic risk and less diagnostic value.

## Research question

What client architecture would materially reduce Snapback's browser payload
while preserving the properties that make an agent-authored application sound?
In particular:

- why is the current closure larger than competing clients;
- why can a Supabase data-only client be so small;
- which reductions are packaging improvements versus semantic reductions;
- what could an aggressive thin-client rewrite omit safely;
- where must correctness move if it is removed from the browser runtime; and
- which path gives the best evidence before committing to a migration?

This document researches options. It does not accept a new client contract,
change Online/Parity capability claims, or supersede the existing auth, sync,
RQS, React, or native-client authorities.

## Method and limits

### Bundle benchmark

The comparative measurements were made on 2026-08-01 from the named current
npm package versions. Each fixture imported the provider's ordinary browser
client and exercised enough API to retain its central implementation. esbuild
0.28.1 bundled ESM for browser/ES2022 with minification and tree shaking.
Sizes are minified JavaScript, gzip level 9, and Brotli quality 11.

These are closure measurements, not vendor claims and not a universal ranking.
They vary with import form, feature selection, version, bundler, and whether
React is external. A sync engine and a request builder do not promise the same
behavior. Size is meaningful only beside capability and correctness.

**Reproducibility status, stated honestly.** The fixtures behind the
comparative table were not retained in the repository. The method above is
precise enough that the Snapback rows do reproduce: independent re-measurement
during round-1 review, by two reviewers working separately, reproduced the
headless closure (250.9 / 70.1 / 60.2 kB), every row of the F2 attribution
table, all four F3 counterfactuals, and both F4 search figures to within
0.1 kB. The competitor rows require installing those packages and cannot be
re-derived from this repository at all. Committing the fixture sources, a
single runner, the lock/integrity data, and the metafiles is therefore not
polish — it is Phase A's first deliverable, and until it lands the comparative
table should be read as "independently reconstructed by the author and
reproduced for the Snapback rows," not as a committed receipt.

| Client fixture | Version | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: | ---: |
| PocketBase | 0.27.1 | 37.9 kB | 10.6 kB | 9.5 kB |
| Electric Shapes | 1.5.24 | 56.5 kB | 17.9 kB | 15.8 kB |
| Convex | 1.43.0 | 67.0 kB | 18.6 kB | 16.6 kB |
| SpacetimeDB | 2.7.1 | 90.6 kB | 22.8 kB | 19.9 kB |
| Appwrite | 26.2.0 | 76.3 kB | 24.9 kB | 21.9 kB |
| Replicache | 15.3.0 | 115.0 kB | 35.6 kB | 31.6 kB |
| Firebase Realtime Database | 12.17.0 | 170.5 kB | 47.3 kB | 41.7 kB |
| Firestore Lite | 12.17.0 | not measured — Phase A gap | — | — |
| InstantDB React, React external | 1.0.57 | 158.5 kB | 49.2 kB | 43.6 kB |
| Supabase, full client | 2.111.0 | 214.6 kB | 56.3 kB | 47.7 kB |
| Snapback headless `SnapbackClient` | 0.1.8 | 250.9 kB | 70.1 kB | 60.2 kB |
| Zero | 1.8.0 | 304.1 kB | 95.2 kB | 82.8 kB |
| Firebase Firestore | 12.17.0 | 506.5 kB | 138.1 kB | 119.5 kB |

The table does not show that the smallest product is best. PocketBase is a
small direct SDK and has no durable offline client engine. Zero and Firestore
carry substantial local query/sync machinery. Snapback currently pays for
advanced machinery even when an application intends to use only Online
query/mutation/live behavior.

### Application-level corroboration

Two independent application fixtures show that the SDK result survives a
real bundler. Provider versions are stated because one row moves substantially
with them:

| Fixture | Provider version | Minified | Gzip | Brotli |
| --- | --- | ---: | ---: | ---: |
| Signal Desk Convex adapter, React external | convex 1.43.0, fixture pins 1.42.3 | 79.9 kB | 21.7 kB | 19.3 kB |
| Signal Desk Supabase adapter, React external | supabase-js ≈2.111.0 | 218.8 kB | 57.5 kB | 48.7 kB |
| Signal Desk Supabase adapter, as the fixture pins it | supabase-js 2.57.4 | 127.5 kB | 34.9 kB | 30.4 kB |
| Signal Desk Snapback adapter, React external | workspace `file:` client, unrecorded state | 384.3 kB | 98.5 kB | 81.1 kB |
| PocketBase incident-room complete app | pocketbase 0.27.0 | 231.6 kB | 70.3 kB | 61.0 kB |
| Snapback incident-room complete app | @expo/snapback-client 0.1.8 | 456.2 kB | 131.2 kB | 111.8 kB |

Two adapter rows were measured against a newer provider than the committed
fixture pins, and the rule this table now follows is that the discrepancy gets
stated rather than left for a reader to trip over. The Convex row is the benign
case: the fixture pins convex 1.42.3, which measures 79.0 kB / 21.5 kB gzip
against the 1.43.0 figures shown — a 0.24 kB gzip difference that changes
nothing. The Supabase row is not benign.

The committed fixture pins `@supabase/supabase-js` to **2.57.4** exactly
(`demos/signal-desk/package.json` and `bun.lock`), and at that version the
adapter bundles to 127.5 kB / 34.9 kB gzip. The 218.8 kB figure was taken
against a much newer supabase-js — the version the SDK table above uses — with
the fixture's dependency state changed and unrecorded. Both rows are kept
because both are true of something, but only the 2.57.4 row is reproducible
from this repository today. The correction cuts *against* this document's
thesis: at the version the fixture pins, Supabase's application closure is
22.6 kB gzip smaller than claimed, which makes Snapback's gap wider, not
narrower.

The incident-room rows are unaffected. The two applications — provider-native
implementations of one shared product contract, not line-for-line matched code
— differ by 60.9 kB gzip. Isolating their provider SDKs gives a 59.5 kB gzip
difference, which **corroborates** SDK dominance: the two independent deltas
agree to within 1.4 kB.

That is corroboration, not causal apportionment, and the first draft of this
section overstated it as "explaining about 98%." The arms differ in scaffolding
and dependency sets as well as SDK, and the Snapback arm carries an asset gap
the PocketBase arm does not, so no controlled experiment here isolates the SDK's
contribution to a percentage. Metafile attribution across matched dependency
sets would be needed to make the stronger claim, and Phase A should retain it.

One row's provenance is weaker than the others and is labelled accordingly. The
Signal Desk fixture depends on the client through a workspace `file:` path, not
a pinned registry version, so its bytes cannot be tied to a published artifact
after the fact — the workspace tree at measurement time is not recoverable. The
two incident-room rows do not have this problem: that fixture installs
`@expo/snapback-client` from the registry at a pinned 0.1.8.

Diary 0050 reports the same two bundles as 71.2 kB and 132.8 kB gzip. Those are
the same artifacts at gzip's default level; the figures above are level 9, as
§Bundle benchmark states. The derived gap is stable either way — 60.9 kB here,
61.6 kB there.

### What this research did not measure

- parse, compile, and execution time on representative mobile devices;
- memory retained by each client;
- network bytes after boot or resnapshot frequency;
- Metro/Hermes bytecode output;
- CDN caching across applications;
- the size of a not-yet-built thin Snapback client; or
- the engineering cost of migrating existing applications.

The proposed byte ranges below are hypotheses for choosing spikes. They are not
performance claims.

## Findings

### F1. Supabase is modular-small, not full-client-small

The measured Supabase closure separates as follows:

| Supabase slice | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| PostgREST only | 15.8 kB | 5.0 kB | 4.4 kB |
| Realtime only | 57.3 kB | 16.8 kB | 15.0 kB |
| Auth only | 100.4 kB | 24.1 kB | 20.9 kB |
| Storage only | 27.0 kB | 6.9 kB | 6.2 kB |
| Full `supabase-js` | 214.6 kB | 56.3 kB | 47.7 kB |

The slice list is illustrative, not exhaustive or additive: `supabase-js` also
depends on Functions, which is not measured above, and shared code is counted
once per slice rather than apportioned.

The PostgREST slice is small because it needs little application intelligence.
It builds requests, serializes filters, attaches headers, parses responses, and
returns server errors. PostgreSQL, PostgREST, generated TypeScript database
types, row-level security, and the application developer own most of the
semantic burden. Realtime, auth state, token refresh, and object storage are
independent concerns rather than implicit dependencies of every query.

This is the transferable lesson: keep intelligence in the browser only when it
must act there at runtime. It is not evidence that Snapback can preserve its
entire current client behavior in 5 kB.

**Firestore Lite is the closer precedent and this research missed it.**
Supabase is modular because its capabilities were always separate libraries.
Firebase shipped the split this document is actually proposing: Firestore Lite
is a standalone REST-only profile of the *same* product that deliberately
trades away offline caching, latency compensation, query resumption, and
snapshot listeners for size and startup, and is documented and named as a
distinct import rather than a flag. That is the Full/Online shape, executed by
a vendor with a large installed base, including the naming and dual-maintenance
problems this document has to solve. Convex's separately documented HTTP and
reactive clients are a second instance of the same pattern. Neither was
measured here; Phase A should measure the Firestore Lite row this table now
carries as a placeholder, and it should be read
as a floor for operations-only behavior rather than as evidence about the size
of Snapback's live and auth runtime.

### F2. Snapback's public package boundary does not match its capability boundary

`packages/snapback-client/index.mjs` is approximately 10,800 lines in the
published 0.1.8 artifact every measurement here binds to (10,832 exactly; the
workspace copy moves under concurrent work and is not the referent), and the
ordinary `SnapbackClient` class begins in that root. Its dependency graph
includes the React admission path, query-authorization invalidation, auth
invalidation, sender proof, result-contract validation, RQS, memory and file
stores, and shared outbox support. The `/online` export currently re-exports
the same class and produces the same 250.9 kB / 70.1 kB gzip closure.

Approximate minified-byte attribution in the measured closure was:

| Module or family | Attributed minified bytes |
| --- | ---: |
| Root client implementation | 156.9 kB |
| React admission (`react-binding.mjs`) | 18.8 kB |
| Query authorization | 17.9 kB |
| Auth invalidation | 11.7 kB |
| Result-contract validator | 8.6 kB |
| RQS file store | 7.8 kB |
| RQS core and other stores | 16.5 kB |
| Sender proof | 4.0 kB |
| Canonical values and outbox shared code | 6.7 kB |

Attribution is a bundler graph view, not a statement that each row can be
deleted independently. It establishes that the weight is distributed across
real capability families rather than one accidental dependency.

Two clarifications, because the naive readings of this table are both wrong.

**These are module-own bytes, not module-plus-exclusive-dependencies.** The two
accountings differ, sometimes sharply. Stubbing `react-binding.mjs` removes
30.7 kB minified, not the 18.8 kB attributed to it, because it exclusively
reaches further code that nothing else pulls in. The RQS file store, by
contrast, reconciles exactly: 7.8 kB attributed, 7.8 kB removed. Rows in this
table are a lower bound on what deleting them would save, and §F3's
counterfactuals are the figure to use when reasoning about a split.

**`react-binding.mjs` is not the React binding.** It imports no React at all.
React lives in `@expo/snapback-react`, which is already a separate published
package. What sits in the client root under that filename is *client-side
admission and preparation*: deployment admission, result-contract validation,
auth-scope checks, RQS wiring, and prepared query-group machinery, reached
through the public `SnapbackClient.prepareReactBinding()` seam. The name is
historical and misleading, and correcting it changes the character of the
proposed extraction — see §F3.

### F3. Some immediate savings are real, but only one of the two is low-risk

Counterfactual bundles that stubbed two families produced:

| Counterfactual | Minified | Gzip | Gzip reduction |
| --- | ---: | ---: | ---: |
| Baseline | 250.9 kB | 70.1 kB | — |
| Without React admission | 220.2 kB | 61.4 kB | 8.7 kB |
| Without Node-oriented file store | 243.1 kB | 67.9 kB | 2.2 kB |
| Without both | 212.4 kB | 59.2 kB | 10.9 kB |

The file-store row is what it appears to be: a headless browser import should
not own a Node file store, and moving it is packaging.

The other row is not. As §F2 records, the stubbed module is not a React
binding; it is the client-side admission path behind
`SnapbackClient.prepareReactBinding()`, which LLP 0114 specifies as a public
seam on the client class ("the public seam is one asynchronous admission step:
`await client.prepareReactBinding(...)`"), and which the already-published
`@expo/snapback-react` imports from the client root. The 8.7 kB gzip figure is
therefore an upper bound obtained by *deleting a specified public behavior*,
not a measurement of a safe extraction. Actually taking that saving means
amending LLP 0114's seam — for example moving admission to a free function
owned by the React package — and landing a coordinated change across two
published packages. It is still worth doing, and this document still
recommends it, but it belongs in the semantic-change column rather than the
packaging-hygiene column where §Option 1 originally filed it.

Either way, both changes together leave Snapback near the full Supabase closure
and far above Convex or PocketBase. Export maps and tree shaking alone will not
produce a 10–25 kB client while the same central class owns all semantics.

### F4. Root imports impose a generic-runtime tax

Importing the root client's search parser measured 6.79 kB minified / 3.10 kB
gzip. Importing the search subpath directly measured 3.15 kB / 1.45 kB. The
package does not declare a `sideEffects` policy, and React code often imports
through the root rather than narrow internal or public modules.

The tax is real but bounded, and saying so sharpens the finding rather than
weakening it: tree shaking does work for leaf symbols — a root import of the
search parser pulls 6.8 kB, not the whole 251 kB closure. What the root import
costs is a fixed multiple on small imports, not the entire client. The
architectural problem in §F2 is a separate one: capability code that a
constructed `SnapbackClient` reaches unconditionally cannot be shaken at all,
no matter how narrow the import.

Generated application artifacts also contain more information than a browser
caller needs. In the Signal Desk closure, the functions manifest contributed
about 54.8 kB minified, the generated API 20.3 kB, the capability manifest
5.7 kB, and the schema 5.2 kB. Server handler source or generic reflection
metadata should not cross into an Online browser bundle merely so a call can
name an operation.

### F5. The current bundle check proves compatibility, not economy

The browser-closure test detects Node built-ins. It has no ratcheting raw,
gzip, or Brotli budget, no per-export fixtures, and no attribution report.
Consequently a new capability can become an implicit dependency of the Online
client without a failing gate. LLP 0063's prior bundle work also showed that
aggressive property mangling can make a byte counter pass while breaking live
boot and routed behavior. Measurement must execute the resulting program, not
just weigh it.

### F6. Agentic authoring does not require a large generic browser runtime

An agent needs a small, explicit, mechanically checkable authoring surface. It
does not need the shipped browser to interpret every application manifest or
carry server handler source. Soundness can be distributed across stages:

| Stage | Soundness responsibility |
| --- | --- |
| Schema and function authoring | declarations, server handlers, policy, indexes |
| Code generation | exact operation references, argument/result types, selected capabilities, protocol/version constants |
| Static proof | typecheck, manifest compatibility, capability honesty, browser/native closure tests |
| Server admission | authentication, authorization, schema/function identity, argument validation, transaction semantics |
| Thin runtime | transport, cancellation, structured errors, subscription ordering, authority reset, explicit retry policy |
| Acceptance | positive and negative multi-client behavior against the real server |

This arrangement can be more agent-friendly than generic reflection: an agent
imports an exact generated operation, receives a typed result, and sees a
stable diagnostic code when it violates a contract. The generated wrapper can
be tiny because the build system already proved facts that the runtime no
longer needs to rediscover.

### F7. A thin runtime must become conservative, not unsound

Several current features exist because distributed systems have ambiguous and
hostile transitions. Removing their implementation without narrowing behavior
would be a correctness regression. A legitimate thin Online client instead
uses simpler safe rules:

- on reconnect, request a fresh snapshot rather than retaining and replaying;
- on user, credential, policy, or deployment authority change, blank protected
  state before resnapshotting;
- after an ambiguous mutation outcome, report `unknown` and require an
  idempotency key or caller decision instead of retrying silently;
- never claim durable offline writes, retained reads, cross-tab coordination,
  or optimistic reconciliation unless the corresponding module is selected —
  optimistic lifecycle in particular is a specified surface under LLP 0107, not
  a convenience a thin client can approximate;
- order live deltas against an explicit snapshot/version seam and resnapshot on
  a gap; and
- let the server reject version, capability, and schema mismatches with
  structured diagnostics — but **not** operation identity, which the server
  cannot check, because the wire carries an operation by name only.

The result may perform more network work and offer a less seamless offline
experience. That is an honest product profile, not merely a smaller build.

**Two of these rules are not simplifications, and the first draft of this
research treated them as if they were.** Conservatism is available on the
*policy* axis — how much to discard, how eagerly to resnapshot, what to refuse
to retry. It is not available on the *mechanism* axis, where the wire protocol
and the ratified client contracts already fix what a correct client must do.

- **Blanking is not a substitute for the invalidation obligation.** LLP 0053
  makes a shrinking result a durable, level-triggered obligation precisely
  because losing a removal is a security failure, and the obligation discharges
  only after the client applies a sufficiently current snapshot and
  acknowledges it. LLP 0095 fixes the surrounding mechanics: exact
  scope/revision/witness matching, immediate quarantine, apply-before-ACK,
  terminal-delete fencing, duplicate re-ACK, and refusal to ACK a foreign
  obligation. "Policy changed, therefore resnapshot" describes a reaction to a
  change already detected; it does not deliver or discharge the event. A thin
  client may legitimately over-react on the *snapshot* path — blank everything,
  resnapshot, ACK — but wherever its posture negotiates the lane at all, it
  must still receive and acknowledge, and the seam for
  doing so belongs in the contract rather than being discovered during
  implementation.
- **`terminalDelete` is not on the snapshot path at all, and over-reacting
  cannot discharge it.** A `terminalDelete` resolution "carries no snapshot
  (wire omission and JSON `null` are equivalent)"; LLP 0095 requires the client
  to atomically destroy the exact materialization, install its terminal
  fence/live boundary, enter `TERMINAL_DELETED`, and only then acknowledge the
  exact token — after which ordinary live traffic may not resurrect it and
  recreation demands a fresh, never-reused query identity. There is nothing to
  resnapshot; "blank and resnapshot" applied here would re-establish a
  materialization the server terminally revoked. This is the sharpest case of
  the policy/mechanism distinction, and the v0.2 draft of this section got it
  wrong by saying a thin client may discharge *every* obligation by blanking
  and resnapshotting.
- **`AbortController` is not an authority fence.** LLP 0059 requires every
  request, grant open, socket, subscription, callback, completion, and store
  write to capture an authority generation before it begins and to check it
  after its final await, with success, failure, timeout, and terminal-auth
  paths equally fenced, so that delayed user-A work cannot publish into user-B
  state. Cancellation does not prove that already-scheduled work will not
  complete. Same-context fencing is never optional.
- **Cross-tab custody is a nonclaim only for postures that own no credentials.**
  An earlier revision of this document listed "no cross-tab claim" as a blanket
  Online simplification while simultaneously admitting sessions and
  hosted-browser postures. Those are incompatible. Sessions-mode browser
  custody is governed by LLP 0059's cross-context ownership rules — one shared
  durable record, the Web Locks API as the preferred mutex with a reload of
  durable custody after acquisition ("an in-memory capture alone cannot justify
  a write"), and two-context delayed-race acceptance. Sender-constrained
  custody adds LLP 0077's multi-tab generation and nonce coordination on top.
  Two tabs racing credentials, nonces, or authority transitions is a security
  failure, not a degraded experience. The nonclaim is therefore available to a
  local-dev profile, and to a profile whose credentials are owned entirely by
  an external caller — and to nothing else. Whichever postures the spike
  claims, the custody module's byte cost belongs in its budget.

Getting either wrong produces a client that is smaller and quietly unsound,
which is the one outcome this research exists to avoid.

### F8. The protocol has already been implemented thin, and this research nearly missed it

The strongest available evidence about whether the current wire protocol admits
a small client is not hypothetical. `clients/swift/SnapbackClient/` is the LLP
0093 first-party clean-room proving client: roughly 3,650 core lines across
`SnapbackClient.swift` (1,138), `StateMachine.swift` (1,450),
`WireTypes.swift` (803), `TransportTiming.swift` (141), and `JSONValue.swift`
(117), built from the specification rather than from the JavaScript client,
fixture-passing, and landed with guide coverage.

That is a thin implementation of the unchanged protocol, written by someone who
had to discover exactly which semantics are load-bearing. It bears on this
research three ways. It is a partial answer to the question of whether generic
manifest negotiation dominates — it did not, for Swift. Its module split
(protocol state machine / wire types / transport timing) is close to the
boundary §Option 2 proposes on paper. And its line count is the best available
prior for what the §Minimal runtime contract actually costs before bundling.

It does not settle the browser-byte question: Swift is not JavaScript, the
Swift client makes its own capability claims, and lines are not bytes. But a
research document's job is to assemble the evidence that already exists before
proposing to generate more, and the first draft of this one asserted that the
protocol "has not yet been tested with a thin implementation" while that client
sat in the tree.

## Evaluation criteria

Every option below is judged against these constraints.

1. **Server authority.** A client cannot turn cached or generated facts into
   authorization authority.
2. **Snapshot/delta coherence.** A live query cannot expose deltas against an
   unknown snapshot or silently continue across a version gap.
3. **Auth barrier safety.** Protected state must not leak across user,
   credential, policy, deployment, or revocation transitions.
4. **Outcome honesty.** Mutation retry, offline acceptance, retention, and
   optimism must be claimed only when their semantics exist.
5. **Agent proof.** Generated references, types, compatibility checks,
   structured diagnostics, and negative tests must remain first-class.
6. **Portability.** Browser, Expo/Metro/Hermes, and future native clients need
   explicit, testable closure boundaries.
7. **Compatibility.** Existing full-client applications need a migration path;
   smaller defaults need not mean a flag-day removal.
8. **Measurability.** Raw, gzip, Brotli, parse/startup, and behavior gates must
   be repeatable from a public-package fixture.
9. **Conformance.** A profile that speaks the protocol must pass the LLP 0095
   fixture corpus for the arm and lanes it claims, not a bespoke acceptance
   suite invented alongside it.
10. **Deployability.** A browser profile intended for hosted use must satisfy
    the LLP 0096 §7 hosted floor — `auth/rr` always, `auth/live` for
    auth-scoped live subscriptions, `auth/sender` for browser-class clients —
    or declare in its name and documentation that it is not for hosted use.

## Options

### Option 0 — Keep the monolithic client

**Shape.** Continue to expose one `SnapbackClient` whose ordinary Online path
owns the complete implementation graph. Make only incidental local reductions.

**Pros**

- no compatibility migration or new public capability taxonomy;
- one runtime receives every correctness fix;
- lowest immediate engineering cost; and
- advanced features are always available without another import.

**Cons**

- every small Online application pays for unrelated semantics;
- package boundaries continue to misrepresent capability boundaries;
- regressions remain hard to attribute;
- the public bundle will remain structurally larger than direct SDKs; and
- adding features monotonically expands the default closure.

**Expected size.** Approximately today's 70 kB gzip headless closure, with
small fluctuations. This is a baseline, not a size strategy.

**Assessment.** Retain temporarily as the compatibility surface, but do not use
it as the intended end state.

### Option 1 — Incremental package and tree-shaking repair

**Shape.** Move the client-side React admission path out of
`@expo/snapback-client` and into the existing `@expo/snapback-react` package;
route browser builds away from the file store; declare and test `sideEffects`;
replace root imports with narrow imports; split compact client metadata from
server manifests; and add per-export bundle budgets.

Two corrections to the first draft of this option. The React package is not
hypothetical and is not called `@snapback/react`: `@expo/snapback-react` is
published today, and `@expo/snapback-*` is the ratified terminal scope under
LLP 0130 SD-6. And the move is not free — as §F3 records, admission is a
specified public seam on `SnapbackClient` under LLP 0114, so this item carries
an amendment to that spec and a coordinated two-package landing. The rest of
the option really is packaging hygiene.

**Pros**

- low semantic risk for everything except the React admission move;
- independently reviewable changes with immediate benefit;
- improves all later architectures;
- makes browser, Node, React, and native ownership more honest; and
- creates attribution and regression infrastructure before a rewrite.

**Cons**

- cannot tree-shake branches hidden behind construction of one large class;
- likely saves tens of gzip kilobytes, not an order of magnitude;
- export proliferation can become confusing without a capability model;
- compact manifests require care around artifact identity and diagnostics; and
- the largest single item requires amending an LLP 0114 public seam and landing
  across two published packages, so "incremental" understates it.

**Expected size.** The two measured extractions reach about 59 kB gzip. Narrow
imports and compact metadata should reduce it further, but a sub-25 kB result
is implausible without architectural separation.

**Assessment.** Do now. This is necessary plumbing, not the complete answer.

### Option 2 — Static capability modules around a shared kernel

**Shape.** Replace the all-owning class internally with a small kernel and
explicit modules, for example:

- `core`: endpoint, identity envelope, request, cancellation, diagnostics;
- `operations`: query, mutation, and action calls;
- `live`: snapshot plus ordered delta subscription;
- `sessions`: credential acquisition and refresh;
- `offline`: RQS, retained state, outbox, replay, and conflict handling;
- `sender-proof`: sender-constrained browser auth;
- `ephemeral`: connection-scoped state;
- `react`: framework bindings; and
- ~~`admin`~~: **not a client module.** 0127 decision 4, recorded in LLP 0115,
  folded the admin
  surface into the CLI, command-shaped and outside application graphs, with
  the served path as the external-tooling fallback. It is listed here struck
  through rather than deleted because the current closure still carries admin
  methods on `SnapbackClient`, and the modularization has to model where they
  go — which is out of the app graph entirely, not into a lazily-loaded
  capability module.

The existing `SnapbackClient` becomes a compatibility composition of all
required modules. New applications import or generate only their selection.

**Pros**

- maps code ownership to product capabilities;
- preserves one protocol and shared correctness primitives;
- makes bundle composition statically visible and testable;
- supports browser, Expo, Node, and native variants without runtime probing;
- allows the full client to survive; and
- gives codegen a clean target for per-app selection.

**Cons**

- extracting stateful cross-cutting behavior is a substantial refactor;
- auth barriers, live state, and offline retention interact and may resist
  naive module boundaries;
- many user-selected imports would hurt authoring ergonomics unless codegen or
  a profile wrapper composes them; and
- shared-kernel growth can recreate the monolith under a different name.

**Expected size.** Rough research ranges: 15–35 kB gzip for operations plus
live with external credential supply; 35–60 kB with sessions and richer
invalidation; current-class size for the Full profile. These must be measured.

**Assessment.** Best long-lived architecture, provided the kernel has a strict
budget and capability conformance matrix.

### Option 3 — Conservative handwritten Online client

**Shape.** Implement a second client from a blank file against the current
protocol. Support generated query, mutation, action, and live references;
accept an externally supplied bearer or dev credential; hold only active
in-memory snapshots; and apply the conservative rules in F7. Exclude offline,
retention, optimism, outbox, cross-tab custody, admin, generic manifest
reflection, sender proof, React, and ephemeral state from the initial closure.

That exclusion list is only coherent under the **local-dev or
externally-owned-credential posture**, and this option should be read as
declaring it. Excluding cross-tab custody and sender proof is a nonclaim a
credential-owning profile cannot make, per §F7 — so Option 3 measures the floor
for a client that holds no credentials of its own, not the floor for a sessions
or hosted client.

**Pros**

- fastest way to learn the true minimum runtime;
- avoids carrying historical internal abstractions into the experiment;
- gives ordinary Online applications a PocketBase/Convex-class footprint;
- has a simple behavior model agents can explain and test; and
- can coexist with the full client behind an explicit import/profile.

**Cons**

- duplicates protocol and error-handling code until a shared kernel emerges;
- reconnect/resnapshot can increase latency and server/network load;
- external credential supply is not a complete first-party auth experience;
- a too-thin implementation can miss subtle ordering, abort, and authority
  transitions; and
- success may tempt callers to assume Full-client semantics it does not claim.

**Expected size.** Target 10–25 kB gzip for runtime plus generated application
references. This is deliberately ambitious and unproven.

**Assessment.** The highest-value spike. Treat it as a new honest capability
profile, not a drop-in reimplementation of every current behavior.

### Option 4 — Generated per-application microclient

**Shape.** Codegen emits exact wrappers for the application's selected
operations and lanes. Runtime records use compact operation identifiers and
protocol constants rather than importing the complete schema, capability, and
function manifests. Generated code imports only the static modules it needs.

To be unambiguous, since this document disclaims a wire change: the compact
identifiers are **client-local generated constants**. The emitted requests
still carry the current named-operation routes. LLP 0094 adds no new
expected-operation carrier, and nothing in this option proposes one. If a
numeric on-wire identifier were ever wanted, it would be a separate protocol
and rollout decision with its own evidence, and its byte savings must not be
counted toward this program.

For example, an application with three queries, two mutations, and one live
query receives those six typed functions plus one Online transport instance;
it does not receive a generic function registry, handler source, RQS, React, or
admin code.

**Pros**

- makes the browser closure proportional to used capabilities;
- moves reflection, operation selection, and type derivation to the build where
  agents can inspect failures — but *not* runtime result validation, which
  cannot move to the build because TypeScript does not validate wire bytes; see
  the trust-boundary decision in §Minimal runtime contract;
- preserves exact argument and result types;
- can encode version, operation, retry, and authorization expectations
  mechanically;
- yields a very small and explicit audit surface;
- can hide modular composition behind one generated, ergonomic import; and
- has a precedent in the corpus — LLP 0112's generated query-group bundles
  already move per-application selection into codegen, so this option extends
  an established mechanism rather than inventing one.

**Cons**

- increases coupling among codegen, server deployment identity, and client
  publication;
- stale generated code needs excellent mismatch diagnostics;
- dynamic operation discovery and generic tooling need a separate path;
- compact numeric identifiers complicate debugging unless diagnostics retain
  stable human names; and
- codegen output can duplicate wrappers across chunks or packages if designed
  carelessly.

**Expected size.** Potentially 5–20 kB gzip above application code for a small
Online app, depending on transport and live support. The application-specific
generated portion should normally be hundreds of bytes to a few kilobytes.

**Assessment.** Strongest combination of small runtime and agentic soundness.
Build it on capability modules or the thin-client spike rather than generating
a new runtime per operation.

### Option 5 — Supabase-like generic HTTP protocol client

**Shape.** Introduce a compact PostgREST-like request surface for reads and
writes, plus a separately imported live transport. Keep schema and policy on
the server; use generated types for authoring. Authentication is ordinary HTTP
authorization, with WebSocket connection tickets or a negotiated protocol for
stream establishment.

**Pros**

- proven route to a very small data-only client;
- easy to port across JavaScript, Swift, Kotlin, Rust, and other languages;
- conventional HTTP behavior is observable with standard tools;
- generic request builders tree-shake well; and
- server-owned semantics reduce browser interpretation.

**Cons**

- a generic table/filter API can weaken Snapback's function-first, closed-plan,
  authorization, and portability model;
- live, offline, and mutation semantics still require separate machinery;
- browser streaming auth constraints do not disappear;
- a new transport introduces versioning, caching, error, and conformance work;
- arbitrary query builders are harder to admit and reason about than generated
  named operations; and
- changing auth transport may conflict with LLP 0060 and LLP 0077 and therefore
  requires explicit RFC/ratification rather than a packaging patch.

**Expected size.** A query/mutation-only request builder could plausibly be
5–15 kB gzip, taking the 5.0 kB PostgREST slice as the floor. A complete
Snapback client would again grow as live, auth, retention, and offline modules
are added.

**Assessment.** Valuable as a protocol-design comparison and possible native
interoperability seam. Too invasive as the first bundle-size intervention.
Prefer generated named-operation calls over exposing arbitrary database access.

### Option 6 — Dynamically load advanced capabilities

**Shape.** Ship a small initial Online chunk and use `import()` when an
application first requests sessions, offline state, sender proof, or ephemeral
facilities. Admin is deliberately absent from that list: per 0127 decision 4,
recorded in LLP 0115, it belongs in the CLI, outside application graphs, so lazily
loading it into an app graph would reintroduce exactly the boundary the
decision removed. LLP 0041 remains the lead packaging owner for how that
surface is published.

**Pros**

- improves initial route payload without immediately rewriting every module;
- users who never invoke a capability never download it;
- capability chunks can be cached independently; and
- can complement static modules for route-specific features.

**Cons**

- total downloaded bytes are unchanged once the capability is used;
- first use gains latency and new failure modes;
- lifecycle races around auth and subscriptions become more complicated;
- Metro, native packaging, SSR, and CSP environments need special handling;
- bundler chunking is less deterministic than static package boundaries; and
- performance can look good in a boot benchmark while merely moving cost.

**Expected size.** Potentially 10–30 kB gzip initial, but current-scale total
bytes for applications that activate most features.

**Assessment.** A secondary delivery optimization after static separation, not
the architectural foundation.

### Option 7 — Aggressive minification, property mangling, or code golf

**Shape.** Preserve the architecture and obtain smaller output through custom
minifier settings, shortened diagnostics, property mangling, or hand-compressed
implementation style.

**Pros**

- little public API design;
- can yield quick benchmark movement; and
- may find a few safe private-symbol savings after the architecture settles.

**Cons**

- does not remove parse, initialization, state, or conceptual complexity;
- can break reflection, generated records, diagnostics, and public properties;
- makes stack traces and agent debugging worse;
- savings are fragile across bundlers; and
- LLP 0063 already records a property-mangled candidate that passed the byte
  threshold but failed two of three production behavior checks.

**Expected size.** Ordinary compression showed little leverage in the prior
experiment. Unsafe property mangling can appear larger but is not a valid win
when behavior fails.

**Assessment.** Reject as a primary strategy. Revisit narrowly only behind full
behavioral conformance.

### Option 8 — WASM or native runtime in the web client

**Shape.** Move protocol, state, validation, or sync logic into Rust/WASM or a
native carrier and expose a minimal JavaScript facade.

**Pros**

- could share some implementation with future native clients;
- strong internal types and memory representation; and
- may improve compute-heavy algorithms after startup.

**Cons**

- usually adds loader, glue, and binary bytes for a request/streaming workload;
- initialization and debugging become harder;
- DOM, fetch, WebSocket, credential, and storage integration still needs JS;
- tree shaking at application-capability granularity is worse; and
- Expo, browser, SSR, and native carriers still require distinct packaging.

**Expected size.** Unlikely to beat a focused TypeScript Online client for
initial web payload. No current evidence justifies a target.

**Assessment.** Reject for web bundle reduction. Evaluate native cores on their
own portability and performance merits under LLP 0064/0093.

### Option 9 — Server-served tailored client module

**Shape.** At deployment, Snapback emits or serves a client module containing
only that deployment's operations, client-local compact identifiers as in
§Option 4 rather than any new wire representation, and selected feature
adapters.

**Pros**

- exact tailoring without publishing every generated application package;
- deployment and client identities can be bound directly;
- excellent potential cache reuse for a stable deployment; and
- can give prototypes a one-URL setup experience.

**Cons**

- build tools need offline access to types and declarations;
- CDN caching, integrity, CSP, provenance, and rollback become product
  responsibilities;
- a runtime deployment cannot safely be the sole source of compile-time types;
- client/server rollout skew needs careful dual-version support; and
- self-hosted and air-gapped flows become more complex.

**Expected size.** Similar runtime potential to Option 4; distribution changes
more than semantics.

**Assessment.** Consider later as a delivery form for generated microclients,
not as the first architecture.

### Option 10 — Shared immutable runtime chunk plus per-application entry

**Shape.** The composition of Options 4 and 9 that neither states on its own:
publish the Online runtime as one immutable, content-addressed, version-pinned
chunk that many applications import unchanged, and give each application only
its small generated entry. The runtime is cached once per version **within a
cache partition, at an identical immutable URL**; the per-app bytes are the
generated wrappers alone. The reach of that reuse is the whole question — see
the first con, which is why this option is recorded rather than recommended.

**Pros**

- the marginal cost for the *second* application can approach zero where the
  cache is genuinely shared;
- content addressing makes the runtime's identity, integrity, and rollback
  explicit rather than implicit in a bundler's chunking;
- a version-pinned immutable artifact is easy to audit and easy to gate; and
- it composes with, rather than replaces, capability modules and codegen.

**Cons**

- **cache partitioning has largely eliminated the shared-CDN benefit that made
  this pattern attractive.** Browsers key the HTTP cache by top-level site, so
  a runtime fetched by application A is generally not reused by application B
  on a different site, however identical the URL. The realistic win is confined
  to applications sharing a cache partition. This con is load-bearing enough
  that it bounds the Shape above rather than merely qualifying it;
- an extra network origin or chunk boundary costs a round trip on first load;
- self-hosted, air-gapped, CSP-restricted, and Metro/native packaging paths all
  need a bundled fallback, which means maintaining both forms; and
- integrity, provenance, and rollback become product responsibilities, exactly
  as in §Option 9.

**Expected size.** Same runtime as §Option 4; the change is amortization within
a cache partition, not compression. Unmeasured — "CDN caching across
applications" is in the not-measured list above, and cache partitioning means
the cross-application benefit must be demonstrated rather than assumed.

**Assessment.** Record it so the option space is complete; do not pursue it
until a static profile exists to amortize and until someone measures whether
cache partitioning has already taken the benefit away.

## Comparative matrix

The byte ranges are research targets, not measured outcomes. “Agent proof” asks
whether the option can keep authoring explicit and mechanically checkable.

| Option | Initial gzip hypothesis | Semantic risk | Implementation cost | Existing compatibility | Agent proof | Verdict |
| --- | ---: | --- | --- | --- | --- | --- |
| 0. Monolith | ~70 kB | Low now / accumulates | Low | Excellent | Good | Compatibility only |
| 1. Packaging repair | ~45–60 kB | Low, except the LLP 0114 seam | Low–medium | Excellent | Good | Do now |
| 2. Capability modules | ~15–60 kB thin profiles; current-class for Full | Medium | High | Good via wrapper | Excellent | Preferred foundation |
| 3. Thin Online rewrite | 10–25 kB | Medium–high | Medium | Additive profile | Good | Best spike |
| 4. Generated microclient | 5–20 kB | Medium | Medium–high | Additive profile | Excellent | Preferred paved road if proven |
| 5. Generic HTTP protocol | 5–15 kB data-only | High | Very high | Weak without adapter | Good | Research, not first move |
| 6. Dynamic loading | 10–30 kB initial | Medium | Medium | Good | Good | Secondary optimization |
| 7. Mangling/code golf | Unreliable | High | Low–medium | Fragile | Poor | Reject |
| 8. WASM/native web core | Unknown, likely larger | High | High | Weak | Medium | Reject for this goal |
| 9. Server-served module | 5–20 kB | Medium–high | High | Additive | Good | Later distribution option |
| 10. Shared runtime chunk | Same as 4, amortized | Medium | Medium | Additive | Good | Record; unmeasured |

## Proposed architecture

The evidence favors combining Options 1–4 rather than selecting only one.

A naming caution first, because the first draft of this research got it wrong.
**"Online" and "Parity" are capability classes, not package profiles.** LLP
0012 defines a Parity client as one that adds *local handler execution*,
deterministic replay with a captured environment, offline queueing, and
rebase-on-reconnect; LLP 0043 restates the rule as "no local execution means no
local-first/parity claim." Retained state, RQS, and a durable outbox therefore
sit inside the **Online** class today — they are not Parity facilities, and
calling them that would silently inflate a shipped claim. This document
proposes two *packaging* profiles, and they need names that cannot be confused
with the capability classes. "Full" and "Online" collide with that vocabulary;
something like `full` and `micro` does not. The names below are provisional and
the successor RFC should settle them.

### Full profile

The Full profile preserves the current correctness-rich feature set and is the
compatibility target. It may include retained state, RQS, durable outbox,
offline replay, sender proof, and rich invalidation. Its bundle budget should
still be explicit, but minimum size is not its only goal.

### Online profile

The Online profile is a separate semantic promise:

- generated named queries, mutations, and actions;
- optional generated live subscriptions;
- active in-memory state only;
- external token/provider seam initially, sessions as a separate module;
- full resnapshot on reconnect, gap, or authority transition;
- no automatic retry of an ambiguous non-idempotent mutation;
- no offline, retained, optimistic, or admin claim, and no cross-tab claim
  **only in the local-dev and externally-owned-credential postures** — see §F7,
  because sessions and hosted-browser custody are governed by LLP 0059 and
  LLP 0077 and cannot disclaim it;
- structured server diagnostics, and exact build/operation identity by the
  mechanism named below rather than by assertion; and
- a browser and Expo closure with no environment-inappropriate modules.

**The profile splits three ways on authentication, and the split is not
optional.** A single "Online profile" cannot describe all three, because the
corpus already decided what each requires:

| Auth posture | Required lanes | Status |
| --- | --- | --- |
| Local dev identity | none beyond the dev seam | what Diary 0050's arm actually exercised |
| Sessions, local target | `auth/rr`; `auth/live` if it subscribes to any live function | shipped sessions-mode refusals, LLP 0096 §2.1–§2.2 |
| Hosted browser | `auth/rr`, `auth/live` if it subscribes to any live function, **and** `auth/sender` | ratified floor, LLP 0096 §7 and LLP 0077 — but see below |

Sender proof therefore cannot be a Full-only facility. LLP 0077 makes
`senderConstraint` required on a hosted target and states there is "no
bearer-only fallback"; LLP 0060 grants no hosted bearer-v1 waiver. A thin
browser profile that omits the sender lane is by construction ineligible for
hosted deployment, and must say so in its name and documentation rather than
leaving a reader to discover it at deploy time. Whether that is cheap is
unmeasured; see OQ4.

**The hosted row is ratified, and "hosted" has two referents that must not be
run together.** An earlier revision of this section collapsed them and drew a
false conclusion, so the distinction is worth stating precisely.

- **The Cloudflare product arm has no sessions or negotiated auth-profile
  surface.** It does support dev mode — the distinction matters because the
  arm is not authless, it is sessionless. LLP 0096 §2.6
  records `auth/rr`, `auth/live`, `auth/replay`, and `auth/lease` as "not
  negotiable" there and `auth/sender` as "not applicable"; the arm's capability
  manifest declares `supportedAuthModes: ["dev"]`, and no `/auth/*` route is
  registered. Every auth profile is "local-arm-only today," and the hosted arm's
  profile surface is a named gap subordinate to LLP 0060's program.
- **§7's "hosted production" does not mean the Cloudflare arm.** §2.6 closes by
  saying so explicitly: it means "the Rust server operated as a hosted
  deployment (LLP 0060's posture)." On that referent `auth/sender` is served
  under the hosted admission posture, and LLP 0077's acceptance matrix has been
  run for real against a served origin — 43/43 against
  `https://snapback-drill.fly.dev` with sessions staged under hosted admission,
  the run that surfaced and fixed the D-2 bound-key re-exchange defect.
- **That target is specified, not improvised.** LLP 0098 defines the
  `loopback-terminated-single-instance.v1` hosted-edge adapter, records
  sessions staged under hosted admission, and carries the served-origin matrix
  receipt. It is a governing document for any hosted-posture work here and this
  research omitted it until round 3.

So a hosted-posture claim is expensive rather than impossible: it requires
standing up a served-origin target the way that drill did, which is exactly
what gate 12a asks for. Three caveats keep that from being an invitation. LLP
0098 is **Draft** and states "No capability is claimed by this document," so
nothing there ratifies a `hostedAuthCapable` claim. The drill's serving window
has expired, so the receipt is evidence that the target *can* exist, not that
one is running. And LLP 0060's Status says "There is no hosted auth deployment
in this implementation," with a future hosted target required to prove every
conjunctive edge fact it lists.

The consequence for this research is unchanged in substance and sharper in
form: the first spike should declare the local or sessions posture, and the
hosted mandate must still shape the design now, because a thin client
architected around an external bearer seam will not gracefully grow a
sender-constrained custody path later. Design for the floor; do not let "we are
not claiming hosted yet" become "hosted is unconsidered," and do not let it
become "hosted is unreachable" either.

React hooks should bind to the generated Online client from `@expo/snapback-react`.
An application should not hand-compose ten modules; codegen should emit one
small typed entry point whose imports make the selected capabilities static.
That entry point should be accompanied by a generated **profile artifact**
joining the selected operations, the modules they pull in, the arm and lane
tuple, the auth posture, the carrier, and the explicit nonclaims — so that an
authoring agent can be told mechanically, at generation or typecheck time, that
any live subscription in sessions mode requires `auth/live` — the
always-offer rule of item 11, not the auth-scoped conditioning — or that a
hosted target
requires the sender lane, rather than discovering it from a runtime refusal.

Five fields the first sketch omitted — four of which the corpus already
requires of anything making a carrier or profile claim, and the fifth of which
this document's own gate 11d does: the **capability class** being
claimed (which, per §Proposed architecture, is not the same axis as the
packaging profile); the **immutable carrier and OS identity** for each claimed
carrier; **source and artifact digests** binding the artifact to what was
actually built; the exact **`authProfileSet`** — profile identifiers with their
must-understand versions, because LLP 0096's machine claim is
`arm × lane × profile-set` and "sessions posture" cannot distinguish `auth/rr`
alone from `auth/rr + auth/live`, nor pin a sender version, nor record that
replay and lease were declined; and the **`custodyOwner`** — `none`, `caller`,
`client-first-party`, or `sender-client` — because auth posture does not
determine custody. Both a caller-custodied and a first-party-custodied client
operate against sessions mode, and the shipped external-session constructor is
explicitly non-custodial and mutually exclusive with the coordinator path. The artifact should itself be versioned and bound by digest into each
receipt — otherwise the instrument meant to enforce capability honesty is not
itself evidence, and nothing stops it drifting from the build it describes. It
should be a graduation deliverable, not a design aspiration.

### Minimal runtime contract

A credible first microclient still needs:

1. endpoint and deployment identity;
2. credential callback and authority-change notification;
3. request encoding, cancellation, timeout, and structured error decoding;
4. exact operation identifier plus argument/result type wrappers;
5. explicit idempotency/retry classification;
6. live snapshot/version/delta ordering and gap detection;
7. abort-and-blank behavior on authority changes;
8. version/capability mismatch diagnostics;
9. **a monotone authority generation** captured by every request, grant open,
   subscription, socket callback, reconnect, error path, and store write, and
   compared immediately before any publication — LLP 0059's final-await fence,
   without which delayed user-A work can repopulate blanked user-B state; and
10. **an invalidation obligation seam** that receives LLP 0053 obligation
    frames, applies the transition, and acknowledges only after applying, with
    LLP 0095's scope/revision/witness matching, duplicate re-ACK tolerance, and
    refusal to acknowledge a foreign obligation. It must handle **two
    resolution paths, not one**: a snapshot resolution, which a thin client may
    discharge by blanking and resnapshotting before acknowledging; and
    `terminalDelete`, which carries no snapshot and requires destructive
    retirement plus a terminal fence before acknowledging, with no-resurrection
    thereafter and a fresh never-reused query identity for any recreation. A
    thin client may over-react on the first path; it may not collapse the
    second into it, and it may not discharge either by ignoring it;
11. **the carrier grammar for every axis the profile actually selects.** The
    axes are independent, and this item is not one bundle:
    - `auth/rr` is mandatory on **every** AppData request in sessions mode —
      its `x-snapback-auth-client-protocol` header is per-request, not
      per-subscription, and a profile that speaks sessions at all owes it even
      if it never subscribes to anything;
    - `auth/live` is owed whenever the profile makes **any** live subscription
      in sessions mode — not only auth-scoped ones — and then in full:
      open-time offer, per-subscribe and per-unsubscribe headers, and the
      `authorizationNamespace` allocation and retention lifecycle. The
      conditioning here must not be "auth-scoped," which is the phrasing LLP
      0096 §7 uses for the *deployment floor*, where the server decides whom to
      refuse. In the *client* contract the rule inverts: "authority
      independence is a compiled server fact not projected to protocol clients,
      so clients cannot safely branch on it; always offering is the conformant
      rule," and the server "may omit the requirement only for a target it
      proves authority-independent." A client cannot know at open time that
      none of its future subscriptions is auth-scoped, and LLP 0053 defines
      undeclared functions as auth-scoped anyway. A v0.8 draft of this bullet
      got this backwards;
    - the **selected** axis tokens are restated on the WebSocket upgrade — the
      restatement is a distinct carrier stage rather than a redundant repeat of
      the open body, and omitting it is the easy mistake, but restating tokens
      for axes the profile never offered is the opposite error; and
    - `auth/replay` and `auth/lease` remain optional and an Online profile
      should decline them explicitly.

    A sessions client that issues requests but no live subscriptions therefore
    takes `auth/rr` and nothing else — a legitimate tuple the first draft of
    this table had no row for; and
12. **explicit unsubscribe on normal shutdown and backgrounding.** LLP 0095
    makes release a conformance obligation rather than etiquette, and requires
    the release to present the subscription's establishing live owner. A client
    that simply drops the socket is relying on the crash backstop — the local
    arm's idle-TTL reap — as its normal release path, which LLP 0095 does not
    permit even though it bounds the leak.

**Items 9 through 12 are mechanism rather than policy, but items 10 and 11 are
conditional on the declared posture and operation set — not universal.** An
earlier revision of this list said all four were non-optional for every
credible microclient, which contradicts this document's own local-dev posture
and overstates the local-dev byte floor. LLP 0096 is explicit that in dev mode
all four axes report available with null minima, and that a dev-mode-only
target "claims no profile; the axes are open there without negotiation." The
correct scoping:

The three items have three *different* predicates, and collapsing them — as a
v0.9 draft of this table did — charges obligation machinery where no obligation
exists and release machinery to a client that never subscribes:

- **item 11 (`auth/live` carrier)**: any live subscription in sessions mode,
  because the client cannot branch on authority independence;
- **item 10 (obligation seam)**: auth-scoped live only — LLP 0053 excludes
  explicitly `authorityIndependent` subscriptions from obligation backing, and
  the server, which *can* tell, is what decides whether frames arrive;
- **item 12 (release)**: iff the selected operation set subscribes at all.

The carrier is offered defensively; the obligations are delivered selectively.
Both statements are true at once, and the asymmetry is the point.

| Posture / operation set | 9 (fence) | 12 (release) | 10 (obligations) | 11 (carriers) |
| --- | --- | --- | --- | --- |
| Local dev, request/response only | required | n/a — no subscriptions | not applicable | none |
| Local dev, with live | required | required | not applicable — no profile is negotiated | none |
| Sessions, request/response only | required | n/a — no subscriptions | not applicable | `auth/rr` only |
| Sessions, live, all targets authority-independent | required | required | not applicable | `auth/rr` + `auth/live` |
| Sessions, live, any auth-scoped target | required | required | required | `auth/rr` + `auth/live` |
| Hosted browser | required | as its sessions row | as its sessions row | that row, plus `auth/sender` |

The hosted row inherits whichever sessions row matches its operation set; it is
not automatically the live row. Note the fourth row, which is the one the
collapsed table could not express: a sessions client whose live targets are all
declared `authorityIndependent` still offers the `auth/live` carrier — it
cannot know it is safe not to — but receives no obligations, so item 10's
machinery can be absent from its closure. That last step is conditional on
OQ24: omitting the machinery means trusting declared `authorityIndependent`
facts at build time, which is the same knowledge class OQ24 leaves open for the
carrier, and a target whose declaration changes under a stale generated client
would deliver frames to a client with no seam — which lands in OQ12's
unanswered never-ACK question. The row states a real byte saving; it does not
state a settled one.

**One caveat on the local-dev row, which this research cannot settle.** The row
says local dev receives no obligation frames, and that is what the code does —
obligation admission is gated to sessions mode. But LLP 0053 is Accepted and
defines every subscription except an explicitly `authorityIndependent` one as
auth-scoped and obligation-backed, without carving dev mode out; LLP 0096
removes *negotiation* in dev mode, which is not the same as removing the
semantic obligation. So the table records current behavior over a plausible
reading of a ratified document, and that drift is real rather than resolved
here. One piece of evidence a reconciler will want, and which leans toward the
shipped behavior being intended rather than accidental: LLP 0053 elsewhere
describes the `clear_retained` boolean as "a versioned compatibility projection
for dev/authority-independent paths, never a session-mode security carrier,"
which shows the Accepted text did anticipate dev paths receiving a projection
instead of the security machinery. Until someone reconciles them, a thin
profile should treat dev-mode authorized-live behavior as a nonclaim rather
than as a byte saving it has earned. Flagged as OQ23.

**An externally supplied bearer takes the sessions row.** This document uses
"sessions" in two senses that must not be confused here: the first-party
credential *acquisition module*, which the Online profile defers, and the
server's *sessions mode*, which is what selects the carrier obligations. A
client handed a bearer by its caller has deferred the module but is still
operating in sessions mode, so its auth-scoped live subscribes take items 10
and 11 in full. What it gains from external ownership is the custody nonclaim,
not a lane exemption. Getting this backwards fails closed — the server refuses
the subscribe rather than silently degrading — but it would be discovered at
integration time rather than at design time, which is the wrong end of the
program.

What a thin client does not get to choose is whether to implement the items its
posture selects — only how simply. The lease machinery of LLP 0053 *is*
genuinely omissible, but only because an Online client requests no leases,
which is a claim the profile must state rather than an accident of not
implementing them.

**Exact build and operation identity needs a named mechanism, and "the server
rejects mismatches" is not one.** Generated references already carry `appId`, a
stable id, an implementation hash, and contract hashes — but invocation reduces
them to `ref.name`, and the server route dispatches by path name. LLP 0094 and
LLP 0108 deliberately add no expected-operation wire carrier, and this document
does not propose one. So a stale generated client can invoke a same-named
operation whose implementation or result contract has changed, and no wire
check will catch it. What actually supplies exactness today is *client-side
whole-artifact admission* — the same admission path §F2 describes. A thin
profile that drops admission to save bytes drops the only mechanism enforcing
the identity it claims.

**But admission alone cannot deliver the property, and an earlier draft of this
paragraph implied it could.** Admission is a separate inspection request
followed by a client-side comparison; every later invocation sends only the
operation name. A deployment can change in between. So a client that admitted
successfully can still invoke a same-named successor operation and commit an
effect — and re-inspecting before each call does not fix it, because
inspection and invocation remain two requests with a window between them. This
is a time-of-check/time-of-use gap, not an implementation detail, and it is the
reason "check once at startup" is not a design.

Closing it requires one of three mechanisms, and the successor RFC must pick
one: an expected deployment/operation tuple carried on and checked atomically
with **every** invocation (which is a wire change, and therefore out of this
document's scope to propose); a server-minted admission token or lease
presented before each effect; or immutable deployment pinning, so that the
admitted deployment is by construction the invoked deployment. Until one
exists, no client — thin or full — can honestly claim exact operation identity
at the effect boundary, and §Phase D's gate 11c cannot be satisfied by
admission alone.

One decision the minimal contract must make explicitly rather than by silence:
**runtime result validation.** LLP 0114 requires egress validation before typed
publication, and the current React path validates authoritative and retained
rows. TypeScript cannot validate wire bytes at runtime, so removing the 8.6 kB
generic validator is a decision about where the trust boundary sits, not a
build-time optimization. Either generate operation-specific validators, or
accept server-side egress validation as the boundary and reconcile that with
LLP 0114 — but say which.

Everything else must justify inclusion with a browser-runtime requirement. In
particular, server handler source, full schemas, generic admin discovery, build
validation already performed by codegen, and unselected storage engines do not
belong in this closure. Server handler source is not a hypothetical: the
generated function manifest in the Signal Desk fixture embeds complete
`async (ctx, args) => {…}` handler bodies under `__snapbackHandlers`, and that
file contributes 54.8 kB minified to the measured browser bundle.

## Recommended evidence program

### Phase A — establish a size ratchet

This phase does not start from nothing, and should not pretend to. LLP 0063
§Workstream 8 already owns performance and packaging budgets, already states
that "Snapback clients should tree-shake by operation and capability," and
already fixes a ratified threshold discipline: a committed, CI-diffable
per-cell cost-attribution manifest rather than ad-hoc re-measurement, with
method and definitions frozen at step 0, numbers frozen at the first
attribution run before any optimization, never loosened, tightening only. LLP
0137 item 7 separately mandates measured footprint budgets before choosing an
optimization and records that **LLP 0122 owns the packaging analysis**.

So Phase A's real work is to state its relationship to those authorities and
then satisfy them. The measurements in this document are exactly the ad-hoc
re-measurement Workstream 8 declines to accept as an acceptance instrument;
they are adequate to diagnose and to choose a spike, and inadequate to ratchet
anything. Phase A should either extend the Workstream 8 manifest with client
bundle cells under its existing freezing rules, or say why a separate
instrument is warranted — and either way route the packaging conclusions
through LLP 0122.

Then add repeatable esbuild fixtures for each public subpath and report
minified, gzip, and Brotli bytes plus an attribution metafile. Commit the
fixture sources, the runner, the lock and integrity data, the compression
settings, and the metafiles, so the comparative table in this document becomes
a receipt rather than a report. Test at least:

- core operation call;
- operation plus live query;
- sessions;
- the Full profile;
- React with React external;
- browser and Expo/Metro closure; and
- one complete external-package application.

Every byte receipt must run behavioral acceptance. A bundle that is smaller but
cannot boot, authenticate, stream, route, or invalidate is failing.

#### 2026-08-02 implementation amendment — prospective additive ledgers

The landed Phase A instrument now admits new public capability profiles without
rewriting a valid historical baseline. Each additive capability owns a
versioned supplemental ledger with an exact profile-id set, source/profile
digests, behavior commands, and governing LLP anchors. Existing ledgers are
validated independently, so a later capability cannot rewrite or invalidate an
earlier capability's first-run ceiling.

LLP 0143's push registry is the first use. Commit `91a0a718` removes its
accidental root closure and adds an explicit `./push-registry` subpath. The
original `baseline.v1.json` is byte-identical; all 24 primary profiles remain
at or below their frozen ceilings. `baseline.push-registry.v1.json` then freezes
three prospective profiles against that exact commit:

| Profile | Frozen minified / gzip / Brotli bytes |
| --- | ---: |
| public push-registry subpath | 275,768 / 77,720 / 65,918 |
| explicit attachment fixture | 275,789 / 77,643 / 65,868 |
| root-negative fixture | 368,067 / 101,807 / 85,025 |

The positive profiles must retain `push-registry.mjs`; every primary profile
and the root-negative fixture must exclude it. The ledger also executes the
registry custody/security suite, including successor-bearer fencing. This is a
Phase A instrument extension and a low-risk D6 boundary repair, not evidence
for Micro, Phase C, a new carrier, or a notification-delivery capability.

#### 2026-08-03 implementation amendment — workload-version rollover ledgers

An additive ledger is insufficient when a ratified specification deliberately
changes a workload that the primary receipt already measures. LLP 0063 permits
a declared prospective rollover per workload version, but its valid-baseline
rule still forbids editing or increasing the historical ceiling. The Phase A
runner therefore admits a separate rollover receipt only when all of these
conditions hold:

- the declaration names the new workload version, governing LLP anchors, and
  the exact current profile-id set;
- every superseded profile names its predecessor ledger, and the new receipt
  SHA-256-binds that complete predecessor file;
- the predecessor remains byte-identical and independently provenance-valid;
  profiles outside the exact supersession set continue to use it;
- before first-run freezing, all unaffected historical ceilings pass and the
  profiles without active ceilings exactly equal the declared rollover set;
  and
- the new receipt freezes the first run against an already-committed source
  revision and retains behavior commands for the evolved semantics.

This is prospective workload versioning, not retroactive baseline loosening:
historical numbers remain inspectable facts, and a profile can have only one
active ceiling. LLP 0166's local persistent store is the first use because its
accepted one-store-domain design intentionally evolves the shipped Full/RQS
closure and root-consuming supplemental fixtures while adding three public
store subpaths. Its measured receipt and attribution are recorded under LLP
0166 D9 after the implementation and this instrument amendment are committed.

#### 2026-08-05 amendment — source-bound input provenance

Each immutable ledger's profile and lockfile digests describe the inputs at
the reachable Git commit that first carried that ledger. Validation therefore
reopens those exact Git blobs and verifies the retained digests there, while
the ledger's separately recorded source revision continues to bind its
measured package trees. It does not require the current checkout's
whole-workspace lockfile to remain byte-identical to every historical receipt.
A new package outside the measured client closures may legitimately add a
workspace row without rewriting the old receipt.

The current checkout is still measured with its current lockfile, and every
profile still compares against exactly one active frozen ceiling. Changes to a
measured dependency or package closure therefore remain visible in the output,
attribution, behavior train, and ceiling comparison. This corrects input
provenance without loosening a ceiling or permitting a historical ledger to
change.

#### 2026-08-04 rowless token-resume ordering rollover

LLP 0091's valid rowless rung-1/rung-2 resume can deliver its durable
`CurrentAsOf`, replay, or replacement frame before the HTTP subscribe
acknowledgement installs the new subscription id. The bounded attempt buffer,
overflow-to-fresh-snapshot rule, and repaired retainability classification
intentionally evolve the 15 Full/root closures already frozen by the
finite-carrier rollover. `baseline.rowless-rqs-resume.v1.json` supersedes
exactly those profiles, SHA-256-binds the finite-carrier predecessor, and runs
all four shared Channel B resume arms in addition to the package/browser/React
behavior checks. The predecessor and the unaffected materialization-store
ceiling remain immutable.

### Phase B — take the low-risk savings

Extract file-backed stores, admin, and other environment-specific code; remove
root barrel imports; add a correct `sideEffects` policy; and generate a compact
client operation table distinct from server manifests. Preserve the current
class and measure each change independently.

Two items are not low-risk and should be sequenced accordingly. Moving the
React admission path into `@expo/snapback-react` requires an LLP 0114 amendment
to the `client.prepareReactBinding()` seam and a coordinated two-package
landing; it is the largest single saving in §F3 and the least mechanical. And
admin packaging is not this document's to decide, and — as of round 3 — is not
open either. LLP 0122 supplied the option analysis (separate package, fold into
the client, fold into the CLI, or endorse the served path) but is explicitly
"research input… evidence consolidation and option analysis, no decisions."
**0127 decision 4, recorded in LLP 0115 on 2026-07-30, settled it: the admin surface folds
into the CLI, with the served path as the external-tooling fallback.** Two
earlier drafts of this section got this wrong in opposite directions — first
assuming extraction, then asking who would decide. Phase B's actual job is
execution, and it should name the two distinct surfaces that migrate: the admin
methods embedded on `SnapbackClient` in the client root, and the separate
privileged `@expo/snapback-admin-client` package. Only the first is a bundle
question; conflating them would misattribute both the byte saving and the work.

### Phase C — build the thin-client spike

Reimplement the PocketBase incident-room Snapback arm against a new generated
Online entry point. The spike should support only:

- authenticated query, mutation, and action;
- one authorized live collection;
- multi-client delivery;
- logout/user-switch blanking;
- forced reconnect and full resnapshot;
- a deliberately ambiguous mutation outcome; and
- structured version/capability mismatch.

Do not include assets, offline writes, retained reads, ephemeral state, admin,
or generic manifest discovery in the first byte result. Those become separate
module experiments.

Two scope statements the first draft left implicit and a reader would
reasonably get wrong.

**The spike must declare its auth posture up front**, because the incident-room
arm it reimplements does not exercise sessions at all: Diary 0050 records that
the first-party React provider would not accept a dev `userId`, so that arm
dropped to a raw `SnapbackClient` with `userId` on every operation. "Passes
authenticated query, cross-user isolation, and logout blanking" against that
fixture therefore proves nothing about sessions, `auth/rr`, `auth/live`, or
sender proof. Pick one of the three postures in §Online profile, say which, and
do not let a local-dev byte floor be reported as a browser Online profile.

**The spike is a strict subset of the incident-room arm.** That arm exercises
file upload and delivery, presence, and scheduled work, none of which the spike
includes. Its byte result is therefore not comparable to the 70.3 versus
131.2 kB whole-application figures that motivated this research, and should
never be quoted beside them without that qualification. Note also what the arm
does *not* establish: it never exercised first-party sessions auth at all — its
client is constructed directly and passes a dev `userId` on each operation — so
sessions is a capability the spike would have to add, not one it inherits.

### Phase D — graduation gates

The spike is worth productizing only if it:

1. is at most 20 kB gzip for the runtime and at most 25 kB including the small
   generated incident-room entry point;
2. contains no server handler source, full function manifest, React admission
   path, Node file store, RQS, outbox, or admin implementation;
3. passes browser and Expo closure tests;
4. passes generated-reference typechecking with no result casts — **and**
   either ships generated operation-specific result validators with
   malformed-response negatives, or carries an accepted LLP 0114 amendment
   moving the trust boundary to server egress validation. Typechecking does not
   validate wire bytes; a client can pass gate 4 as originally written while
   publishing malformed authoritative bytes under a precise generated type.
   **Either branch requires an executable malformed-result negative on every
   claimed operation path** — an accepted prose amendment proves nothing about
   behavior, and server egress validation is running code that can be shown to
   reject, not a citation;
5. passes positive multi-client acceptance for **every operation kind the
   profile claims — query, mutation, live, and action.** Actions are not a
   variant of mutations: they take a distinct route, and LLP 0133 fixes the
   action tier as nondeterministic and never auto-replayed. A profile claiming
   actions must show authorization behavior, result handling, and an
   indeterminate-outcome case that is reported rather than retried. A profile
   not gating actions must remove them from its claimed surface;
6. passes negative authorization and cross-user state-leak tests;
7. blanks and resnapshots on user, credential, policy, deployment, reconnect,
   and version-gap transitions;
8. never silently retries an ambiguous non-idempotent mutation;
9. reports stable structured diagnostics; and
10. leaves the existing Full client and its conformance suite green.

Gates 1–10 are necessary and, as the first draft of this document had them, not
sufficient: a spike could satisfy every one of them while leaking server
demand, silently serving stale data, accepting a superseded frame, mishandling
grant loss, republishing user-A data into a user-B session after a delayed
await, resnapshotting so aggressively that the operational cost is
unacceptable, or moving the whole-application payload barely at all. That is
§F5's failure — a byte counter green while behavior is broken — reproduced in
the program meant to prevent it. Four more gate families — nine entries, 11
through 14 with 11a, 11b, 11c, 11d, and 12a — close it:

11. **Conformance, not bespoke acceptance.** The spike declares an explicit
    arm × lane × auth tuple and passes every routed fixture in the committed
    LLP 0095 corpus (`schemas/live.wire-fixtures.v1.json`, formatVersion 3)
    for that tuple, including its seeded negative fixtures. If the Online
    profile needs a narrower conformance class, that class is minted in LLP
    0095 rather than invented in the spike's own test file. Behavior both
    profiles claim is owned by shared fixtures, not by two hand-written
    suites — otherwise the "two clients can drift" risk below has no mechanism
    behind it.

    **But the corpus does not cover everything this program needs, and
    delegating to it is not sufficient.** Its own coverage statement shows two
    gaps that matter here. There is no successful unsubscribe, release, or
    demand-teardown fixture, even though LLP 0095 makes explicit unsubscribe a
    conformance obligation "not etiquette" and requires release to present the
    establishing live owner — so a client can pass every routed fixture while
    leaking server demand on every normal shutdown. And `auth/sender` is
    "deliberately deferred per LLP 0096 §5," so the corpus cannot witness the
    lane the hosted posture mandates. Gate 11a closes the first and gate 12a
    the second;
    neither should be discovered after the spike is built.

11a. **Demand release.** Subscribe → dispose/unsubscribe → server-side
    resource-release fixtures, asserting the release presents the
    subscription's establishing live owner and that arming is recomputed on
    unsubscribe — LLP 0095's demand model recomputes on subscribe, unsubscribe,
    socket close, and connection purge with no linger window, and treats
    idle-TTL reaping as the crash backstop only, not as the release path. If
    these become corpus fixtures rather than spike-local tests, so much the
    better — the gap is the corpus's as much as the spike's.

11b. **Carrier evidence, independently per claimed carrier and OS.** A browser
    and Expo *closure* test proves a module graph, not behavior. LLP 0095
    preserves LLP 0064's rule that "evidence is per operating system; an iOS
    receipt never establishes Android behavior or the reverse" — and a browser
    claim establishes neither. So this gate is tuple-specific, not a bundle: a
    browser-only claim needs a real-browser receipt and nothing more; an iOS
    claim needs its own; Android likewise. Claim fewer carriers rather than
    producing thinner receipts.

    **What a receipt must contain is an open problem, not a citation.** LLP
    0064's seven-fact receipt is specifically the bar for an Expo tuple
    claiming the `Online` capability class, and two of its facts — optimistic
    pending-then-settled, and offline retention across reconnect — are
    behaviors this profile explicitly disclaims. A thin profile therefore
    cannot satisfy that receipt, and demanding it (as the v0.6 draft of this
    gate did) makes the gate unsatisfiable rather than strict. LLP 0064 also
    defines no browser receipt at all. So before any Expo claim, a narrower
    capability class and its receipt facts must be minted or amended into LLP
    0064; and a browser receipt's facts must be defined for the first time.
    Until a class and its facts are ratified, **this gate is not satisfiable at
    all**, and the honest consequence is that the spike produces *unqualified
    experimental evidence* rather than a carrier claim. Running in a browser
    does not define what a browser receipt must prove; a v0.8 draft of this
    gate said the gate remained satisfiable for the carrier the spike runs in,
    which is not a pass criterion but the absence of one. No browser or Expo
    carrier claim may be made until the class lands. See OQ22.

11c. **Deployment and operation identity, fail-closed before any effect.**
    Negative cases that must refuse **before invocation** — not merely before
    publication, because a mutation or action that reached handler execution has
    already committed or produced its effect, and suppressing the response
    afterwards is not a refusal: a client generated against a different app; a
    stale bundle; a mismatched operation id or kind; a same-named operation
    whose implementation hash changed; a changed **argument** contract; and a
    changed result contract. Read and live paths must additionally not publish.

    **Admission alone cannot satisfy this gate**, for the
    time-of-check/time-of-use reason given in §Minimal runtime contract: a
    deployment can change between admission and invocation, and re-inspecting
    before each call leaves the same window. Satisfying it requires the atomic
    mechanism selected there — a per-invocation tuple, a server-minted
    admission lease, or immutable deployment pinning — and the gate must
    include rollout-interleaving negatives that change the deployment
    *between* admission and an effectful call. A spike that cannot name its
    mechanism should withdraw the exactness claim rather than claim this gate.

11d. **Cross-context custody, scoped by `custodyOwner` rather than posture.**
    Auth posture does not determine this gate — a caller-custodied client and a
    first-party-custodied client both speak sessions mode, and only the second
    owns anything to race. The gate applies where the profile artifact's
    `custodyOwner` is `client-first-party` or `sender-client`; it does not
    apply at `none` or `caller`. Where it applies, two
    real contexts must share one durable custody record, coordinate ownership
    through the Web Locks path or fenced compare-and-set, reload durable
    custody after acquiring ownership, and survive a delayed cross-context
    race without the loser publishing under the predecessor identity. A
    profile whose credentials are owned entirely by its caller keeps the
    nonclaim and skips this gate. Gate 12 fences one context against itself;
    this gate is the other half, and §F7 states the requirement while the
    v0.6 gate list omitted it.
12. **Authority fencing under delay.** Deterministic tests that schedule a
    user-A completion of each class — success, failure, timeout, abort,
    terminal auth error, socket callback, reconnect, **grant open,
    subscription establishment, and client-store write** — to land *after* a
    transition to user B, and assert nothing publishes **or changes durable
    state** — LLP 0059 requires stale work neither to expose nor to commit, so a
    silent durable write is as much a failure as a visible one. The class list must
    enumerate **every** completion and publication class item 9 names — a v0.8
    draft of this gate listed seven of ten, omitting exactly the three that
    LLP 0059's fence enumeration and two-context acceptance require. (The
    acceptance names grant open and client-store write explicitly; subscription
    fencing comes from the fence enumeration rather than that list.) This gate is
    same-context; gate 11d is the cross-context half, and neither substitutes
    for the other. Passing gate 7 with an `AbortController` and failing this
    one is the expected failure mode.
12a. **The mandated auth lane, driven by the client under test, on an extended
    matrix.** A spike declaring the hosted-browser posture must pass LLP 0077's
    served-origin acceptance matrix. The LLP 0095 corpus cannot witness this,
    so gate 11 does not cover it. A spike that will not run this matrix
    declares the local or sessions posture instead.

    **The existing instrument does not cover what this gate needs, and an
    earlier draft claimed it did.** The shipped runner fixes its count at 43
    checks spanning issuance, request proof, nonces and replay, grants,
    refusals, and the WebSocket path. It contains no refresh, logout, or
    key-loss checks at all — while LLP 0077's Acceptance section separately
    requires that refresh preserve the bound key, that key loss have no bearer
    fallback, that v1 migration be deletion-only, and that logout, rotation,
    expiry, and reset/restore compose with the generation barriers. Listing
    those behaviors as though the 43-check receipt already witnessed them, as
    a v0.8 draft of this gate did, would let the named instrument stay green
    while refresh rebinds the key, logout fails to retire custody, or key loss
    silently falls back to a bearer.

    So this gate requires *extending* the matrix, not reusing it: named
    client-driven checks for refresh and key-family preservation, logout and
    lost-response retirement, key deletion or loss with no bearer fallback, and
    deletion-only migration — **at minimum, plus every remaining LLP 0077
    Acceptance class the existing runner does not already witness.** That
    residue is not small: 0077 also requires reconnect, rotation, expiry,
    reset/restore, and authorization invalidation to compose with the
    generation barriers, and 0077 itself records served expiry/restore,
    key-recovery, the two-process replay race, the reopen-after-logout check,
    and the end-to-end v1 migration flow as unimplemented. Enumerating four
    families and stopping — as a v1.0 draft of this gate did — would let an
    implementer add those four and claim the gate while other mandatory
    transitions stay unwitnessed, which is the same defect this gate was
    written to remove, one layer down. Check identifiers and the
    microclient's artifact digest bind into the receipt. Making the
    microclient drive the existing 43 does not add any of the missing ones.

    Two things this gate must not be read as permitting. The existing matrix
    instrument is a standalone Node harness that generates its own key, signs
    its own proofs, and keeps its own nonce cell — so running it unchanged
    proves the *server*, not the client. The gate is satisfied only when the
    proposed microclient itself drives the custody and proof paths, which
    means extending the instrument rather than reusing it. And a green matrix
    does not qualify the target: LLP 0060's hosted readiness is a larger
    conjunctive bar, and LLP 0098 is Draft claiming no capability, so target
    qualification is a separate condition that this gate does not supply.
13. **Operational cost, with a ceiling, not just a measurement.** Pre-registered
    thresholds for reconnect network bytes, reconnect latency, request count
    after an authority transition, and parse/compile/startup time on a
    representative mobile device. §Risks already says these must be measured;
    measuring without a threshold does not gate anything — and the v0.2 draft
    of this gate undercut itself by permitting measure-only treatment, which
    turns a gate back into a report.

    **The pre-registered bar (D-B) is relative, not absolute.** No thin Snapback
    client has been measured, so an absolute number today would be a guess. The
    bar is therefore: the thin client's reconnect bytes, reconnect latency, and
    startup must not be **worse than the current Full client on the same
    workload**. That can fail, which is what makes it a gate, and it tests
    §Risks' own thesis directly. Absolute numbers freeze at the first
    attribution run under LLP 0063 Workstream 8's rule — frozen before any
    optimization, never loosened, tightening only.
14. **The whole application, with a ceiling — against a capability-matched
    baseline.** Phase C's spike deliberately omits file upload and delivery,
    presence, and scheduled work, and §Phase C says plainly that its bytes are
    not comparable to the 70.3 and 131.2 kB figures. This gate must not then
    place them side by side, which is what the v0.6 draft did: the program
    would pass by measuring a smaller application against a full-product
    baseline. Either rebuild both arms' baselines at the spike's capability
    set and compare those, or restore the full workout before invoking the
    original figures. Then set separate pass ceilings for: the headless
    runtime, the generated entry, the runtime composed with React and the
    declared posture's auth lanes, initial-route bytes, and total downloaded
    bytes including any lazily loaded chunks. A 20 kB headless runtime that
    needs a 40 kB React and auth composition to render the page has not moved
    the number this research exists to move, and reporting the composition
    without a ceiling on it would let exactly that pass.

If it misses the byte target, the attribution report should determine whether
transport, diagnostics, generated artifacts, live semantics, or shared package
structure is responsible before any protocol redesign is proposed.

## Migration and compatibility

This research does not support replacing the current package in place. A safe
rollout would be additive:

- keep `SnapbackClient` or a `/full` profile with current semantics;
- introduce the thin profile under a **new** subpath — `/micro` or similar —
  rather than at `/online`. This is a correction to the first draft, which
  proposed "introduce `/online`" as though the subpath were unclaimed. It is
  not: `./online` is already in the published export map and today re-exports
  the full-semantics `SnapbackClient`, as §F2 records. Narrowing it in place
  would silently remove behavior from existing importers, which is a breaking
  change wearing an additive rollout's clothing. Either take a new name, or
  specify an explicit major-version migration for `/online` with its own
  deprecation window;
- generate imports against an explicit client profile and capability set;
- make unsupported calls fail at generation/typecheck time where possible;
- issue runtime `SNAPBACK_CAPABILITY_UNAVAILABLE` only for genuinely dynamic
  cases;
- record the profile and capability selection in build/run evidence; and
- publish a semantic comparison, not merely a migration codemod.

One ownership fact this document must not obscure: today's browser default —
a persistence-preferred client cache with a reported memory fallback — the
resolver uses IndexedDB only where both IndexedDB and Web Locks exist —
via the shipped `rqsStore` seam, which is why the RQS
default/file/memory stores sit in the current root closure — is Phase 0 of LLP
0129, an Accepted plan, on the JS/React browser arm it names as the graduation
path. Changing the generated default away from that is an amendment to LLP
0129, not a rollout knob this research can turn. §Status's disclaimer covers
the two-profile contract; this covers the default.

Only after real applications establish that Online covers the dominant paved
road should it become the default generated profile. Offline and local-first
users must continue to receive the heavier machinery they selected.

## Risks and counterweights

### More resnapshots can move cost to the server

A 15 kB client that resnapshots aggressively may increase bandwidth, server
CPU, latency, and mobile battery use. The spike must measure reconnect network
bytes and time beside bundle bytes. Later, a small resumable-live module can be
added if the operational trade is poor.

### Two clients can drift semantically

Shared protocol fixtures, diagnostic schemas, and a cross-profile conformance
matrix should own behavior that both profiles claim. The thin profile should
not copy advanced state machines merely to increase shared claims.

### Codegen can become opaque

Generated entry points should remain readable, deterministic, diffable, and
small. A receipt should explain which capability caused each runtime import.
Human operation names survive in diagnostics because they also remain on the
wire; the compact identifiers of §Option 4 are client-local constants only.

### The smallest client may not be the best default everywhere

Offline-first and high-latency applications can benefit from paying more bytes
once to reduce ongoing network and interaction cost. Bundle budgets must remain
profile-specific. The goal is to stop charging every application for those
features, not to declare them undesirable.

## Questions the corpus already answers

Three items the first draft carried as open are not open. Recording them here
rather than deleting them, because a reader who remembers the earlier framing
needs to see them resolved rather than vanished.

- **Which parts of sender-constrained browser auth are mandatory for hosted
  deployments?** All of the issuance and proof lane, for browser-class clients
  on sender-constrained deployments. LLP 0096 §7 ratified the hosted floor on
  2026-07-25; LLP 0077 states there is no bearer-only fallback; LLP 0060 grants
  no hosted waiver. The remaining question is not *whether* but *how small* —
  see OQ4 below.
- **Which auth barrier primitives must be shared verbatim between profiles?**
  The authority generation and final-await fence (LLP 0059) and the
  invalidation obligation receipt/apply/ACK seam (LLP 0053, LLP 0095) are
  mechanism and must be shared verbatim wherever the declared posture selects
  them — the fence in every posture, the obligation seam wherever obligations
  are delivered. **Where that is** is not fully settled: today's code delivers
  them only in sessions mode, while LLP 0053 as Accepted carves out no mode.
  That scope question belongs in the open list (OQ23), not here, and this
  bullet answers only which primitives are shared, not in which modes they
  arrive. What Online may simplify is the *policy* — how
  much to discard and how eagerly to resnapshot. See §F7.
- **Has the current wire protocol been tested with a thin implementation?**
  Yes, in Swift. See §F8. What remains open is the JavaScript byte question,
  not the protocol-tractability question.

## Decisions (Charlie Cheever, 2026-08-01)

Four of the questions below were adjudicated after the super-refine loop
closed. They are recorded here rather than deleted from the open list, so a
reader can see what was decided and on what basis.

**D-A — OQ23, dev-mode invalidation obligations: amend LLP 0053.** The Accepted
text defines every non-`authorityIndependent` subscription as obligation-backed
and carves out no mode, while the shipped server gates obligation delivery to
sessions mode. The code is right and the text is over-broad: in dev mode the
client asserts its own identity, so there is no authority to revoke and the
obligation is semantically vacuous — a caller who names its own user can name a
different one. LLP 0053's own description of `clear_retained` as "a versioned
compatibility projection for dev/authority-independent paths" shows the
Accepted text already anticipated dev paths receiving a projection rather than
the security machinery. Resolution: a dated amendment to LLP 0053 carving out
dev mode, landed alongside this decision. Charlie recorded no strong opinion
and accepted the recommendation provisionally ("for now"), so this is
explicitly revisitable; the premise to re-test if it is revisited is whether
any deployment gives dev mode a genuine authorization boundary.

**D-B — OQ6, gate 13 thresholds: one relative bar now, absolutes frozen at the
first run.** Pre-registering absolute reconnect and startup numbers today would
be guessing, since no thin Snapback client has been measured; pure measure-only
does not gate anything. Gate 13 therefore pre-registers a single relative
threshold — the thin client's reconnect bytes, reconnect latency, and startup
must not be **worse than the current Full client on the same workload** — and
freezes absolute numbers at the first attribution run, following LLP 0063
Workstream 8's rule that numbers freeze at the first run before any
optimization, never loosen, and tighten only. The relative bar can fail, which
is what makes it a gate, and it tests this document's own stated risk that
conservative resnapshot moves cost to the network.

**D-C — OQ22, capability class: claim no carrier for the first spike.** Gate
11b is unsatisfiable today — LLP 0064's seven-fact receipt is the Expo `Online`
bar and includes optimistic settlement and offline retention that this profile
disclaims, and LLP 0064 defines no browser receipt at all. Rather than mint a
class for a client that does not exist yet, the first spike produces explicitly
**unqualified experimental evidence** and claims no carrier. A narrower class
and its receipt facts are minted into LLP 0064 (still Draft, so the amendment
stays cheap) *after* the spike demonstrates what the profile actually does.

**D-D — OQ14, graduation ownership: a new RFC for the profile contract; LLP
0041 keeps packaging.** LLP 0122 is excluded by its own text ("research
input… no decisions"); LLP 0115 CV-1 owns execution, not contract. The
two-profile question is not only packaging — it carries auth postures, a
conformance class, the OQ20 identity mechanism, and a set of explicit
nonclaims — so it needs its own RFC, with LLP 0041 retaining publication and
packaging mechanics as the lead packaging owner. **This document becomes Active
when that successor lands**, not Superseded: its measurements and option
analysis remain the evidence base.

**Not decided — the Phase C auth posture.** Charlie recorded no opinion. The
orchestrator's working recommendation, which the successor RFC or the spike's
commissioning should confirm or overturn, is: declare **local dev** for the
first measurement, then repeat under **sessions**, so the auth lanes' cost is
learned as a marginal figure rather than conflated into one number. Hosted is
unavailable as a product target regardless (§Online profile). This is not an
author decision and must not be cited as one.

## Open questions

1. What fraction of current demos require Full behavior rather than the
   proposed Online contract?
2. Can the current wire protocol support a 10–25 kB *JavaScript* implementation
   cleanly, given that a ~3,650-line Swift clean-room client covers the same
   protocol, or does generic manifest negotiation dominate even after compact
   generation?
3. Should sessions be a separately selected module or part of the ordinary
   Online profile once the first-party identity experience is complete?
4. How small can the mandatory hosted auth lanes be made? Sender proof is
   4.0 kB minified today; what is the floor for `auth/rr` plus `auth/live` plus
   `auth/sender` in a thin profile, and does that floor change which of the
   three auth postures should be the paved road?
5. Can one ordered snapshot/delta primitive serve durable live queries,
   ephemeral state, and action streams without pulling in their policy code?
6. What is the reconnect bandwidth and latency cost of conservative full
   resnapshot on realistic mobile networks, and what threshold should gate 13
   pre-register?
7. How should generated clients support staged server deployments and rollback
   without importing a generic registry?
8. Does the Online profile retain runtime result validation via generated
   operation-specific validators, or accept server egress validation as the
   trust boundary — and if the latter, what LLP 0114 amendment does that need?
9. Does Metro/Hermes preserve the same static capability boundaries and byte
   wins as esbuild?
10. When should public generic tooling use the Full client instead of generated
    application microclients?
11. What conformance class does LLP 0095 mint for the Online profile, and which
    of its seeded negative fixtures apply verbatim?
12. Does the server tolerate a client that never acknowledges an invalidation
    obligation, or does it escalate to connection termination — and is that
    tolerance written down anywhere?
13. What packaging names replace "Full" and "Online" so they cannot be confused
    with the Online/Parity capability classes?
14. **DECIDED (D-D).** A new RFC owns the two-profile contract; LLP 0041
    retains packaging and publication as lead packaging owner; LLP 0122 is
    excluded by its own no-decisions charter. This document becomes Active when
    that successor lands.
15. Do the benchmark fixtures land in-tree under LLP 0063 Workstream 8's
    freezing rules or as a separate instrument, and who re-runs them at each
    client release?
16. What subpath or package name does the thin profile take, given that
    `/online` is already published with full semantics — a new `/micro`-style
    name, or a major-version migration of `/online` with a deprecation window?
17. The two corpus gaps have different homes. Demand release is arm-shared and
    would benefit every client, including the Swift one, so it belongs in the
    LLP 0095 corpus. `auth/sender` does not: LLP 0096 keeps sender fixtures
    browser-routed because off-browser sender custody is undefined, so moving
    them into the shared corpus would encode browser custody as a native-client
    obligation. Should demand release be landed in the corpus now, ahead of the
    spike that needs it?
18. Admin ownership is settled (0127 decision 4, recorded in LLP 0115,
    CLI-fold; LLP 0041 remains the lead packaging owner). The open
    question is narrower: which embedded `SnapbackClient` admin methods move,
    which stay, and does the privileged `@expo/snapback-admin-client` package
    change at all — and who sequences that against Phase B?
19. Two separable hosted questions, which an earlier draft ran together. Does a
    hosted-posture claim for the thin profile get validated the way LLP 0077's
    matrix already was — by standing up a served-origin LLP 0060-posture target
    at drill cost, against the LLP 0098 adapter — or does it wait on the
    Cloudflare arm's sessions surface, which does not exist at all today? The
    first is available now and expensive; the second is a different program.
    Note that LLP 0098 is Draft and claims no capability, so a hosted claim
    also waits on that ratification.
20. Which of the three atomic mechanisms in §Minimal runtime contract does the
    successor RFC pick — a per-invocation deployment/operation tuple, a
    server-minted admission lease, or immutable deployment pinning — and does
    the thin profile keep whole-artifact admission alongside it? Whole-artifact
    admission *by itself* is not an eligible answer: it cannot close the
    time-of-check/time-of-use window at the effect boundary, which is the whole
    point of that passage.
21. Are actions in the initial profile at all? Gating them properly costs
    acceptance work; dropping them narrows what the paved road covers.
22. **DECIDED (D-C).** The first spike claims no carrier and produces
    unqualified experimental evidence; a narrower capability class and its
    receipt facts are minted into LLP 0064 after the spike shows what the
    profile actually does. Gate 11b stays unsatisfiable until then, by design.
23. **DECIDED (D-A).** Dev-mode obligation scope is resolved in LLP 0053's
    favour of the shipped behavior, by dated amendment landed with this
    revision. Recorded as provisional; the premise to re-test is whether any
    deployment gives dev mode a genuine authorization boundary.
24. May a *generated* client use build-time knowledge of declared
    `authorityIndependent` targets to omit the live carrier for them? LLP 0096
    reserves that omission to targets the **server** proves independent, and
    bars protocol clients from branching on it — but `authorityIndependent` is
    a declared schema fact that codegen can see, so this is a design decision
    to make explicitly rather than a default to assume in either direction. It
    bears directly on the profile artifact's promise to teach lane requirements
    at generation time, and on the live row's byte floor.

## Confidence

| Claim | Confidence | Basis |
| --- | --- | --- |
| Snapback's current closure is materially larger than PocketBase and Convex | High | Snapback rows independently reproduced twice; competitor rows author-run, fixtures not retained |
| The application gap is dominated by the Snapback SDK | High | Isolated and full-app deltas agree within about 1.4 kB gzip — corroboration across two independent measurements, not a controlled apportionment |
| Supabase's data-only smallness comes from modularity and server-owned semantics | High | Measured subpackage closures and public architecture |
| Admission-path and file-store extraction save about 10.9 kB gzip | Medium–high | Counterfactual stubs independently reproduced; the larger half deletes an LLP 0114 public seam rather than relocating it |
| Static capability modules can materially improve default size | Medium–high | Dependency graph plus competitor/module evidence |
| A generated Online client can reach 10–25 kB gzip | Medium–low | Plausible from comparator slices and the Swift clean-room line count; no Snapback spike yet |
| A generic protocol rewrite is necessary | Low | No evidence, and the current protocol already carries a thin clean-room client in Swift (§F8) |
| Minification or WASM is the primary solution | Low | Prior failed mangling evidence and workload shape argue against it |
| The comparative table is a reproducible receipt | Low | The Snapback rows reproduce from the stated method; no fixture, lock, or metafile is committed, and two application rows were measured against a newer provider than the fixture pins — one materially |

## Status

Draft Research. The measurements diagnose the current closure and justify the
low-risk packaging work plus a bounded Online-microclient spike. They do not
authorize a wire-protocol change, a default-profile migration, an LLP 0114 seam
amendment, or a change to LLP 0129 Phase 0's shipped browser default. If the
spike meets the graduation gates, its semantic contract and rollout should be
proposed in a dedicated RFC or Spec and linked back here.
