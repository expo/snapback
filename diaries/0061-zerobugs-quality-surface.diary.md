# 0061 — Zerobugs quality-surface program (LLP 0183)

**Date:** 2026-08-05
**Systems:** Acceptance benchmarking, relational queries, local sync, program orchestration
**Related:** `llp/0183-zerobugs-quality-surface.rfc.md`,
`llp/0182-zerobugs-snapback-parity.research.md`, `demos/zerobugs/`,
`llp/0138-zero-replicache-bakeoff.plan.md` (evidence conventions)

This diary tracks the LLP 0183 acceptance program: building a Snapback-backed
Zerobugs to the pinned Zero application's quality bar. Entries are dated and
append-only; the Stage 0.5 control build and later provider arms will append
here.

## 2026-08-05 — Stage 0: freeze and reconcile

Orchestration: Claude Fable 5 supervising; all analysis/authoring jobs ran on
Codex gpt-5.6-sol (xhigh for verification/inventory/manifest, high for
scaffold). Four codex jobs, each reviewed before landing.

What was done:

1. Pinned `rocicorp/mono@25c2c73` (sparse `apps/zbugs` + `packages/zero`),
   with a reproducing fetch script and sha256 digests of the ten contract
   files (`demos/zerobugs/scripts/`, `stage0/source-digests.v1.json`).
2. Re-verified every LLP 0182 [source] claim against the pin
   (`stage0/0182-claim-verification.v1.md`). Four factual discrepancies
   found and corrected in 0182; 0182 promoted Active.
3. Produced the exact demand inventory (`stage0/inventory.v1.json`/`.md`):
   10 tables, 22 relationships, 19 queries, 16 mutators, 9 routes, 8 effect
   triggers, fixture/topology demands, and 12 notable findings.
4. Froze the D1 acceptance manifest (`manifest/acceptance.v1.md`/`.json`)
   with margins explicitly deferred to evidence, a proposed primary-improvement
   candidate awaiting ratification, and a pinned-defect policy.
5. Recorded workstream owners/dependencies/timeboxes
   (`stage0/program-plan.v1.md`) and updated LLP 0183's status.

What felt good:

- **The verification pass earned its cost immediately.** Codex xhigh did not
  just cross-read prose — it replayed the pinned synthetic generator's count
  logic and caught that `SYNTHETIC_DATA.md`'s advertised ~4.5M-row default is
  actually ~5.53M rows (2,527,886 comments, 2,000,370 issue-label rows), that
  `LABELS_PER_ISSUE` is dead configuration, and that the generator is
  date-anchored rather than fully deterministic. I independently re-derived
  the comment count to the exact row before freezing it. Those numbers are now
  fixture contract; discovering them mid-Stage-4 would have invalidated runs.
- **Inventory-before-manifest sequencing worked.** The manifest could bind
  every required-surface row to exact inventory entries instead of prose
  hand-waving, and the notable findings (pinned-app security defects) forced
  an explicit policy decision — reproduce the defect or declare the safer
  intended behavior — before any arm exists, when it's still cheap to be fair.
- **The pinned app has real defects worth knowing about**: child queries
  (`commentsPage`, `comment`, `emojiChange`) skip parent visibility, the
  unsubscribe route is an unauthenticated state-changing GET, notifications
  are post-commit but non-durable, upload limits are browser-only. The
  manifest's defect policy scores a fail-closed Snapback arm as PASS with an
  intentional-improvement note rather than a fidelity failure.
- **Environment freezing by probing, not guessing.** The manifest's browser/
  machine facts (Chrome 150.0.7871.187 arm64, M5 Max 18-core 128 GiB,
  macOS 26.5.2) were read from the actual machine; I spot-verified each.

What felt bad / friction:

- **The mono sparse clone is the easy part; the fixture is not.** The
  large-profile contract needs a one-time controlled generation at a frozen
  timestamp (the generator anchors timestamp ranges to `new Date()`), and the
  generator covers only six of ten tables, so the manifest had to invent a
  deterministic overlay derivation (`large-overlay-v1`) for
  viewState/emoji/userPref/issueNotifications. That is contract surface the
  pinned repo simply doesn't provide.
- **LLP 0182 carried plausible-but-wrong numbers through two authorial
  reviews.** The 3M/1.5M/4.5M figures came from the pinned repo's own
  documentation, which disagrees with its own executable. Lesson: for
  benchmark-grade facts, verify docs against executables even in the
  source-of-truth repo.

Open author decisions (flagged, not decided): OQ13 orchestration owner, the
durable-disconnected-intent "better"-claim candidate (manifest §13), owner-Spec
authors for D2/D3/D4/D6, and LLP 0183's own acceptance review.

Next: Stage 0.5 — build the complete source-faithful control app on the current
shipped Snapback surface, run every applicable ZB gate, and retain PASS/GAP
receipts plus the lowered mutation corpus.

## 2026-08-05 — Stage 0.5 kickoff: control plan + scaffold

Codex gpt-5.6-sol xhigh produced `demos/zerobugs/control/`: a 400-line build
plan (per-query and per-mutator lowering tables, a predeclared 13-entry
workaround/component register each mapped to the D-workstream that would
remove it, lane sequencing with acceptance checks) plus a validated scaffold —
ten-table schema generates cleanly, React boot typechecks and builds.

Experience notes:

- **The guide's paved path held for scaffolding.** `defineSchema`/`defineTable`
  with typed `v.id()` references, `snapback generate`, and the Vite plugin all
  worked first try from the guide alone. One ambient-type gap
  (`virtual:snapback/dev` needs a hand-added `src/snapback-dev.d.ts` in a new
  app) is a candidate guide gap.
- **Stored fields reject literal-union validators** (`SCHEMA_INVALID_VALIDATOR`
  for `v.union` of literals), so the source `role`/`visibility` enums store as
  strings with duplicated closed-domain guards at every write boundary
  (`W-ENUM`). A portable stored-enum domain would remove a whole workaround
  class.
- **Runtime readiness is honestly blocked, not skipped:** `snapback verify`
  fails `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` (packaged: absent;
  target/debug: binary-drift). Schema admission and acceptance lanes wait on a
  re-qualified runtime; the plan records this rather than treating artifact
  freshness as a live-load claim.
- **Source-id vs typed-id duality is the first real representation tax.** The
  pinned app's public `id` strings must survive exactly (URLs, mutation args)
  while Snapback's prefixed `_id` is the physical reference; every fixture and
  adapter carries the mapping.

Next jobs (per PLAN.md sequencing): fixtures + support schema, local
auth/identity composition, then the 19-query corpus.

## 2026-08-05 — Lane 1: fixtures, support schema, and two runtime bugs

Lane 1 (fixtures + support schema) is complete: deterministic compiler for
normal-seed-v1 + policy-extension-v1 (3,758 rows, byte-identical reruns),
six support tables, read-model builders with rebuild digests, a ≤900-row
batched `fixtureIngestBatch` loader (the versioned-seed path refuses at
1,024 effects, correctly), and a full live load whose observed digest equals
the frozen contract digest byte-for-byte.

The control keeps catching real bugs before any provider arm exists:

1. **Sessions-app verify admission** (fixed earlier today): codegen's
   artifact index hardcoded `snapback.v0` against `snapback.v1` sessions
   manifests — every sessions app failed `snapback verify`.
2. **Silent 16 KiB string truncation on JS results**: a pinned 44,084-char
   comment body stored intact but read back clipped to exactly 16,384 chars
   with no diagnostic — successful results were serialized through the
   bounded *failure-metadata* replacer. Storage was innocent; the bridge
   read was innocent; the result serializer lied. Fixed to keep LLP 0108's
   declared ceilings as the only bounds, with bridge-level and
   handler-roundtrip regressions.

Friction worth keeping:

- `session mint` is admin-gated and the token carrier lives behind the
  readiness descriptor's `adminTokenFile`; nothing connects these dots in
  the guide (filed `issues/20260805-guide-gap-large-acceptance-fixture-
  loading.md`, which also covers the batch-ingest pattern existing only as
  zero-bakeoff folklore).
- The query surface returns unset optionals as explicit `null`; every
  digest/comparison layer must canonicalize null-vs-absent once, early.
- Codex's sandbox cannot bind loopback, so every live-server validation ran
  twice: once to honest BLOCKED inside the sandbox, once for real outside.
  The supervising session doing the live reruns is the working pattern.

## 2026-08-05 — Lane 2: auth and identity composition

Lane 2 landed: identityBinding flow (five deterministic dev-session actors
bound to the frozen source users), reusable principal/crew/visibility/
ownership guards for Lanes 3–4, and a nine-check live harness — all PASS
against a fresh server and full fixture load. Notable: the shipped sessions
surface covered everything Lane 2 needed (mint, logout route, bearer
replacement); the only new app code is the acceptance-gated binding mutation
and guards, all counted under W-IDENTITY. The broad fixture inspector now
closes permanently once actor binding begins, so Lane 1's loader convenience
cannot become a ZB4 leak.

## 2026-08-06 — Lane 3: the 19-query corpus, and a third repo bug

Lane 3 landed: all 19 frozen queries on the shared list-predicate engine
(read models + all-label intersection + maintained search documents), with
an independent parity oracle recomputing pinned semantics from raw fixture
JSON — 16/16 live checks PASS including bidirectional keyset walks,
permalink not-found proofs, crew-only internal visibility, and gated child
roots.

Two capability boundaries surfaced honestly: route-cut query groups accept
`routeParam` bindings only from generated declarative queries, so the
control's JS-authored graph queries cannot join a route cut (recorded under
W-QGROUP; a generated D2 graph would restore it); and the third real repo
bug of this program — anonymous-public custody sent legacy `auth` body
fields because the wire-body strip was gated on a handshake that anonymous
custody deliberately skips. Sessions servers refused every anonymous public
query. One-line client fix + regression; the control's actor matrix caught
it because it exercises anonymous alongside five bound actors on every
protected surface.

The post-merge own-correctness rerun caught one evidence-only contradiction:
the Lane 3 amendment and runtime result removed `snapback/routes.mjs`, but the
new pure test and earlier plan rows still required its generated manifest.
Those witnesses now match the actual refusal-first outcome, and codegen's
tracked artifact index is regenerated from the route-free source.

## 2026-08-06 — Lane 4: the 16-mutator corpus

Lane 4 landed after an interrupted-and-resumed codex run (the resume picked
up the partial schema work cleanly): all 16 authoritative mutators with
pinned id/timestamp semantics, same-transaction read-model maintenance,
dependent cleanup, and durable notification intents for exactly the eight
trigger operations — 18/18 live checks PASS including refusal/no-partial-
write, observer convergence, and replay idempotency. Learning: app tables
mint generic `id_` physical ids (no per-table prefix surface; LLP 0148
reserves named prefixes for built-ins), and the functions manifest omits
fields rather than nulling them — both caught as harness-expectation bugs,
not corpus bugs, by the cascade pattern of the failures.

## 2026-08-06 — Lane 5: composition gateway and durable effects

Lane 5 landed (after one interrupted-and-resumed codex run): the versioned
control composition — all nine pinned routes with the manifest §8 safety
amendments (signed-token POST unsubscribe, server-enforced upload policy),
plus durable effect delivery consuming Lane 4's intent rows with
exactly-once capture, fenced retries, and explicit ambiguity — 16/16 live
checks PASS. The live run surfaced four instructive integration facts:
required config entries hold the sessions auth-mode transition pending (so
app data refuses until secrets are set — right behavior, surprising
ordering); `ctx.fetch` returns the host JSON result rather than a Response;
the composition manifest's pinned release identity correctly refuses a
regenerated-but-unsynced gateway start; and compiled-fixture reference
fields are `_id` placeholders. None required runtime changes — Lane 5's
bugs were all in the new lane's own code/harness, a first for this program.
