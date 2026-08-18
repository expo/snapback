# LLP 0161: The agent-optimized storage engine — ideal properties and Snapback's gap

**Type:** Research
**Status:** Active
**Systems:** Storage, Sync, Migrations, Agent experience, Diagnostics, Competitive analysis
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-03
**Revised:** 2026-08-03 (promoted Draft → Active by the author after
the two-round dual-family super-refine loop — round-2 Fable READY
judged a diff spot-review sufficient and Active defensible at the
author's call; v0.3 content otherwise unchanged; the today-column
carries Medium confidence pending the target-by-target re-audit its
Confidence section names); 2026-08-03 (v0.3, super-refine round 2 close-out under the
author's two-round cap — these repairs are themselves unreviewed: P9
(authority-scoped admission and bounded speculation) added after both
families independently derived it from the concurrency pressure;
LLP 0088's three dispositions now quoted with its own verbs (pursues /
defers / declines); the LLP 0158 posture cells updated to its v0.12
state in this working tree (OQ9 decided, first consumer pinned, F0a
green-lit with tickets — all uncommitted); P2's "resumable" narrowed to
the digest type and keyset-scan substrate — the shipped §5 proof runs
fresh streams and restarts on interruption; P5 target-indexed (local
verified; Cloudflare records reads without validating and fans out
without dependency precision); P8's same-lane gap added
(`clientMutationId` is optional on ordinary immediate mutations); P1's
"nearly done twice over" replaced with substrate-vs-product honesty;
the fsync sentence sharpened (Snapback owns durability *protocols*
above SQLite/OS primitives, not page storage); universal superlatives
scoped to the surveyed set; the push-lane durable effect ledger
credited as P6's per-lane exception; today-column confidence lowered
to Medium pending re-audit) — prior: v0.2 same day, round-1 fixes
(LLP 0097 added; P8 settlement added and merges-for-keeps reconciled;
P2 asymptotics; P4 three-way split; P6 both-directions correction; P3
precision; conclusion narrowed to no-bespoke-on-disk-engine)
**Related:** LLP 0000, LLP 0007, LLP 0008, LLP 0024, LLP 0037, LLP 0043, LLP 0046, LLP 0081, LLP 0088, LLP 0097, LLP 0126, LLP 0146, LLP 0155, LLP 0158, LLP 0159, LLP 0160, LLP 0162

> **Brainstorm-grade.** A first-principles design exercise: if the primary
> user of a storage engine is an agent rather than a human developer, what
> does the engine look like — and how far is Snapback, as shipped and as
> planned, from that ideal? Companion to LLP 0159 (which asks whether to
> change the physical layout; this document concludes the agent-facing
> ideal doesn't require that) and LLP 0160 (whose migration-experience
> ideal is one slice of this document's P-properties).

## Summary

Agents differ from human developers as database users in three durable
ways: they **speculate** (try things whose outcome they cannot predict,
at a rate humans never did), they **need proof** (they cannot "just
remember" what they did — provenance and verifiability substitute for
institutional memory), and they **operate concurrently** (many agents,
one substrate, no hallway coordination). Deriving an ideal engine from
those pressures yields nine properties (P1–P9 below). Among the systems
surveyed here and in LLP 0158's vendor table `[inferred — bounded to
that survey set, not an exhaustive market claim]`, vendors' 2025–26
agent repositioning gestures at subsets — branching for agents (Neon;
PlanetScale for schema, with data via backup/restore per LLP 0158),
versioned data (Dolt), log-as-authority (Datomic's old idea, newly
relevant) — but none of the surveyed systems has the set.

The gap analysis (§3) finds Snapback structurally closer to this ideal
than the surveyed general-purpose engines — the journal, commit-version
stream, read-set capture, deterministic handler tier, migration proofs,
idempotent outbox settlement, fencing-token discipline, and receipts
are P-property foundations that plain SQL databases lack — but with
each property stopping short of first-class in a specific, named way.
The conclusion, stated at its honest width: **no property requires
reimplementing page storage, WAL recovery, or the physical engine** —
SQLite stays the bottom layer — though several properties do require
Snapback-owned durability *protocols* above SQLite/OS primitives
(LLP 0158's publication protocol already owns rename ordering,
directory fsync, and a crash-cut matrix), and several gaps (incremental
digests, per-commit provenance, a historical-state representation, a
broader effect log) are genuine Snapback-engine-layer internals, not
product surface. LLP 0097's landed fork substrate plus LLP 0158's fork
RFC remain the highest-leverage first move.

## 1. Why agents change the requirements

- **Speculation.** An agent's core loop is propose → try → evaluate →
  keep-or-discard. Human workflows amortize a mistake's cost through
  review before execution; agent workflows want execution *to be* the
  review, which requires trying things where being wrong is free — and
  a paved way to keep what worked. LLP 0158's vendor survey documents
  the market evidence within its surveyed set.
- **Proof over memory.** A human DBA carries context between sessions;
  an agent's context dies with its window. What persists must be *in
  the substrate*: who changed what, under which authority, whether a
  retried operation already happened, provable after the fact.
  Snapback's receipt discipline (LLP 0081) is this instinct applied to
  migrations; the ideal applies it to everything.
- **Concurrency without coordination.** Fleets of agents share one
  substrate (this repo's own fleet memory documents the collision
  patterns). The engine, not etiquette, must make concurrent
  speculation safe, which decomposes three ways. *Isolation for tries*
  (P1). *A principled keep path* — and here the corpus has already
  ruled, and this document adopts the ruling rather than reopening it:
  merge is never a storage primitive (LLP 0088 §4 declines core merge
  — do not pursue as core machinery; record-level branching is
  separately deferred by §3), and the keep path is **promotion by
  re-execution** through the canonical serialized stream (LLP 0097's
  staged promotion). The ideal engine makes that re-execution cheap
  and provable, not the merge automatic. *Containment for the
  substrate itself* — authority and resources, which round-2 review
  correctly identified as a missing property and is now P9.

## 2. The ideal properties

**P1 — Forking as a primitive.** Cheap copy-on-write fork of a whole
logical database; quarantined side effects; a machine-readable diff
surface; disposal as the default outcome; keeps promoted by
re-execution (§1). The agent question it answers: *"what happens if I
do this?"* — answered by doing it, elsewhere. Prior art: Neon
branch-per-agent `[observed — LLP 0158's survey]`; Dolt clones
`[author knowledge — reverify]`; PlanetScale, narrowly: schema-change
branches, with data branching via backup/restore rather than CoW
`[observed — LLP 0158's survey]`; in-corpus, LLP 0097's ephemeral
branches (Accepted; substrate landed) and LLP 0158's whole-instance
fork.

**P2 — Merkle-ized state.** Content digests as a *maintained* property
of every table (incrementally updated, partitioned/Merkle-shaped), so
two states compare in O(1) at the root, a single divergence localizes
in O(log n), and enumerating k differences costs output-sensitive time
— never a full rescan. Answers: *"did my change do exactly what I
claimed — and nothing else?"* — P1's diff surface and LLP 0081 §5's
proofs become cheap lookups. Prior art: Dolt's Merkle-DAG/prolly-tree
storage `[author knowledge — reverify]`; its performance
characterization ("novel-writes commit fast regardless of table size")
is `[unverified — vendor claim]`, and OQ1 carries the real
affordability question. In-corpus, LLP 0081's OQ2 already asks for the
partitioned variant.

**P3 — Provenance-native commits.** Every commit durably records its
principal (agent identity, session, plan/operation digest where one
exists) as engine metadata, queryable later — the natural shape is one
commit-metadata record keyed by commit version, joined through the
journal, not a principal column duplicated onto every row change.
Answers: *"which agent did this, under what authority?"* without log
archaeology. Prior art: Dolt commit metadata `[author knowledge —
reverify]`; audit columns as convention everywhere else — nobody makes
it an engine property.

**P4 — Historical state, in three distinct strengths.** (a)
*Checkpoints*: capture now, read later — a fork pinned at its base
version. (b) *Per-record history*: bounded, opt-in "how did this row
get here." (c) *Database-wide as-of*: query the whole store at an
arbitrary retained version, and diff two versions. The three need
materially different substrates (a file copy; a per-row version chain;
a retained baseline or temporal representation), and conflating them
overstates progress. Answers: *"what did the world look like when the
agent decided X?"* Prior art: Datomic — architecturally free as-of
because the immutable log *is* the database, at the cost of that being
the storage model `[author knowledge]`; Dolt `AS OF`; SQL:2011
temporal tables.

**P5 — Read/write-set capture as a public primitive.** The engine knows
each paved-path transaction's read set and write set — for OCC, for
reactivity, and *for explanation*: an agent can ask why a transaction
conflicted or what a computation depended on. Prior art: Convex's
read-set subscriptions (LLP 0159); FoundationDB's OCC
`[author knowledge]`.

**P6 — Deterministic replay.** The write log replays to an identical
state for a declared scope: writes are closed expressions or recorded
effects, with ambient reads (time, randomness) captured as replayable
inputs, never implicit. Answers: *"can I reproduce the bug / verify the
history?"* The honest form of this property declares its scope — which
lanes (app rows, auth, assets, external effects) the log covers and
what "identical" means. Prior art: Datomic's transaction log; event
sourcing; LLP 0081's closed backfill expressions and explicit constants
are exactly this discipline, applied to one operation class.

**P7 — Schema evolution with proofs and lenses.** Schema changes are
reviewed, provable operations (LLP 0081 has this) and, at the frontier,
bidirectional lenses let mixed-schema readers/writers coexist (Cambria,
Jazz v2 — recorded as a pointer, not an adoption, in LLP 0037 CC-8.11).
The agent-specific justification for the lens half is a hypothesis
worth stating: agents may ship schema changes at a rate that makes
mixed-version client populations the steady state rather than an
upgrade window `[hypothesis — no corpus measurement yet]`. LLP 0160
owns the experience half of this property.

**P8 — Idempotent, receipt-addressed settlement.** Every intent carries
a stable operation identity; the engine suppresses duplicates,
custodies the result atomically with the data change, and answers "did
my earlier attempt happen?" after a crash or ambiguous transport
outcome. Agents retry aggressively and lose context mid-flight;
determinism (P6) and provenance (P3) do not by themselves prevent the
same intent landing twice. This is the property behind LLP 0043's
durable-outbox settlement and LLP 0081's replay-returns-the-receipt
rule; the ideal engine makes it universal — including on lanes where
it is optional today.

**P9 — Authority-scoped admission and bounded speculation.** Writes
and reads are admitted under least-privilege, revocable,
principal-scoped authority with fencing (a superseded or revoked
principal cannot advance state), and speculation itself is
resource-bounded per principal (fork count, retained bytes, digest
work), so a runaway or rogue agent is a contained event rather than a
substrate incident. P3 records authority after the fact; P9 enforces
it at admission — both derive from the concurrency pressure, and
round-2 review of this document derived P9 from two directions
independently (authority containment; resource governance). In-corpus
substrate already exists: agent principals and scoped grants
(LLP 0146), lease-epoch fencing tokens (LLP 0081 §4, LLP 0072),
credential withholding as a fork requirement (LLP 0158), and
LLP 0097's OQ5 asking exactly the resource-bounds question. Read-side
auditing (who *saw* what) sits between P9 and P5's explanation surface
and is left as OQ7.

Deliberately absent: a bespoke on-disk format. None of P1–P9 requires
reimplementing page storage, WAL recovery, or crash-atomicity at the
physical layer — though P1's publication protocol shows the honest
qualifier: Snapback owns durability *protocols* above SQLite/OS
primitives (staging sentinels, atomic rename, directory fsync, a
crash-cut matrix) without owning the page format beneath them. Convex's
choice (custom everything *above* commodity persistence — LLP 0159) is
the confirming precedent.

## 3. Gap analysis: Snapback today and planned vs. the ideal

"Corpus posture" is read as of the 2026-08-03 working tree, including
uncommitted companion documents (LLP 0158 is at v0.12, uncommitted) —
posture is not a plan, and none of it is commissioned program work
unless LLP 0130/0155 say so. Coverage caveat for every row: "today"
cells are **target-indexed where it matters** — local SQLite/Ibex is
the verified substrate; the Cloudflare target and host-plan lane
frequently differ; protected auth lanes, assets, sidecars, and external
effects are separate lanes with separate answers.

| P | Ideal | Snapback today | Corpus posture | Gap to ideal |
|---|-------|----------------|----------------|--------------|
| P1 fork | Cheap CoW fork + diff + quarantine + promote-by-re-execution | Two reusable copy/rehearsal substrates exist — LLP 0097's landed-but-unwired branch substrate (`MaterializedBase`, COW overlay, `EffectClass` capture ledger — `crates/snapback/src/branches.rs`, no request path) and 0081 §7 restore-derived rehearsal — plus operation-specific what-ifs (LLP 0146 dry-run with predicted writes/deps) | LLP 0097 Accepted (unwired); LLP 0158 Draft at v0.12: spike proved manual cold-copy O(1) + journal diff only, and OQ9 is decided (same-`appId` derived deployment), the first consumer is pinned (this repo's agent fleet), F0a is author-green-lit with a ticket program in-tree — all uncommitted | **Medium-Large** — wiring, crash-safe publication, lifecycle/registry/TTL, identity mint, credential isolation, and effect mediation are product-critical net-new work, not residue |
| P2 digests | Maintained Merkle digests; O(1) equality, O(log n) localization, output-sensitive diff | `ContentDigestV1`: flat, streaming; the digest *type* and the keyset-scan substrate are checkpoint-resumable, but the shipped §5 proof builds fresh streams and restarts on interruption; computed only in apply/rehearsal's pre-publication verification phase (`migrate verify` re-proves the recorded receipt; it does not re-digest) | LLP 0081 OQ2 names the Merkle variant, unowned | Large — nothing incremental exists; today's digest is a one-moment full scan |
| P3 provenance | Every commit carries principal + authority (commit-level record, journal-joined) | The general change journal records versioned row changes only (version, table, row id, op, post-image, timestamp — no principal); rich identity/plan provenance exists in specialized seams (migration journal binds approver+plan; membership transitions carry `principal`; auth lanes separately journaled) | Nothing proposes per-commit principal as a stored engine fact | Medium — engine-layer schema + write-path plumbing `[inferred — verified absent from the general journal; not audited across every specialized lane]` |
| P4 history | Checkpoints / per-record history / database-wide as-of (three substrates) | Checkpoints: backup/restore now; 0097/0158 forks pin a *current* version (a fork is a checkpoint, not as-of). Per-record: journal holds post-images within the sync retention window (LLP 0008's server journal window) — no baseline, no surface. As-of: no retained baseline or temporal representation exists | LLP 0088: **pursues** bounded read-only per-record history (Draft, gated on the 0085 evidence review, unimplemented); **defers** branch creation; **declines** losing-version retention and core merge | Small for checkpoints; Medium for per-record history (design exists); **Large** for true as-of — a substrate, not a surface, is missing |
| P5 read/write sets | Public, explainable, all targets and lanes | **Local SQLite/Ibex (verified): closest to ideal** — server-captured read sets (row, missing-row, query dependencies), commit-time validation at predicate granularity, live-matcher invalidation; conflict errors name the triggering dependency, and runner/dry-run surfaces return read/write sets. Host-plan mutations validate a *client-supplied* baseline (LLP 0007 Option A, ratification-pending note recorded there). **Cloudflare target: reads are recorded but not validated** (serialized coordinator supplies isolation) and live fan-out wakes every live query per commit — no dependency precision | LLP 0146 affordances build on it; its ticketed Cloudflare declared-vs-captured defect is the same seam | Small-Medium on the local target (uniform durable explanation API); larger for the all-target ideal, priced per target |
| P6 replay | Scope-declared identical replay, ambient inputs recorded | Queries/mutations *are* the deterministic tier — ambient time denied, `ctx.runtime.now()` and generated IDs recorded and replayed through the ctx answer ledger; actions are deliberately nondeterministic with no ledger. The change journal is a bounded row post-image stream (app-row lane only), a sync-delta substrate, not byte-identical state reconstruction. Outbound effects: the push lane already keeps a durable per-lane intent/receipt ledger — the existing precedent — while fetch-borne handler egress is recorded nowhere durable; 0097's `EffectClass` ledger (which would close that) is landed but unwired | 0097 wiring would close the effect-record half | Medium — the handler tier is nearly ideal; the log's *scope declaration* and general effect capture are the gaps |
| P7 evolution | Proofs + lenses | LLP 0081: the strongest reviewed-migration contract among LLP 0160's seven evaluated backends (LLP 0160 §4) | LLP 0160 experience program; lenses explicitly not adopted (and their necessity is tagged hypothesis) | Small for proofs; lenses deliberately unclaimed |
| P8 settlement | Universal idempotent, receipt-addressed intents | Required and automatic on the durable outbox/replay lane (LLP 0043 settlement commits atomically with data changes); migration operations replay to receipts keyed by `operationId`+audience (LLP 0081 §4); jobs are immutable-argument with terminal disposition (LLP 0070). **On ordinary immediate mutations, `clientMutationId` is optional and the client defaults it off** — same-lane gap, not just cross-lane | — | Medium — mandatory default intent identity on the ordinary mutation lane, then per-lane universalization |
| P9 admission | Least-privilege, revocable, fenced, resource-bounded | Fencing tokens are real and load-bearing where they exist (migration lease epochs; LLP 0072 operation fencing); agent principals and scoped grants shipped (LLP 0146); per-principal *resource* bounds on speculation do not exist (0097 OQ5 open) | LLP 0158 requires credential withholding for forks; 0097 OQ5 asks the bounds question | Medium — enforcement exists per-subsystem; admission as a uniform engine property is unbuilt |

Reading the table: **no gap calls for reimplementing the physical
engine** — that conclusion stands at its corrected width (Snapback owns
durability protocols, not page formats). What v0.1 got wrong and v0.2
only partly fixed is the flavor of the remaining work: P2, P3, P4(c),
P6's scope declaration, and P9's uniform admission are engine-*layer*
internals (write-path plumbing, new durable relations, a historical
representation, an admission seam) that happen to live above SQLite,
the same way the journal does. P5 (locally), P7's proof half, and P8's
outbox lane are near ideal. P1 has real substrate twice over and a
product-critical unbuilt safety plane.

## 4. Sequencing view (if this direction is ever resourced)

Dependency leverage, not a commissioning order — LLP 0155/0130 own the
actual roadmap (and LLP 0158's F0a green-light, recorded in its v0.12
with tickets in-tree, means item 1's first slice already has author
intent behind it):

1. **P1 first — wire what's landed.** LLP 0097's substrate plus
   LLP 0158's F0a corpus compound immediately: fork-accelerated
   rehearsal (LLP 0160 G7), fork-instead-of-seed acceptance runs,
   preview environments, and the what-if loop that defines agent
   speculation. Honestly priced: the copy is nearly free; identity
   mint, egress mediation, asset custody, and crash-safe publication
   are the work. Wiring 0097's effect ledger also closes P6's
   effect-record half.
2. **P2 second.** Incremental Merkle digests make P1's diff surface and
   LLP 0081's proofs cheap, answer 0081 OQ2, and are the honest
   prerequisite for P4 diffs at scale. The natural implementation rides
   the same transaction that writes the change journal — which is also
   OQ1's hot-path question (and OQ1 should be answered with LLP 0081
   §5's own vocabulary: a digest without an independent expected value
   is inventory, not proof).
3. **P3/P4 third.** A per-commit principal relation joined through the
   journal, and P4 in its (a)→(b) order — checkpoints are nearly free
   once P1 lands; per-record history follows 0088's pursue
   recommendation; database-wide as-of waits for a measured forensic
   need.
4. **P5/P6/P8/P9 surfaces opportunistically** — a uniform explanation
   API over read-set facts when LLP 0146-class features want it; P6's
   scope declaration when the effect ledger wires; P8's default intent
   identity on the ordinary mutation lane; P9's admission seam as the
   fleet's first containment incident demands it.

## Confidence

**High** that P1–P9 capture real agent pressure — each traces to lived
fleet behavior in this repo, the bakeoff diaries, or surveyed vendor
repositioning (external attributions tagged inline; several are
`[author knowledge — reverify]`; the cross-vendor superlatives are
scoped to the surveyed set). **Medium** on the today-column for this
revision: the load-bearing cells were verified against the tree across
two review rounds, but each round found a real correction (round 1 a
missing Accepted LLP; round 2 the §5 resumability and P5 target-scope
overstatements) — restore to Medium-high only after a target-by-target
re-audit. **Medium** on the corpus-posture column — 0158 v0.12 and its
tickets are uncommitted; 0088 is Draft-gated; 0097 unwired. **Low-
medium** on sequencing — it optimizes for compounding, but nothing here
has a customer pull signal yet; LLP 0155's local-sync direction and
LLP 0130's wave own the actual roadmap (and OQ5 asks what the client
store pulls forward, per LLP 0126's findings).

## Open questions

1. Is P2's incremental digest maintenance affordable on the hot write
   path (riding the change-journal transaction), or does it run as an
   async catch-up with a lag bound — and per LLP 0081 §5's vocabulary,
   is a lagging digest proof or inventory?
2. Does P3 store the principal on every *row version* (heavy) or every
   *commit* (light, joins through the journal)? The journal-level
   answer seems obviously right; is there a forensic case it fails?
3. What retention policy makes P4(c) useful without unbounded growth —
   time-boxed history, fork-pinned history (a fork pins its base
   version), or explicit named checkpoints only? And does anyone need
   (c) before (a)+(b) are exhausted?
4. Should P6 harden into "handlers record their ambient reads as
   replayable inputs" *for actions too* — the query/mutation tier
   already does this via the ctx answer ledger; actions are the
   deliberate exception, and retrofitting them later may be impossible?
5. Which of these properties does the LLP 0155 local-sync direction
   need natively on the *client* store (the sync engine already replays
   a journal there — LLP 0126's schemaless-view and
   compatibility-refusal prior art applies), and does that pull any
   sequencing forward?
6. P5's scope: must read/write-set capture extend to the Cloudflare
   target, administrative, migration, and action-triggered write paths
   to count as an engine property, or is paved-local capture plus
   per-lane journals the honest permanent shape?
7. Does P9 include read-side auditing (who *saw* what), or is that
   P5-explanation territory — and where is the boundary between P9's
   admission enforcement and the deployment/product layer?
