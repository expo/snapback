# LLP 0075: Convex checkpoint protocol

**Type:** Spec
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Deployment, Control plane, Actions, Streaming, Code generation, React/Expo, Packaging, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-26 (candidate-only instrument correction — runtime metric
projection now rejects unknown sample outcomes and malformed command identity/
authorship; gate evaluation now rejects missing or unknown categories and
malformed run identity. The exact candidate locks were refreshed, but this is
not a protocol amendment or ratification and authorizes no timed run).
2026-07-25 (protocol amendment v0.8 — the drill-target resource
inventory grew by one item, authorized by LLP 0098 author decision D4
(Charlie Cheever, 2026-07-25): persistent Fly volume `vol_r6815pkd59o1x614`,
name `caddy_storage`, 1 GB, encrypted, sjc, mounted at `/data/caddy` for
the TLS terminator's certificate storage only — the database and the
delivered admission chain deliberately remain on the rootfs. Attaching the
volume replaced the v0.7-pinned machine `819701c927ee68` (Fly platform
behavior); the app's single machine is now `849764f2e7dd58`, same app,
region, and size. The Fly-secret
alternative was rejected as a silent key-custody change. Teardown inventory
updated in the drill README.) 2026-07-25 (protocol amendment v0.7 — first provisioning of the
v0.6-pinned drill target recorded, prospective, before any timed sample: Fly.io
app `snapback-drill` (one machine `819701c927ee68`, sjc, shared-cpu-1x,
auto-stop) with the Tigris bucket `snapback-drill-backups` is live; credential
health flips to provisioned, flyctl and the drill instruments are pinned (the
instruments by content digest), and the drill legs ran with retained receipts —
remote streaming 7/7, durable-row scan PASS, Tigris backup read-back PASS, and
the hosted-auth refusal witness (`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`; no
hosted-auth capability claimed). Every receipt records the drill posture:
`SNAPBACK_PROFILE=test` with `--allow-insecure-dev-auth` behind Fly's TLS
edge. The amendment also records the fixture reconciliation the drill forced —
streamReply's inner mutations reconcile the durable-cancel-vs-progress
`SNAPBACK_MUTATION_CONFLICT` race instead of surfacing it as `failed` — and
the serve-path `--allow-insecure-dev-auth` wiring defect the drill exposed,
fixed with a regression test in the same landing.) 2026-07-24 (protocol amendment v0.6 — the program-ownership /
drill-target decision slice, author decision Charlie Cheever 2026-07-24
against `issues/20260723-llp0075-program-ownership.md`, prospective, before
any timed sample: the first `single-instance-container-vm.v1` remote drill
is pinned to provider fly.io (single Fly Machine VM), region default sjc,
backup object store Fly's Tigris S3-compatible storage, and credential
backend `FLY_API_TOKEN` sourced from the git-ignored machine-local
`.agent-local-secrets.md`. Honesty posture recorded in the amendment
itself: credential health is pending-not-provisioned (no Fly.io account or
token exists on the instrument machine as of 2026-07-24), flyctl/Tigris
package identities and the drill instrument version are
unpinned-blocks-drill, and NO live drill target is claimed. Charlie Cheever
is recorded as the named long-lived program owner/operator and ratifier —
a session-directed default subject to his own amendment; the ownership
ticket narrows to that one-line confirmation residue. The other open
author decisions — comparison fairness, pre-timed-run pins, status
disposition — are deliberately untouched.) 2026-07-24 (protocol amendment v0.5 — the fixture-reconciliation
slice only, prospective, before any timed sample: the authored reference
pattern adopts LLP 0076's host-owned StreamAttemptV1 control plane (attempt
token on fetchStream, host settle with the durable winner recorded
verbatim), the messages schema gains the optional read-only
`effectMayHaveExecuted` mirror (decision 2; `requiredSettlementKinds`
unchanged), the instrument grows to seven checks with the certainty-mirror
witness (7/7 PASS), the decision-5 idempotency downgrade is recorded, and
the generated-CRUD cross-user write expectations track LLP 0065's Accepted
anti-probing `SNAPBACK_ROW_NOT_FOUND` posture. The open author decisions
elsewhere in this Spec — pins, comparator topology, program ownership —
are deliberately untouched.)
2026-07-24 (an executable candidate for the exact statistics and
metric-event instruments is retained under
`demos/competitive-checkpoint/acceptance/instruments/`, locked by
`instrument-lock.candidate.v0.json` sha256
`e4019f498d8cbc19962121a960a082b5657d80735ba0c377da5fb2d673b75cd9`.
The complete machine gate matrix also has an executable candidate locked by
`gate-matrix-lock.candidate.v0.json` sha256
`ea293bfc18d9fac4e2389f8aa4b9b0f59aef75734b269685a38c4dc7f3e328d1`.
A fail-closed run-capsule verifier contract is locked separately at sha256
`73197c8edbce94b3d62beb73b658a3991f54b30c1dd1d8cd4d8e1399764bcf3d`;
it is not the still-missing capsule. The mechanical scoring engine is locked
at sha256
`9ea895ab25213197565c3226c90d381a8803c3e822604d5a38ac7e1dd83419be`,
but it intentionally supplies no confidence anchors. The candidates now bind
the current machine protocol's v0.4 identity rather than the stale v0.3
identity. The run-capsule verifier additionally proves exact protocol bytes
and amendment-backed authorization; complete, non-symlink scaffold and
documentation trees; a path-by-path exact npm v3 public-registry closure with
canonical SRI; and byte-bound policy, per-arm provisioning-plan, assistance,
and credential-check instruments. The metric projection and
scorer bind every observation to one capsule/run, require Convex-first
alternation, retain immediate invalid-replacement slots, and exact-match the
selected seven valid observations to the full observation closure. The
ratified authority still
ends at v0.3: v0.4 and all candidate locks remain unratified and authorize no
timed run).
2026-07-23 (Charlie Cheever explicitly ratified protocol
amendments v0.1 through v0.3 and retained Accepted status. This resolves the
open author-authority question after review; it does not authorize timed runs,
which remain blocked until the protocol's listed prerequisites are complete).
2026-07-23 (third model-family review round — Fable READY, Codex
NOT READY — produced protocol amendment v0.3: rubric anchors now block timed
runs and evidence reveal, not just scoring; the warmup wording is per-arm in
both artifacts; generic `reprioritize` returns the named gap to LLP 0063 for
sequencing. Codex's remaining structural asks — explicit v0.2+ author
ratification, a content-addressed run capsule, a complete machine gate
matrix, and margin rationales — are recorded as open author decisions and
pre-timed-run amendment work, not resolved silently).
2026-07-23 (second model-family review round — Fable READY,
Codex NOT READY — produced protocol amendment v0.2: `securityFailuresMax: 0`,
the replaced-adapter marker and `nextExecutableAdapter` in `claimScope`, and
unpinned-blocks-timed-runs entries for the content-addressed run capsule,
metric event/aggregation definitions, comparator local-leg topology, and
application auth setup; the frozen Draft authority set widened to LLP
0041/0051/0064 with an acceptance-supersedes-snapshot rule. Whether Accepted
stands on author authority over the recorded NOT READY verdicts, or reverts
to Review, is an open author decision recorded below).
2026-07-23 (first model-family review round — Fable and Codex,
both NOT READY, artifacts under `llp/reviews/0075-*` — produced protocol
amendment v0.1: canonical `local-dev-sqlite-ibex` target identity, the
failure/retry/skip margin encoded in the machine protocol, a prose/JSON
divergence rule, outcome precedence, and explicit unpinned-blocks-timed-runs
markers for the assistance policy, statistics implementation, rubric anchors,
and frontend hosting boundary. No timed sample had run; nothing retroactive).
2026-07-22 (Charlie Cheever accepted the v0 protocol and
adjudicated its current checkpoint `reprioritize`. The next tranche replaces
the Cloudflare hosted-adapter hypothesis with the complete LLP 0072 profile on
one single-instance container/VM adapter; public npm publication proceeds as a
parallel gate. Cloudflare remains a narrow proof until it satisfies the same
profile without semantic substitutions. No separate model-family review of
LLP 0075 was received or is implied by this direct author decision).
2026-07-22 (implementation evidence is recorded separately from adjudication;
the current artifact recommends `reprioritize` because the Cloudflare
hypothesis cannot yet satisfy the frozen hosted profile honestly).
2026-07-22 (initial delegated protocol and preregistration fixture for LLP 0074's first competitive checkpoint)
**Related:** LLP 0000, LLP 0010, LLP 0012, LLP 0035, LLP 0041, LLP 0051, LLP 0063, LLP 0064, LLP 0065, LLP 0072, LLP 0074, LLP 0076, Diary 0016, Diary 0017, Diary 0018

## Summary

This Spec freezes the first version of LLP 0074's Convex-specific competitive
checkpoint before implementation changes the surfaces it measures. It is the
delegated protocol slice anticipated by LLP 0063, not a replacement for LLP
0063's program-wide comparison protocol. The machine-readable authority is
[`demos/competitive-checkpoint/acceptance/protocol.v0.json`](../demos/competitive-checkpoint/acceptance/protocol.v0.json)
(amendment v0.5, sha256
`c2a9c3f022a62bb51bd29417a3867ffd84a3f6fa53caf4e41656625a40e810de`; a change
to that file requires a dated amendment entry there and a refreshed pin here).
Current implementation evidence and nonclaims live in
[`implementation-status.v0.json`](../demos/competitive-checkpoint/acceptance/implementation-status.v0.json);
that artifact records the named author's `reprioritize` adjudication.

The first claim is intentionally narrow: for one frozen, agent-authored AI chat
application, can Snapback come within the preregistered start/deploy margins of
an idiomatic Convex implementation while producing stronger retained evidence
for target identity, streamed durable progress, generated owner-scoped data
patterns, and fail-closed authorization?

The protocol freezes the fixture and adjudication. It does not close any
capability gate. LLP 0074's Draft-authority prerequisites still apply, and a
passing run may be described only as satisfying these proposed criteria until
the governing authorities are accepted with executable witnesses.

## Authority and precedence

LLP 0063 continues to own delivery sequencing, capability evidence, baseline
rollover, holdout rules, and final comparative ranking. LLP 0074 — still a
Draft — is the proposed Match/Differentiate/Refuse classification authority;
its criteria bind this checkpoint as proposals until it is accepted. This Spec
owns only the Convex-specific checkpoint fixture, measurements, margins, and
adjudication.

The precedence order is:

1. accepted subsystem authorities govern semantics and capability claims;
2. LLP 0063 governs program sequencing and evidence change control;
3. LLP 0074 governs competitive classification;
4. this Spec and its machine-readable protocol govern the frozen checkpoint;
5. individual harnesses and receipts implement, but may not weaken, this Spec.

Within item 4, a disagreement between this prose and the machine-readable
protocol on an outcome-affecting requirement is a protocol defect that blocks
timed runs until a dated amendment resolves it; neither artifact silently wins.
The checkpoint consumes its Draft authorities (LLP 0041, LLP 0051, LLP 0064,
LLP 0065, LLP 0072, LLP 0076) as of 2026-07-22; an outcome-affecting change
in any of them requires a versioned protocol amendment before it binds this
checkpoint. The snapshot never overrides acceptance: if a consumed authority
is accepted with semantics incompatible with the snapshot, timed runs block
until a prospective amendment rebinds the checkpoint — an old Draft snapshot
must never authorize obsolete semantics.

The prospective baseline cutoff is Snapback commit
`4a1024a7ead9daf2415a1a21a123fcf39f919c92`. Existing work at or before that
commit counts as pre-baseline. The unrelated dirty worktree present when this
protocol was authored is not comparative evidence and cannot alter either arm's
fixture; comparison executions require fresh external checkouts. Any
metric-affecting work after the cutoff is treatment work even when developed
under another LLP. A valid baseline is never silently rewritten. Correction,
instrument replacement, and workload rollover use LLP 0063's versioned,
prospective two-arm rerun rules.

## Named profile and customer

The v0 claim covers the exact frozen fixture only. It does not generalize to all
AI applications, all solo developers, or all backends.

- **Customer:** one agent operating noninteractively for a solo developer or
  small product team.
- **Application:** an owner-private AI chat application with conversations,
  messages, model selection, one streamed assistant response, and explicit
  terminal failure/cancellation state.
- **Frontend:** React web is mandatory for the timed local and hosted path;
  Expo iOS Simulator is a required untimed Online-class compatibility check.
- **Snapback target:** the canonical `local-dev-sqlite-ibex` target for the
  local leg and the first adapter satisfying
  `trusted-single-tenant-app-complete.v1` for the hosted leg. The proposed v0
  adapter was the existing Cloudflare Worker + Durable Object SQLite + V8
  line, graduated through LLP 0072 rather than represented as its current
  narrow proof profile; the 2026-07-22 adjudication below replaced that
  hypothesis prospectively with LLP 0072's `single-instance-container-vm.v1`
  adapter.
- **Convex target:** an idiomatic isolated cloud development deployment for
  iteration and a separate production or preview deployment for the hosted
  receipt. Per-agent scoped credentials are required; the shared chat-matrix
  deployment is inadmissible. The comparator inventory also records supported
  account-free local Convex development; whether the cloud development
  deployment remains the local-leg comparator or a local-Convex sensitivity
  arm is required is an open amendment question, listed below.

Cloudflare was chosen as the v0 hypothesis because Snapback already had real
remote execution,
TLS, Durable Object SQLite, WebSocket hibernation, deploy-time secrets, action
isolation, and target identity evidence there. This is a starting point, not a
claim of completeness: hosted auth, immutable release/rollback, backup/restore,
logs/inspection, and the full control-plane drill remain mandatory gaps. If the
adapter proves unable to satisfy the profile without target-specific semantic
forks, the outcome is `reprioritize`, not permission to weaken the profile.

## Frozen application facts

Both arms implement the same product facts:

- authenticated owner identity is server-derived;
- a user can create, rename, list, select, and delete only their conversations;
- a conversation contains ordered user and assistant messages;
- sending a prompt creates one user message and one assistant placeholder;
- the assistant placeholder receives multiple durable progress patches before
  one terminal completion;
- cancellation leaves an explicit terminal cancelled state and no late patch;
- retry uses one idempotency key and never duplicates a user or assistant
  message;
- an ambiguous upstream outcome is represented distinctly from success and
  ordinary failure;
- another authenticated user cannot read, subscribe to, rename, delete, or
  patch the first user's conversations or messages; and
- reconnect produces an authoritative snapshot through the provider-native
  push path with fallback disabled during the push witness.

The deterministic stream source emits 16 numbered UTF-8 chunks over at least
800 ms. The product may coalesce them, but the witness requires at least three
distinct intermediate authoritative commits observed by a second client before
the terminal commit. Client animation, local token reveal, log lines, or one
terminal replacement do not count.

The complete symmetric application, stream, authorization, hosted lifecycle,
cleanup, and compatibility facts are enumerated in the executable candidate
[`gate-matrix.candidate.v0.json`](../demos/competitive-checkpoint/acceptance/instruments/gate-matrix.candidate.v0.json).
Its lock sha256 is
`ea293bfc18d9fac4e2389f8aa4b9b0f59aef75734b269685a38c4dc7f3e328d1`.
The candidate requires one explicit decision for every required arm/gate pair,
accepts expected refusals only for negative gates, separates Snapback-only
authoring constraints, and permits provider-native equivalence without
permitting omitted evidence or implicit `not-applicable`. It is not yet machine
authority: a dated amendment must ratify this exact lock before timed runs.

## Snapback authored and generated boundary

The Snapback arm uses LLP 0065's narrow owner-visibility profile:

- one installed schema is the source for validators and TypeScript types;
- `defineOwnedCrud` supplies conversation CRUD;
- `defineOwnedUniqueLookup` supplies an owner-scoped lookup;
- `defineOwnedKeysetPages` supplies ordered conversation pagination;
- generated references are the only app-data call surface;
- trusted identifiers and timestamps are server-derived;
- visibility remains an explicit `{ kind: 'owner', field: 'ownerId' }`
  declaration; and
- cross-user negative tests are required on query, live query, mutation, and
  stream-progress paths.

No handwritten validator, client result type, ordinary CRUD handler, stringly
function name, or client-authored owner predicate may satisfy the Snapback arm.
The streamed action and its idempotent progress mutation are outside ordinary
CRUD and may be authored explicitly under the streaming semantic authority,
Draft LLP 0076.

## Package and initial-state freeze

Every timed run begins from a newly provisioned machine snapshot with no
Snapback checkout, no sibling Ibex or Exact checkout, no package cache, no
running backend, and no prior deployment selection. The runner receives only:

- the frozen fixture prompt and protocol;
- registry/network access declared by the protocol;
- scoped credentials for a newly isolated target;
- the same pinned agent configuration and assistance policy; and
- a repository containing only that arm's fresh application scaffold.

None of these inputs is yet content-addressed. The protocol's `runCapsule`
entry blocks timed runs until a dated amendment pins the neutral prompt bytes,
both scaffold tree digests, harness and analysis digests, machine image,
hardware/network policy, exact package integrities, provider/region/plan, and
credential preconditions.

The candidate
[`run-capsule.v0.mjs`](../demos/competitive-checkpoint/acceptance/instruments/run-capsule.v0.mjs)
verifier now fails closed on placeholder choices, secret-shaped values,
mutable machine images, incomplete or unsorted scaffold trees, drifted prompt/
artifact/documentation bytes, non-exact package integrity, and any timed-run
authorization not naming a dated ratifying amendment. Its verifier-contract
lock sha256 is
`73197c8edbce94b3d62beb73b658a3991f54b30c1dd1d8cd4d8e1399764bcf3d`.
That digest does not satisfy `runCapsule`: the neutral prompt, scaffold trees,
machine/network facts, providers, topologies, auth/hosting boundaries,
credentials, assistance, and documentation corpora still need to be selected,
materialized, content-addressed, and ratified together.

Snapback packages must come from the public npm registry. Tarballs, workspace
links, Git dependencies, sibling paths, and repository-local runtime binaries
are failures for the checkpoint. Convex uses its public `convex` package. The
first baseline pins the currently installed comparator line at `convex@1.42.3`
(the exact resolution is anchored by `demos/chat-matrix/expo/bun.lock`; the
manifest range is `^1.42.3`);
the execution receipt pins the exact registry integrity and plan/tier. A package
or platform becomes unavailable only through LLP 0063's instrument-replacement
procedure.

## Hosted deploy gate

One Snapback command from the application root must build, preflight, deploy,
and activate the hosted application. Subcommands invoked internally are counted
in diagnostic provenance but not as author commands. The retained receipt must
bind all LLP 0072 identities and prove:

- an isolated preview target and exact public HTTPS origin;
- immutable release and artifact digests;
- schema/client/profile compatibility preflight;
- declared secrets/configuration without value exposure;
- structured build and runtime logs plus authenticated inspection;
- a compatible next release and code-only rollback without data rewind;
- backup read-back and an isolated destroy/restore/verify/activate drill;
- stale target, wrong account/origin, and preview/production confusion fail
  closed; and
- cleanup retires only resources created by the run.

The Convex arm uses its idiomatic deploy commands, native dashboard/CLI logs,
isolated deployment identity, export/backup and restore/import path, and
provider-native subscriptions. "Hosted live URL" means the public origin
serving the actual React application for both arms; the comparator's deploy
command pushes backend functions, so each arm's frontend host, credentials,
and timed-versus-excluded provisioning boundary must be pinned by amendment
before timed hosted samples. Convex Components are admissible when they are
idiomatic, publicly installable, counted in authored/generated/package volume,
and require no hidden pre-provisioning. Their isolation may not substitute for
the protocol's separate target identity.

## Stream gate

The streaming semantic authority — Draft LLP 0076, whose frozen bounds this
fixture matches — must define and the witness must test:

- an async byte-stream or `ReadableStream`-compatible consumption surface;
- cancellation propagated to the upstream reader and late-commit fence;
- a 1 MiB total byte ceiling, 64 KiB buffered-byte ceiling, 30 s wall-clock
  ceiling, 5 s idle ceiling, and 10 authoritative progress commits/second;
- backpressure rather than unbounded eager reads;
- secret-safe diagnostics containing operation, source locus, expected shape,
  received safe summary, and repair link;
- idempotent retries keyed by one server-issued attempt identity;
- distinct complete, failed, cancelled, timed-out, and ambiguous settlement;
  and
- at least three observed intermediate commits before terminal completion.

The bounds are fixture limits, not universal runtime defaults. Changing one is
a workload-version change requiring a prospective two-arm rerun.

## Measurement and margins

The two arms alternate after two untimed warmups per arm and run seven timed
samples each, the Convex arm taking the first timed sample. The receipt retains every
valid sample and reports median, p95, and a 95% bootstrap confidence interval.
The point-estimate median decides every elapsed margin; the p95 and confidence
interval are informational and cannot rescue or overturn a margin. Only a
documented instrument failure — with a named documenter and retained rationale
— may invalidate a sample. The exact statistics implementation (estimator,
bootstrap target, resample count, seed, invalid-sample replacement) must be
pinned by content digest in a dated amendment before the first timed sample.

An executable candidate now supplies the missing exact statistics and metric
event definitions. Its content-addressed lock is
[`instrument-lock.candidate.v0.json`](../demos/competitive-checkpoint/acceptance/instruments/instrument-lock.candidate.v0.json),
sha256
`e4019f498d8cbc19962121a960a082b5657d80735ba0c377da5fb2d673b75cd9`.
It fixes the even-sample median, nearest-rank p95, deterministic independent-arm
bootstrap, replacement-slot behavior, monotonic event clock, command
boundaries, assistance counters, and failure taxonomy in executable artifacts.
This is implementation input to a future dated amendment, not that amendment:
the protocol's `statistics-implementation` and `metric-definitions` prerequisites
remain `unpinned-blocks-timed-runs` until the named author ratifies the lock.

The first-hour non-inferiority rule is conjunctive:

- median scaffold-to-first-local-live-row time is no more than 1.25× Convex
  and no more than two minutes slower;
- median scaffold-to-hosted-live-URL time is no more than 1.25× Convex and no
  more than five minutes slower;
- authored top-level commands are no more than Convex + 2 locally and Convex +
  3 through hosted activation;
- agent tokens and tool calls are each no more than 1.25× Convex;
- human interventions and unplanned credential repairs are zero;
- required failures, retries, and skipped gates are no greater than Convex;
  and
- cleanup defects, correctness failures, and security failures are zero
  absolutely, not merely no greater than Convex.

Passing only elapsed time is insufficient. A run outside any margin fails the
first-hour outcome, while still retaining its raw evidence.

## Three reported outcomes

The protocol never collapses results into one score.

1. **Product completeness:** conjunctive pass/fail across deploy, stream,
   generated owner patterns, native push, production identity, rollback,
   backup/restore, logs/inspection, and explicit nonclaims.
2. **First-hour cost:** the time, command, agent-token, tool-call, failure, and
   intervention margins above.
3. **Correctness and evidence confidence:** a rubric over authority attribution,
   transport attribution, target identity, settlement precision, negative
   authorization, cleanup, artifact immutability, and receipt reproducibility.

The confidence rubric has eight equally weighted required dimensions. Each
dimension is `0` (missing/contradicted), `1` (indirect), or `2` (direct,
reproducible evidence). Evidence confidence requires 16/16 for Snapback and
reports the Convex score without weakening Snapback's floor. The hypothesis
that Snapback is materially easier to inspect and trust is confirmed for this
fixture only if Snapback scores 16/16 and exceeds Convex by at least two points;
otherwise it remains unconfirmed. This rubric operationalizes the trust
hypothesis under test; it is not a neutral quality score. Per-dimension,
per-arm scoring anchors — including what counts as direct, reproducible
evidence for Convex dashboard/CLI artifacts — must be preregistered by
amendment before the first timed sample and before either arm's evidence is
revealed to the anchor author, a model family that authored neither arm scores
it with a retained dimension-level transcript, and managed-provider evidence
may not be scored down merely for differing from Snapback's receipt
vocabulary.

The candidate
[`scoring.v0.mjs`](../demos/competitive-checkpoint/acceptance/instruments/scoring.v0.mjs)
now applies every first-hour conjunction, includes retained invalid
observations in absolute-zero floors, requires all 16 arm/dimension decisions,
enforces the independent-scorer record, and applies Stop → Reprioritize →
Continue precedence. Its lock sha256 is
`9ea895ab25213197565c3226c90d381a8803c3e822604d5a38ac7e1dd83419be`.
The scorer is only machinery. Because its author has already seen Snapback
evidence, it deliberately does not invent the missing per-arm anchor prose;
an eligible independent anchor author must freeze those criteria before
evidence reveal under a dated amendment.

## Continue, stop, and reprioritize

Outcome precedence is Stop, then Reprioritize, then Continue: a run exhibiting
both a Stop-class defect and a dominant gap stops. A required pre-run skip
with no Stop-class defect yields a readiness disposition of `reprioritize`,
which is not a first-hour, completeness, or confidence outcome; no timed
comparison result exists until both arms complete timed samples under this
protocol.

- **Continue:** all three checkpoint deliverables pass, first-hour margins
  pass, Snapback evidence confidence is 16/16, and no required authority or
  cleanup gate is skipped. Rerun the comparison and return the result to LLP
  0063, which owns any stage-broadening sequencing decision.
- **Stop:** a correctness/security defect permits cross-user access, late
  effects after cancellation, target confusion, secret exposure, destructive
  cleanup, or a false capability claim. Stop metric work and fix the defect.
- **Reprioritize:** product correctness passes but deploy or first-hour margins
  fail, the proposed Cloudflare adapter cannot implement the profile honestly,
  or one gap dominates the result. Return the named gap to LLP 0063, which
  owns sequencing of the next tranche, and rerun prospectively; do not average
  it away.

## Author adjudication — 2026-07-22

Charlie Cheever accepted this frozen v0 protocol and adjudicated the retained
implementation evidence **Reprioritize**. The required hosted and public-npm
skips make `Continue` unavailable; no correctness or security defect supports
`Stop`. Under the outcome precedence above, this is a pre-run readiness
disposition, not a checkpoint comparison result: no timed two-arm sample has
run. This decision preserves the locally proven streaming, generated-owner,
React/Expo, package-closure, doctor, and immutable-release facts without
promoting them into a competitive or hosted capability claim. Two instrument
defects recorded after review narrow that preservation: the retained
local-streaming receipt carries a hardcoded noncanonical target alias
(corrected prospectively by protocol amendment v0.1) and witnesses cross-user
list/lookup/update denial but not yet cross-user delete refusal; both require
a versioned instrument correction and a prospective rerun of the affected
witness before any comparison run.

An untimed 2026-07-24 rerun against the current uncommitted worktree now passes
all six local-streaming checks with the canonical target derived from the
served capability manifest and cross-user delete refusal retained in the
receipt. This is implementation evidence for the current tree only: it does
not rewrite the 2026-07-22 adjudication, ratify protocol v0.4, or authorize a
timed comparison.

The next tranche implements `trusted-single-tenant-app-complete.v1` through
LLP 0072's selected `single-instance-container-vm.v1` adapter, per LLP 0063's
sequencing decision — sequencing this Spec does not own. Public npm
publication is a parallel gate. Cloudflare remains the v0 hypothesis and a
narrow proof; it does not regain checkpoint eligibility unless it independently
satisfies the same complete profile without semantic substitutions.

This is a direct author adjudication. As of that date (2026-07-22), no
separate model-family review of LLP 0075 had been received, and the LLP 0074
review artifacts do not count as reviews of this Spec. On 2026-07-23 four
model-family review rounds were received and recorded under
`llp/reviews/0075-*` (round 1: Fable NOT READY, Codex NOT READY; rounds 2-3:
Fable READY, Codex NOT READY; round 4, a Fable-only confirmation of the
post-v0.3 revision: READY); protocol amendments v0.1 through v0.3 respond to
them prospectively. On 2026-07-23 Charlie Cheever explicitly ratified those
amendments and retained this Spec's Accepted status on named-author authority
over the recorded NOT READY verdicts. That ratification does not authorize
timed runs: the listed protocol prerequisites remain blocking. The adapter
replacement is prospective treatment work. Before a comparison rerun, its
exact provider/region, package identities, credential health, and instrument
version must be pinned in a versioned protocol amendment under LLP 0063; v0's
cutoff and evidence are not rewritten. *(2026-07-24:
protocol amendment v0.6 records the provider/region/object-store/credential
tuple — fly.io, sjc, Tigris, `FLY_API_TOKEN` — with credential health
honestly pending-not-provisioned; package identities and the drill
instrument version remain unpinned-blocks-drill until first provisioning.
2026-07-25: protocol amendment v0.7 records that first provisioning — app,
machine, image, bucket, and public origin pinned; credentials provisioned;
flyctl and the instruments pinned, the instruments by content digest — and
retains the first drill receipts. Later the same day, protocol amendment v0.8
adds the one D4-authorized resource: persistent volume `vol_r6815pkd59o1x614`
(`caddy_storage`, 1 GB, sjc) mounted at `/data/caddy` for terminator
certificate storage; the attach replaced the pinned machine with
`849764f2e7dd58`.)*

## Required artifacts

The protocol implementation must retain:

- the canonical fixture tree digest and both generated trees;
- exact source/generated/dependency line and byte inventories;
- machine, OS, CPU, memory, network, package, agent, plan/tier, and credential
  health facts;
- raw commands with timestamps and exit codes, excluding secret values;
- all warmup/sample timing data and statistics implementation;
- local, hosted, Expo, streaming, authorization-negative, rollback,
  backup/restore, logs/inspection, and cleanup receipts;
- refreshed comparator inventory entries with official source URL,
  verification date, and delivery class (which encodes beta/component/hosted
  maturity where the provider distinguishes it); and
- an aggregate verdict naming every pass, failure, skip, nonclaim, protocol
  version, artifact digest, and adjudicator decision.

Remote dependency unavailability is a named skip and never a pass. A required
remote skip blocks the checkpoint outcome but does not erase locally proven
facts.

## Current comparator inventory refresh

Official Convex documentation rechecked on 2026-07-22 (and re-verified
against live documentation by the 2026-07-23 review rounds, recorded in
`llp/reviews/0075-*`; the inventory rows retain their own 2026-07-22
verification dates) confirms account-free local deployments,
per-agent isolated cloud deployments each carrying a deployment-scoped token
for an expiring deployment, production/preview deploys, backup/export and destructive restore,
online resumable migration components with dry runs, staged index backfills,
Components with isolated data/functions, React Native/Swift/Kotlin quickstarts,
and action `fetch` in a browser-like runtime. The machine-readable inventory
must preserve exact source URLs and distinguish core, component, beta, and
hosted-only delivery rather than flattening them into one capability label.

## Open questions

- *(Resolved 2026-07-24, protocol amendment v0.6 — Charlie Cheever, recorded
  as a session-directed default subject to his own amendment; the ticket
  keeps a one-line owner-confirmation residue.)* Who is the named long-lived
  competitive-program owner and operator after the
  current implementation session?
- *(Resolved 2026-07-24, protocol amendment v0.6 — fly.io / sjc / Tigris
  S3-compatible / `FLY_API_TOKEN` via `.agent-local-secrets.md`; credential
  health pending-not-provisioned, package identities and drill instrument
  version unpinned-blocks-drill, no live target claimed. Provisioned and
  drilled 2026-07-25, protocol amendment v0.7.)* Which provider,
  region, backup object store, and credential backend will
  instantiate `single-instance-container-vm.v1` for its first remote drill?
- Does the public claim remain exact-fixture-only after v0, or which holdout
  fixture earns generalization to an agent-authored AI application profile?
- What is the pinned per-arm assistance policy — the agent model/tool
  configuration and documentation/context each arm receives — given the
  asymmetry between the comparator's training-data presence and Snapback's
  shipped guide?
- Which frontend host, identity provider, two-principal account setup, and
  timed-versus-excluded provisioning boundary does each arm use for the timed
  hosted path?
- Is the Convex local leg the cloud development deployment, account-free
  local Convex, or both with a preregistered sensitivity arm?
- Which model family scores the evidence-confidence rubric for the actual
  rerun, and under what preregistered per-dimension anchors?
