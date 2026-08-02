# LLP 0146 agentic authoring affordances review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — no `llp/reviews/` artifact concerning LLP 0146 read,
blind to this RFC's codex artifact. SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `0b009ed73a1f87f1fd0512a66435e1be1f57bf1ef21f74761a913cfe331333ce`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (605 lines, Draft)
**Target SHA-256:** `eeecc46c923d4f4248c2eb2cae26a4c81b9bf2ca0e80ee2c9a477fd53e7d36ca`
**Repo revision at review start:** origin/main `7c509eb6`
**Tool uses:** 48 (reported), 51 (harness)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment
**Verdict: NOT READY**

The document's load-bearing spine holds: I independently verified the correction in §"A verified correction" — live subscriptions and invalidation key off runtime-captured `CapturedReadDependency` values, mutation commit validates against the runtime-captured `executed.reads`, nothing in the tree compares declared and captured sets, and the sole out-of-file consumer of `captured_reads` is the secret-scope union in `src/admin.rs`. Every claim the capsule flagged as checkable (acceptance.run pinned-but-unbuilt, CV-14 open and unclaimed, the 0127-decision-6 record) checked out exactly. But the "What already ships" baseline — which the document itself declares load-bearing ("Establishing the baseline matters") — contains two false "Shipped"/"implemented" claims (query explain is not implemented; checkpoint is neither a host op nor the cited code), D1's v0 verdict vocabulary has a scope error (per-invocation `overDeclared` is meaningless for conditional reads), D1's refusal codes are assigned to the wrong registry (LLP 0144 scopes itself to app-declared codes, not platform codes), and D5 never engages the LLP 0110/0134/0135 relation family that deliberately declined the exact `onTargetDelete` ground D5 builds on. All four are cheaply fixable and none inverts a decision, so this is a one-revision NOT READY, not a structural one.

## Strengths

What I verified, versus inferred, to establish the following:

- **The correction is true, and for the right reason.** `LiveSubscription.read_dependencies` is typed `Vec<CapturedReadDependency>` (`src/local.rs:3298`), registered from the executed query at `src/local.rs:13688`, with the invalidation/epoch path consuming it at `:13399`, `:14618`, and `:19177`. Mutation commit builds `BufferedCommitPayload { read_dependencies: executed.reads, … }` at exactly the three cited lines (`src/local.rs:11111`, `:11568`, `:11797`), and `executed.reads` is `Vec<CapturedReadDependency>` by construction (`src/runtime.rs:277`). The type system makes declared-name flow into invalidation structurally impossible; I found no declared-reads consumer in any invalidation path (Cloudflare arm included — no independent `read_dependencies` handling exists under `cloudflare/`), only the two secret-scope wideners (`src/admin.rs:1774`, `src/host_ops.rs:1444`). The critique's premise is false as the doc says, and D1's relocation from runtime-correctness to artifact-trustworthiness is the right consequence.
- **The three checkable pins are exact.** `guide/operating/host-ops.md:72` says precisely "pinned but unbuilt" for `acceptance.run` (mirrored in `src/host_ops.rs:55`); `llp/0115-convex-parity-course-corrections.plan.md:435` says precisely "Open (claimed by no move; rides its custody trigger)"; `src/admin.rs:1781` is the only `captured_reads` field access outside `local.rs` (the `capturedReads` string at `src/storage.rs:11067` is a conflict-detail key on a local parameter, not a consumer of the field).
- **The FunctionRunResult anchor is exact**, including the Valet "counts stuck at zero" doc comment (`src/local.rs:1440-1447`) and both set pairs on the struct.
- **The 0127-decision-6 posture is correct.** The decision record (`llp/0115:922-930`) says declared reads/writes REMAIN evidence and "ceiling enforcement is sequenced as its own later decision, decoupled" — D1 strict mode is exactly that decision, taken as opt-in, with the new-app default honestly reopened as OQ1. The `inline-helper-sharing.test.mjs:7` quote is verbatim.
- **The declines are argued, not asserted.** Verified supporting facts: LLP 0097 does state exhaustive egress mediation as a prerequisite (`0097:42,62`); LLP 0062 does list `--transcript` under future work (`0062:664`) and binds replay to settlement identity (`:434-444`); LLP 0054 does recommend the seeded simulator with safety/liveness phases; the comparator profile does carry actor/observer identities (`packages/snapback-cli/comparator-profile.mjs:348-357`); no existing suggestion machinery collides with D7. The C13 decline (bytes not tokens) and the auto-aliasing decline are the strongest reasoning in the document.
- **Scope discipline is good.** No proposed decision is secretly two (D1's three surfaces are explicitly staged across waves; D7's merge is named); open items are named as open (seven OQs, including the CV-14 custody question the 0115 trigger requires).

## Findings

**MATERIAL-1 — "Query explain — Shipped" and "checkpoint … implemented in `src/host_ops.rs`" are false**
§Summary and §"What already ships". The Summary asserts "Mutation dry-run, query explain, and checkpoint are implemented in `src/host_ops.rs`," and the table lists "Query explain | Shipped." In fact `function.explain` serves *only* `mutationDryRun`; `queryPlan` and the permission/capability kinds refuse with "pinned by LLP 0024 but not built yet (mutationDryRun is served)" (`src/host_ops.rs:1686-1725`; the guide says the same at `guide/operating/host-ops.md:66`). No query explain exists anywhere else. Checkpoint is not in `src/host_ops.rs` at all; the shipped affordance is `snapback auth backup`/`auth restore` (`src/cli.rs:900-907`), and the table's own witness "`checkpoint` in `src/local.rs`, `src/auth/backup.rs`" resolves to crash-injection checkpoint helpers (`src/auth/backup.rs:1533-1599`) and migration `checkpoint_label` fields — not an agent-facing checkpoint verb. This also overstates "LLP 0019's recommended sequence is substantially executed": step 4's explain-denial half (`llp/0019:333`) is unbuilt. Fix: row "Query explain" becomes "Partial (mutationDryRun only)" or moves to the pinned-but-unbuilt class; the checkpoint row's witness becomes the backup/restore surface; the Summary sentence is corrected.

**MATERIAL-2 — D1's per-invocation `overDeclared` verdict is semantically wrong as specified**
§D1 surface 1. Report mode says *every invocation* emits `conformant`/`underDeclared`/`overDeclared`, with `overDeclared` = "declared entries never witnessed." A handler that reads table B only on one branch will be `overDeclared` on every invocation that doesn't take that branch — per-invocation absence is not over-declaration, it is conditionality. Over-declaration is only decidable at aggregate scope, which the document itself already places in D2's coverage surface ("declared dependencies never witnessed by *any* acceptance path"). As written, report mode's third verdict is noise-by-construction and would teach agents to distrust the very conformance signal D1 exists to create. Fix: report mode emits `conformant`/`underDeclared` plus the raw unwitnessed-this-invocation set as data; `overDeclared` becomes a coverage-scope verdict only, and the acceptance line is rescoped accordingly.

**MATERIAL-3 — D1's refusal codes are assigned to LLP 0144's registry, which scopes itself to app codes**
§D1 cost line ("two refusal codes (LLP 0144's registry)"). `SNAPBACK_HANDLER_UNDECLARED_READ`/`_WRITE` are platform-minted host refusals. LLP 0144 is the registry for *application-declared* codes carried under `SNAPBACK_APP_REFUSAL` with `appCode`; it explicitly distinguishes platform-code registry gaps as a different thing ("that ticket's recorded gaps are *platform*-code registry gaps," `llp/0144:135-137`), and platform codes are governed by the LLP 0010 diagnostic-code discipline. OQ6 correctly leaves D7's remediation-registry home open, but D1 asserts the wrong home as settled. Fix: cite the platform diagnostic-code discipline (LLP 0010 family) for the two new codes, or open the registry question explicitly.

**MATERIAL-4 — D5 never engages the LLP 0110/0134/0135 relation family, which declined the ground `existsRelation` builds on**
§D5. The claim that the four v1 classes are "the classes not already covered by uniqueness constraints, transaction read sets, and the membership-transition invariants" omits the closest shipped neighbor: the bounded parent/child relation profile, whose manifest already carries framework-owned relation declarations (`RelationIncarnation { foreign_key_field, parent_table }`, `src/manifest.rs:836-840`), whose *only* parent-deletion policy is `hide-orphans.v1`, and which explicitly excludes "referential constraints, cascade deletion, or orphan cleanup" (`llp/0110:169, :329-333, :917`). `existsRelation` with `onTargetDelete: 'restrict'` is precisely a referential constraint on that family's territory, and the interaction is real: a restrict invariant layered on a relation whose read profile *hides* orphans produces two coexisting deletion semantics on the same shape. Maybe the resolution is easy (D5 targets un-promoted ad-hoc relations; promoted relations keep hide-orphans), but the document must say so, and LLP 0110/0134/0135 belong in Related. This is the one place where "does anything it proposes already exist, in part?" gets a partial yes that the document doesn't surface.

**DETAIL-1 — LLP 0144 is in Review, not Draft**
§"What already ships" table row "Declared app refusal codes | Draft." `llp/0144:4` says `**Status:** Review`.

**DETAIL-2 — The recent-invocation ring is implemented, not merely "Specified"**
§"What already ships" row and D1 surface 1. The ring ships: `RECENT_INVOCATIONS_CAPACITY = 128`, surfaced as `data.recentInvocations`, bounded-ring tests (`src/host_ops.rs:57-105, :1893`). This strengthens D1's plumbing claim, but note the ring records *host operations* only ("One recorded host operation," `src/host_ops.rs:63-64`) — D1's "every function invocation … without instrumenting anything" needs the app-data plane wired into it or a scoping caveat.

**DETAIL-3 — "Five candidates are explicitly declined or deferred" vs six adjudicated**
§Summary vs §Declined and deferred. C8–C13 is six candidates; the count of five works only if C8 is bookkept as "partially absorbed," which the Summary doesn't say. Also "Declined 2" is titled Declined but disposes as "deferred, opt-in."

**DETAIL-4 — D3's `--changed-since <digestHash>` mechanism is unexamined**
§D3. Serving a delta against a prior digest *hash* requires the server to reconstruct what that digest contained (persisting digest-hash → generation/state identity, or having the client present the prior digest). Since this flag is "where most of the token saving actually lives," the mechanism question belongs in OQ3 or the D3 body.

TOOL_USES: 48
