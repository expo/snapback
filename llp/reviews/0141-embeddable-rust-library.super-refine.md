# LLP 0141 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-01: "Do an /llp-super-refine
on 0141 now." The target had been authored and pushed earlier in the same
session (`11dddced`) in response to Charlie's question about PocketBase's
Go framework/toolkit mode: "Would it be reasonable to make Snapback usable
as a Rust library in a similar fashion?"

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as
> much as, not the same as, "there are no flaws in this."

The target is a Draft RFC, so it may leave decisions open — but every open
item must be named as open rather than smuggled past the reader as settled,
and every factual claim about the codebase or the corpus must be true.

Loop mechanics as in the 0116–0128 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`,
read-only sandbox), mutually blind on 0141 artifacts, SHA-pinned targets
and instruction capsules, verify-then-fix passes between rounds,
delta-scoped later rounds in which each family sees only its own prior
artifact. The loop cannot advance the target beyond Draft; adjudication is
the author's.

**Author self-verification** runs alongside each round: reviewer findings
are checked against the tree before they are applied, and the author's own
pre-verification pass runs concurrently with the reviews.

## Round 1 — 2026-08-01

Instruction capsule SHA-256 (shared by both families):
`aab53ab2382e01f9f56e270700672c2d7c18c911b1c76754eff1625ece91c52f`

Target SHA-256 (v0.1, as pushed at `11dddced`):
`99c041264c2ae48712c8cfbcc4971e9c02ee0dfa11e8b7b4d6827a50619ed88c`

Repo revision at review start: origin/main `11dddced`.

Verdicts and dispositions are appended as reviews are actually received; no
review is recorded by intent.

### Round 1 results

**Both families NOT READY.** Codex returned five BLOCKING and four
MATERIAL; Fable returned one BLOCKING, seven MATERIAL, and six DETAIL.
Both independently verified the document's file:line anchors and found
them near-uniformly exact, and both confirmed the central architectural
argument (keep the router private, expose policy-carrying registration)
as sound and correctly grounded in LLP 0060 §D1 and LLP 0031 §Enforcement.

The families converged, independently, on the document's central defect:
**the handler-capability-bridge inventory was wrong, and a design decision
was built on the error.** The RFC listed ten of the twenty-one operations
`handle_host_call` actually dispatches, then proposed a namespace rule
reserving `db.*`, `runtime.*`, `permissions.*`, and `host.*` as
first-party — leaving the four namespaces it had failed to enumerate
(`jobs.*`, `assets.*`, `membership.*`, `action.*`) open to third-party
collision. The author's own pre-verification pass had independently found
the same inventory gap while the reviews were running.

Both families also converged on: the incomplete reserved-path denylist
(and Fable's sharper form of it — that a hand-maintained reserved list is
*itself* the "second route-literal list that can drift outside policy" the
RFC quotes approvingly against); the false claim that "the entire
acceptance suite drives it in-process"; the overstated "eleven independent
axes"; and the per-instance registry problem created by `route_registry()`
being an argument-free process-global projection while `SnapbackApp`
discards its registrations.

**One material divergence.** Fable recorded "D6 is accurate" as a strength;
Codex returned D6 as BLOCKING and substantially understated. The author
adjudicated in Codex's favour after verifying its specific claims:
`vendor/ibex/Cargo.toml` does itself carry path-only dependencies
(`capsec-semantics`, `ibex-sfe-format`, `ibex-sfe-catalog`,
`ibex-windows-dll-staging`), and `vendor/ibex/ios/Frameworks` measures
74 MB against crates.io's 10 MB compressed package limit. Fable checked
that the bare path dependency was a real blocker and stopped there; Codex
checked what would happen after that blocker was removed. Both were
accurate about what they examined; Codex examined more.

**Findings unique to one family, all adjudicated as correct and applied:**

- Fable MATERIAL-4 — the D4 gap analysis omitted `AppState::from_snapback`
  (`src/admin.rs:1392`), `AppState::detached` (`:1408`), and
  `LocalSnapback::open` (`src/local.rs:3281`), all public today. Verified;
  D4's deliverable narrows to *production-posture* construction.
- Fable MATERIAL-5 — the one-line capability-index requirement is not
  implementable for external embedders, because `build.rs::emit_embedded_guide`
  bakes the guide from this repository at Snapback's build time. Verified.
- Fable MATERIAL-6 — D5 analysed authority but not availability: no
  execution budget, cancellation, or panic-containment analysis for native
  ops running on host threads.
- Fable MATERIAL-7 — the policy-carrying subtree-mount alternative was
  never considered. Adopted into v0.2 as a named-and-adjudicated
  alternative (rejected as primary because `ResponseSensitivity` and
  `EffectPolicy` are per-operation and a subtree envelope collapses to its
  most permissive member; retained as a fallback).
- Codex BLOCKING — D5's proposed capability-manifest row cannot distinguish
  a trustworthy stock server from native code capable of altering that
  report. Accepted; the claim is withdrawn in v0.2 rather than repaired.
- Codex MATERIAL — D3b understated what a host-op extension must join
  (LLP 0031's `OperationSpec` registry and policy axes, transport
  projections, envelope schema, guide surface-map checking, capability
  manifest), since `execute_host_op` is a closed dispatcher, not the
  registry itself.

**Author-verified before application.** Every finding applied was checked
against the tree first. Spot-checks that confirmed: `policy` documented at
`src/server.rs:6986` as a compatible spelling of `path_policy` that the
router refuses when unequal; `RouteSpec::new` defaulting `effect_policy`
and `session_overlay` (refuting v0.1's "no defaulted or inferred variant");
the unreserved first-party prefixes `/action/*`, `/app/*`, `/assets/*`,
`/client-mutations/*`, `/connection*/*`; `tests/acceptance/*.mjs` spawning
the server binary as a child process. No applied finding was refuted.

### v0.2 fix pass

Applied all round-1 findings. The substantive changes, beyond the factual
corrections:

- **Reservation by mechanism, not enumeration.** Both the route-path rule
  (D2b) and the operation-namespace rule (D3a) abandon enumerated
  denylists in favour of a dedicated extension prefix or a refusal derived
  from `all_route_registrations()`. The v0.1 failure is cited in the RFC
  itself as the argument: two of the four missed namespaces entered the
  bridge within the last month, so any enumeration is stale on arrival.
- **The registry becomes a build artifact** (D2a), recorded as a real shape
  change to a load-bearing invariant rather than an additive API.
- **D3a gains two mandatory registration requirements** — budget/deadline/
  cancellation semantics, and an error/panic containment contract — and
  four further semantics are moved into named open questions rather than
  left implicit.
- **D7 added: scope discipline.** Both families observed, in different
  words, that v0.1 decided four surfaces while having evidence for one.
  v0.2 proposes only D1, D4, and D5-as-constraint for acceptance;
  D2 and D3 are designed but demand-gated on a named consumer; D6 is
  blocking and unscheduled.
- **Open questions grew from 6 to 17**, organised by decision.

v0.2 SHA-256:
`a82d1c6b6bfd737c126e2f96f79abcf3c8c4bad716e9ed1857afbd9d4bcf7dd6`
(530 lines; `ref-check` clean at 143 LLP docs, 0 errors).

## Round 2 — 2026-08-01 (delta-scoped)

Each family receives only its own round-1 artifact, preserving mutual
blindness while allowing a disposition check. The capsules are otherwise
identical.

Instruction capsule SHA-256 (Codex):
`52bd6394736e8ec2f03a586a5a3c84ff64903a087c717c3666e154c5ec4db16e`
Instruction capsule SHA-256 (Fable):
`3769922210c609b86611e0f4e8849204f54ac1b1261ce214a356233e6636c0dd`

Target SHA-256 (v0.2):
`a82d1c6b6bfd737c126e2f96f79abcf3c8c4bad716e9ed1857afbd9d4bcf7dd6`

Round scope: disposition of each round-1 finding; new defects introduced
by the v0.2 revision (with the corrected inventories re-verified rather
than assumed); and an explicit judgement on whether surviving unchanged
text is clean — the delta-review stopping-rule signal.

### Round 2 results

**Fable READY; Codex NOT READY** — the loop's only split verdict.

Fable dispositioned all thirteen of its round-1 findings RESOLVED, none
partially, and judged the surviving unchanged text clean. Codex
dispositioned all fifteen of its round-1 items RESOLVED or
RESOLVED-BUT-NEW-DEFECT and returned four MATERIAL findings.

Two of Codex's four were independently found by Fable as DETAILs — real
convergence on residues the v0.2 corrections had missed:

- **The handler bridge accepts 22 operation names across 21 arms.**
  `action.externalEffectBegin` and `action.externalEffectInitiated` share
  the arm at `src/runtime.rs:1819`. v0.2 corrected the missing namespaces
  and still miscounted the names — the same failure mode, one layer down,
  in text that claimed to be a complete re-verified inventory.
- **The corrected constructor inventory still omitted
  `AppState::from_snapback_with_secret_read_operator`**
  (`src/admin.rs:1399`, public, doc-commented as a trusted embedding
  variant), which specifically weakened D4's claim that "secret-read
  operator wiring" was missing. The seam is already public; what is
  missing is the *composed* production-posture constructor.

Codex's two unique findings were the more valuable ones, and both
verified:

- **The motivation table still priced "single portable executable" as
  low-cost** while D6 and OQ17 held the question open. Author
  verification against the built binary confirmed it: `target/debug/snapback`
  links `@rpath/hermesvm.framework/Versions/1/hermesvm` and carries both
  `@loader_path/../Frameworks` and *absolute* `LC_RPATH` entries into the
  developer's own checkout. The artifact is not portable today.
- **D7 contradicted the Summary on the proposed-decision set** — Summary
  said D1/D4, D7 said D1/D4/D5, and D5 carried a bold Decision. Load-bearing
  because D7 exists precisely to say what the Draft proposes now.

Fable recorded one further DETAIL: `ibex-windows-dll-staging` is an
unconditional `[build-dependencies]` entry, not a conditional one.

### v0.3 fix pass

Five delta-confined edits: the affordance row split into bundle-baking
(low cost) versus one-portable-file (D6 program) with the Mach-O evidence
recorded; the 21-arm/22-name counting convention stated and the aliased
name added; the fourth constructor added and D4's gap narrowed to the
*composed* constructor; the `ibex-windows-dll-staging` correction with
line anchors for the whole Ibex path-dep graph; and the decision set
stated consistently as D1/D4/D5, resolved in favour of three because D5
is normative — it constrains everything built later, so it is accepted
alongside what it governs rather than deferred with D2/D3.

v0.3 SHA-256:
`9853021d1baeb60d83568859251791962b6b2353e49d74b7f3c1138d260edea5`
(571 lines; `ref-check` clean).

## Round 3 — 2026-08-01 (delta-confined)

Instruction capsule SHA-256 (Codex):
`76a3a33245e83206803c6532663a442dcd6dfdb7ce8e1484aedc3ac8e241ac97`
Instruction capsule SHA-256 (Fable):
`a20d0d4a076f478eedcbdf9aa2ff893577a5318ed50ef09464b3f17d56a2634a`

Target SHA-256 (v0.3):
`9853021d1baeb60d83568859251791962b6b2353e49d74b7f3c1138d260edea5`

### Round 3 results

**Fable READY; Codex NOT READY** — but neither family found a new design
defect. Every finding was an incomplete propagation of a round-2 fix:

- Codex, two MATERIAL: the Summary's constructor list had not received
  the four-constructor correction applied to §Current state and D4; and
  D7's *heading* still read "decide two" while its body, the Summary, and
  the ledger all said D1/D4/D5. Both were author error — the same fix
  applied in two of three places.
- Fable, one DETAIL: the `handle_host_call` range citation overshot by
  six lines; the function closes at `src/runtime.rs:2124`.

Codex explicitly recorded that no wholly new technical or codebase-factual
defect was introduced by the five v0.3 edits, and that the round-2
one-file finding was settled. Fable recorded the surviving text settled
and noted the defect series was strictly decreasing.

Incidental finding worth keeping: Fable observed that the *release*
binary's absolute `LC_RPATH` points into a `.claude/worktrees/fastpath-018`
checkout rather than the main one — an accidental live demonstration that
the built artifact hard-codes whichever checkout compiled it. This
strengthens D6/OQ17 rather than changing it.

### v0.4 fix pass

Three mechanical edits: the Summary's constructor list expanded to four
with the "composed production-posture" phrasing; D7's heading corrected
to "decide three, gate the rest"; and the range citation corrected to
`src/runtime.rs:1273–2124`.

v0.4 SHA-256:
`e82676d014cb862541e2b97f1c43de547259cb0194affdebbad3953a964ac51a`
(580 lines; `ref-check` clean at 143 LLP docs, 0 errors).

## Round 4 — 2026-08-01 (delta-confined)

Instruction capsule SHA-256 (Codex):
`6968c0b55d0e4a98c68d2af10876dbae3bac6d4ac683c3b7c045bf3bed3479c1`
Instruction capsule SHA-256 (Fable):
`3a753e9f726b44dbb5da5a159d9a2774626775f898cf6201146087ca50f76d76`

Target SHA-256 (v0.4):
`e82676d014cb862541e2b97f1c43de547259cb0194affdebbad3953a964ac51a`

Round scope: disposition of round-3 findings; whether the three v0.4
edits introduced or left any defect; and whole-document sweeps for stale
constructor lists, decision counts, and range citations.

### Round 4 results — CONVERGED

**Both families READY. Both report zero findings at any severity.**

Codex: both round-3 findings RESOLVED; consistency sweeps found no
remaining active instance of the old three-constructor inventory, the old
"decide two" count, or the stale `:1273–2130` range, with historical
references surviving only in the `Revised:` ledger where they accurately
describe prior versions. Stopping signal: "Settled."

Fable: its round-3 finding RESOLVED; it additionally pressure-tested the
one place the Summary edit could have introduced a new defect — whether
"four public constructors already exist" overclaims given that
`AppState::new` is also `pub` — and confirmed it does not, since the
sentence asserts existence rather than exhaustiveness and §Current state
names `AppState::new` separately. It also confirmed
`new_with_secret_read_operator` (`:838`) is `pub(crate)` and correctly
excluded. Stopping signal: "Settled… further review rounds would test
nothing."

**Defect series across four rounds, both families independently:**

| Round | Fable | Codex |
| --- | --- | --- |
| 1 (v0.1) | NOT READY — 1 BLOCKING, 7 MATERIAL, 6 DETAIL | NOT READY — 5 BLOCKING, 4 MATERIAL |
| 2 (v0.2) | READY — 3 DETAIL | NOT READY — 4 MATERIAL |
| 3 (v0.3) | READY — 1 DETAIL | NOT READY — 2 MATERIAL |
| 4 (v0.4) | **READY — 0** | **READY — 0** |

Every correction at every round independently re-verified as correct
against the tree. No applied finding was refuted at any point.

## Disposition

The loop converged at v0.4 on dual-READY. **The document remains Draft.**
The loop cannot advance status; adjudication is the author's.

What the loop settled: the as-built description is accurate, the central
architectural argument (private router, policy-carrying registration)
survived adversarial review from both families intact, and the scope is
now honest about the evidence — D1, D4, and D5 proposed; D2 and D3
designed but demand-gated; D6 blocking and unscheduled.

What the loop did *not* settle, and cannot: **OQ1 — whether any embedder
profile beyond test and tooling is real.** No request for one exists in
the corpus. Both families accepted the demand-gating as honest, but
honesty about absent evidence is not evidence. If OQ1 answers "no," D2
and D3 should not be built regardless of how well designed they are, and
the RFC's durable value is D1, D4, and the D6 program inventory.

Seventeen open questions stand. The author's next decision is OQ1, not
any of the design questions beneath it.

