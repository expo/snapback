# LLP 0175: Local-proof economics and verdict latency

**Type:** RFC
**Status:** Accepted
**Systems:** Testing, Developer experience, Build, Tooling, CI
**Author:** Claude (Opus 5) / Codex (GPT-5) / Charlie Cheever
**Date:** 2026-08-05
**Revised:** 2026-08-21 (gate-execution honesty correction and review closure:
every selected gate now has a finite wall-clock budget parsed by one canonical
decimal contract, timeout is structurally distinct from a natural exit 124,
TERM/KILL target the gate process group, signal-aware acceptance cleanup owns
known session-escaping resources, and bounded capture readers loudly retain
unknown survivors as `timeout-cleanup-failed`; the Rust workspace gate also
disables Cargo's target-level fail-fast behavior.)
**Revised:** 2026-08-11 (LLP 0232 accepting change, author ruling in session:
the 2026-08-07 D2.1 ruling gains four narrowings — baseline-corroborated
infrastructure fail-open, receipt-validated reuse for trigger-matched gates,
content-caused prepare failures reclassified as content, and runner ticket
requests via an authorized source-ticket publisher — each effective only when
its implementing change lands; registry contract gains per-gate semantic
input closures and execution receipts. See the dated ruling block in D2.1.)
**Revised:** 2026-08-13 (optimistic-landing amendment, author ruling by Charlie
Cheever in session: ordinary `origin/main` pushes keep checked frozen-record
selection but defer execution to the scheduled backstop; non-main refs receive
no scheduled-main claim; `SNAPBACK_DRIFT_GATES_STRICT=1` retains the complete
synchronous classifier; the backstop now shares D-3 classification and
same-closure contradiction detection; full and bypass spellings remain
compatible; D2.2–D2.4 and release qualification are unchanged.)
**Revised:** 2026-08-05 (first implementation tranche: Phase 0's named timed
gate runner, dependency-aware keep-going, dependency inventory, and retained
JSONL artifact land together with D3.1 doctor reuse, D3.2 clean exact-
revision bootstrap receipt reuse, and D3.3 measure-before-clean behavior;
cadence selection and remaining D3 work stay
open). 2026-08-10 (the author-ruled historical diary alias map gains a strict
registered drift gate, so new numeric identity collisions are blocked on
triggering pushes and ticketed by the scheduled backstop). 2026-08-05
(whole-document rewrite: adds affected-test cadence,
dependency-aware keep-going, workflow amplification, receipt cadence, and
test-governance findings; demotes unproven Cargo parallelism and test-target
consolidation from primary remedies). 2026-08-06 (first Phase-2 cadence slice:
telemetry full evidence moves to a six-hour/on-demand coalesced latest-head
producer; retained receipt integrity no longer requires a quiet main, while
exact-current evidence remains
mandatory for release and capability promotion. LLP 0154 carries the amended
trust contract). 2026-08-06 (accepted by co-author Charlie Cheever for
implementation and direct delivery; the affected-selector tranche follows.)
2026-08-06 (D2 selector implementation: a checked 131-gate policy binds the
exact diff and inventory, closes prerequisites, fails broad for unknown/shared
paths, preserves mandatory Contract/Exact and admin behavior, and replays four
historical defect diffs. Push/PR runs use affected selection; six-hour/manual
runs retain the complete inventory.) 2026-08-06 (ship-review corrections:
required Exact mode reaches frozen surface installs from a clean checkout;
Contract and harness owners select their direct fixtures; telemetry
exact-current release/promotion wiring is recorded as the dated follow-up
resolved by the 2026-08-07 amendment below; obsolete cadence prose removed;
main-push affected runs use
commit-unique concurrency so a replaced pending run cannot create an uncovered
diff gap.) 2026-08-06 (same-change frozen-record coupling: a tracked pre-push
hook runs only selector-registered drift gates for committed pushed paths;
unknown/shared authority fans out to the full drift registry, a loud emergency
bypass remains observable, and an independent latest-main detector files one
idempotent filesystem ticket per still-open drift.) 2026-08-06 (isolated gate
execution becomes environment-faithful: every installed `node_modules` tree
at a tracked project directory is mirrored without dirtying the checkout,
declared external modules and ignored prepared inputs are preflighted, prepared
native state is reused when available, and setup/unavailability exits as infrastructure rather than
misreporting a stale record. Refusal diagnostics print the regeneration command
before best-effort worktree inspection, so loss of Git context cannot hide the
repair path. Repository-local `GIT_*` variables inherited by hooks are removed
from nested Git and gate commands so a non-HEAD pushed commit is evaluated in
its detached checkout, not against the caller's index and HEAD.) 2026-08-06
(dependency isolation economics: a lock/manifests-keyed, atomically published
link-scaffold cache uses APFS clonefile with a portable fallback; workspace
links remain revision-relative, and only gates declaring a submodule pay its
initialization cost.) 2026-08-07 (LLP 0189 extends this document's cadence
design from CI to claim/publication gating: the scheduled complete battery is
the authoritative verdict, landing gates stay fast/affected, claims are
snapshots with scoped qualification digests, and reviews bind content rather
than HEAD.) 2026-08-07 (author ruling restructures the local drift-gate
economics: fail-closed pushes pay a measured fast core, per-gate baseline
failures are non-blocking pre-existing staleness, the hook pins Node without
wrapping gate exits, and a two-hour dedicated-clone backstop runs the complete
registry and files fix-forward tickets.) 2026-08-07 (exact-current telemetry
authority is wired into both real candidate publication and default-tag
promotion. The shared gate invokes the verifier at the frozen candidate
revision before registry mutation or promotion lease acquisition and retains
the assessment in release receipts; capability maturity currently cites and
consumes no telemetry evidence.) 2026-08-07 (LLP 0189 round-1 review
amendments: Acceptance #10 and D2.4's release-claim sentence are re-scoped to
the LLP 0189 D-6 form; D2.4's exact-current telemetry authority is preserved
under its D-7.) 2026-08-09 (fast-core provisioning correction: `rustfmt` and
`package-readme-funnel` move from the universal docs-only core to explicit
Rust-source and published-package owners. Additive Rust ownership preserves
the file's ordinary affected suite, while narrow Rust-toolchain and JavaScript-
dependency requirements provision only what the selected fast gate needs.)
**Related:** LLP 0010, LLP 0032, LLP 0109, LLP 0115, LLP 0145, LLP 0154,
issues/closed/20260802-local-proof-is-cancelled-before-it-can-finish-on-main.md,
issues/closed/20260802-verify-local-proof-stops-at-the-first-failure.md,
issues/closed/20260802-main-proof-greening-18-gates.md,
issues/closed/20260809-local-proof-docs-core-required-missing-toolchains.md

## Summary

Snapback's recurring proof has two separate economic defects:

1. a green canonical proof performs substantial redundant native work and
   takes about 48 minutes of job execution; and
2. the complete native, browser, package, demo, Cloudflare, and retained-
   evidence inventory runs at a cadence that does not match either the risk of
   the change or `main`'s deliberate burst landing cadence.

The first defect makes a full proof unnecessarily expensive. The second makes
even a much faster full proof structurally unable to provide a per-commit
verdict when the median gap between `main` commits is 0.1 minutes. The current
keep-going implementation adds a third failure-mode cost: after a producer
fails, dependent real-server tests can each wait for their own timeout and
report dozens of derived failures that add no new information.

This RFC keeps every maintained test and every acceptance obligation. It
changes four things:

- the proof runner becomes dependency-aware, continuing independent gates but
  reporting dependent work as `BLOCKED` instead of executing timeout cascades;
- recurring CI is divided into fast, affected, full-main, and release/platform
  cadences, with a checked and fail-closed path-to-suite map;
- redundant native builds and repeated behavior executions are removed; and
- timing, cache, failure, ownership, and unique-risk metadata become part of
  the test inventory so future proof growth has an explicit budget.

The target is not merely “a full proof under 20 minutes.” The product target is
useful feedback at the appropriate boundary:

- docs-only and static failures in under 3 minutes;
- ordinary affected-change verdicts in under 10 minutes;
- native affected-change verdicts in under 20 minutes;
- a complete latest-main inventory in under 30 minutes, without an unbounded
  per-commit queue; and
- no loss of nightly, release, platform, browser, historical-compatibility, or
  capability-advertisement coverage.

## Motivation and evidence

### Measurement method

Measurements come from GitHub Actions job metadata and timestamped
`[snapback-verify] $` markers in the `local-proof` logs. The primary green
baseline is run `30969572413` on 2026-08-05. The lane-health sample is the most
recent 300 repository workflow runs at the time of this revision, containing
44 completed `local-proof` runs.

The baseline separated three quantities that must not be conflated:

- **proof-step execution:** about 43.5 minutes;
- **whole-job execution including setup/bootstrap:** about 48.2 minutes; and
- **commit-to-verdict latency:** about 101 minutes for the baseline because
  the concurrency group delayed the job before it began executing.

The delay was concurrency-group blocking, not evidence that a runner was
unavailable. Faster execution helps it, but execution time alone cannot make a
universal per-push proof compatible with a 0.1-minute commit cadence.

### Finding 1 — cost is concentrated in seven gates

The baseline proof-step ledger is:

| Gate | Time | Classification |
|---|---:|---|
| versioned-seed conformance | 10.6 min | valuable cross-surface proof plus hidden Cargo/historical work |
| `ibex-doctor` | 7.6 min | disposable-target exact-link diagnosis |
| `cargo test` | 6.2 min | roughly 4.9 min build/link and 1.3 min execution |
| telemetry Phase-1 smoke | 5.7 min | separate feature-bearing Rust build and smoke |
| codegen package tests | 2.5 min | many test programs launched serially |
| `cargo clippy --all-targets` | 2.0 min | separate all-target compilation |
| Cloudflare local suite | 1.8 min | 29 explicitly inventoried suites |

Those gates account for about 36 of 43 proof-step minutes. The remaining
roughly 109 commands are mostly sub-second, with a few small real-server,
browser, package, and generated-artifact checks.

This supports two conclusions. Deleting Rust assertions is not a useful first
move: on the measured run, executing approximately 2,000 Rust tests took about
1.3 minutes. But “compilation is the whole problem” is also incomplete: a
10-minute compatibility corpus, a 6-minute feature smoke, workflow-level
duplication, universal cadence, and failure cascades remain material even
after compilation improves.

### Finding 2 — the recurring proof repeats native authority

The current workflow and proof establish closely related native facts several
times:

1. the workflow runs `scripts/bootstrap-ibex-runtime`, linking, launching, and
   qualifying a binary;
2. the proof issues or verifies readiness for an existing binary;
3. `scripts/ibex-doctor` builds into a deliberately disposable Cargo target to
   prove exact linking;
4. the proof runs bootstrap again;
5. telemetry smoke runs bootstrap and a feature-bearing Rust test build;
6. Clippy and the ordinary Rust suite compile their own target shapes;
7. CI cleans test artifacts; and
8. the proof builds and qualifies the final served binary.

These are not identical assertions, but their current implementations repeat
more work than their distinct claims require. The disposable-target doctor
probe is appropriate for bring-up diagnosis; inside a proof that already
builds and qualifies the final binary, it is redundant execution. A
digest-bound readiness receipt is useful only if later callers reuse its
answer instead of recompiling to ask the same question again.

### Finding 3 — the versioned-seed corpus hides two kinds of build work

The versioned-seed suite runs `cargo build --bin snapback` and a filtered
`cargo test --lib versioned_seed`, then builds or reuses an exact historical
predecessor in a temporary content-addressed directory. The predecessor cache
is local to the runner filesystem and is not restored explicitly by the
workflow.

The corpus is load-bearing: [LLP 0109](./0109-versioned-seed-evolution.spec.md)
§12 requires the shared case-by-surface matrix before the capability is
advertised. The waste is not the cases. It is rebuilding current artifacts
already produced by the caller, failing to make the immutable predecessor a
portable CI cache, and running the entire historical/cross-surface corpus for
changes that cannot affect its inputs.

The suite also captures Cargo output and prints it only on failure. That made a
multi-minute sub-build indistinguishable from test execution in ordinary logs.

### Finding 4 — keep-going violates its own dependency requirement

The issue that commissioned keep-going said that it must continue independent
gates but skip stages whose producers failed. The implementation instead
records a failure and returns success to the outer shell for every command, so
all later commands execute regardless of dependency.

This produces two harms:

- a missing, stale, or unqualified binary causes many real-server suites to
  wait for their independent startup deadlines; and
- the summary presents derived failures as peers of the root failure, making
  diagnosis noisier while consuming much more runner time.

Observed failed runs reported 24 or 33 gates after repeated approximately
90-second startup failures. Those executions did not test 24 independent
behaviors. They repeatedly established that one shared prerequisite was bad.

### Finding 5 — workflow cadence amplifies cost

`local-proof`, `linux-runtime-package`, `all-aboard-cold-clone`,
`required-surface-builds`, deployment identity, and `ref-check` all trigger on
every pull request and every push to `main`. A docs-only commit can therefore
request:

- the complete local native/browser proof;
- a Linux release-runtime build and cold install;
- an All Aboard registry cold clone and browser proof;
- every required web production build; and
- the small documentation/deployment checks.

The dedicated workflow twins are not individually the largest part of
`local-proof`, but together they keep `expo-large` busy for work unrelated to
the changed files. Three of the four green `local-proof` results in the sample
were successive executions of the same pull request before its merge; the
fourth was the merge itself.

The prior cancellation ticket already reached the correct systems conclusion:
landing cadence is fixed, so the proof must fit around it. Its option 3 — fast
per-push checks and slower latest-main cadence — was stronger than the eventual
one-setting resolution. Setting `cancel-in-progress: false` restored some
verdicts, but it did so by accepting continuous execution and delayed results.

### Finding 6 — retained evidence and recurring executable smoke are distinct

The telemetry gate has three modes:

- `--check` validates a committed, source-bound receipt quickly;
- `--smoke` compiles a special feature-bearing test and exercises every gate at
  smoke scale; and
- `--full` performs the release benchmark and 120-second idle proof that mints
  the receipt.

[LLP 0154](./0154-minimal-observability.rfc.md) requires retained evidence and
records it as recurring through the local proof. That does not require every
unrelated commit to compile the feature smoke. The cheap receipt validator can
run whenever the receipt or its declared inputs are relevant; the smoke can
run for observability/runtime changes and complete latest-main cadence; the
full remint remains an explicit evidence operation.

The same distinction applies to bundle metrology. [LLP
0145](./0145-client-bundle-architecture.research.md) requires behavioral
acceptance for byte receipts, but the metrology runner may deduplicate identical
behavior commands within one run and the canonical package suite need not run
the same file again in the same proof merely to satisfy two inventories.

### Finding 7 — no test deletion is presently justified

Static inspection and timing data identify redundant executions and
inappropriate cadence, not a set of assertions known to have no value. The
repository does not yet retain the unique-failure or mutation evidence needed
to claim that a maintained test never catches a defect another test would
catch.

This RFC therefore deletes no test. Future deletion requires evidence under
the governance rules below; runtime alone is not enough.

## Design

### D1 — make keep-going dependency-aware

Replace the flat command list with named gates carrying explicit prerequisite
sets. At minimum, model these producer groups:

- source and toolchain authority;
- generated artifacts;
- native runtime artifacts;
- current binary build and readiness;
- staged Linux runtime package;
- demo/surface materialization; and
- browser availability.

A gate has one of four terminal results:

- `PASS` — it executed and passed;
- `FAIL` — it executed and found an independent failure;
- `BLOCKED` — it did not execute because a prerequisite failed; or
- `NOT_SELECTED` — its suite was outside the declared change/cadence scope.

In keep-going mode, `FAIL` does not stop unrelated gates. It does prevent every
transitive dependent from executing. The final summary names root failures and
blocked dependents separately. `BLOCKED` is never a green result for a required
selected proof, but it consumes no timeout budget and is not counted as a
second product defect.

Every executing gate has a finite wall-clock budget. The runner default is
3,600 seconds, deliberately about fourteen times the observed 249-second
partial Rust run; a gate may declare another value with `--timeout-seconds`,
and `SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS` is the operator-wide override. Both
the Bash runtime and static inventory call the same parser: a value is a
canonical positive base-10 integer with no sign or leading zero and is at most
536,870,911 seconds (the largest value whose quarter-second poll conversion is
safe even for 32-bit signed Bash arithmetic). Empty, exponent, hexadecimal,
octal-looking, zero-padded, zero, and over-range spellings are refused.

On expiry the runner emits the stable `SNAPBACK_PROOF_GATE_TIMEOUT` marker,
records exit 124 as `FAIL`, sends TERM to the gate's process group, and
escalates to group KILL after five seconds. Process-group containment is not a
claim about a descendant that calls `setsid()`: known acceptance-owned
resources run their registered cleanup stack during the TERM grace (including
the exact registry-bound fork drop), while capture readers have a finite drain
budget. A reader still awaiting EOF after a timeout is killed, emits
`SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED`, and records
`terminationReason: "timeout-cleanup-failed"`; the run therefore returns and
cannot present escaped-writer contamination as clean. The authoritative v3
JSONL uses `terminationReason: "exit" | "timeout" |
"timeout-cleanup-failed"` for executing gates, distinguishing a natural exit
124 from enforcement. Timeout signatures bind both that structural reason and
the captured timeout marker. The `rust-tests` command separately uses Cargo
`--no-fail-fast`, so one failing target cannot hide unrun workspace targets.

The dependency graph itself is test inventory. A newly added real-server test
that omits the current-binary prerequisite fails the inventory check.

### D2 — assign every test to an explicit cadence

Every maintained test remains inventoried and belongs to one or more of four
cadences.

#### D2.1 Fast per-push proof

Run on every PR and `main` push, on `expo-small` where possible. Target: under
3 minutes. It includes:

- LLP/reference metadata;
- CI workflow and test-inventory integrity;
- changed generated-artifact/publication-carrier validation;
- guide checks when guide inputs change;
- package export/type/static-Hermes checks when package surfaces change;
- capability-maturity checks when their inputs change; and
- cheap retained-receipt validation when the receipt or its declared input
  closure changes.

Unknown files or an unclassified path fail closed into the broader affected
proof; they never silently select no tests.

The implemented fast boundary always runs reference integrity, workflow
integrity, proof-runner/inventory fixtures, selector replay fixtures, and the
package-test inventory. Explicit LLP/issue/diary docs remain on that boundary;
guide inputs add generated-artifact and guide closure checks. The selector
emits its exact chosen and `NOT_SELECTED` inventories even when no affected
group is needed.

The universal boundary is therefore seven gates, all runnable from the
checked-out repository with runner-provided Node and Python, without installing
root JavaScript dependencies or Rust/native toolchains: `ref-check`,
`ref-check-fixtures`, `ci-workflow-fixtures`, `proof-runner-fixtures`,
`local-proof-inventory`, `affected-selector-fixtures`, and
`package-test-inventory`.
`rustfmt` is an additive cross-cutting owner for `.rs` paths, so it supplements
rather than replaces the file's primary native/package/demo classification.
The README funnel has a dedicated fast owner for public package `README.md`
files and remains in the affected package groups for publication inputs.
Selection receipts expose separate Rust-toolchain and JavaScript-dependency
requirements; selecting either gate provisions its narrow prerequisite without
pulling unrelated docs-only changes into native or package setup.

##### Same-change frozen-record coupling

The checked selection policy also owns a narrow `driftProneGates` registry.
An entry is admitted only when its canonical gate recomputes a value from
source and compares that value with a committed frozen record. Each entry names
the record, exact regeneration command, and fine-grained trigger rules. The
fine-grained rules refine the broader affected-proof groups for this local
latency boundary; path classification and fail-closed behavior still come from
the same selector.

The registered set is:

| Gate | Committed record checked against recomputation |
|---|---|
| `agent-safe-publication-fixtures` | reviewed generated-publication leaf set in `tests/agent_safe_publication_checker_v1.mjs` |
| `client-bundle-metrology` | active bundle profiles, baselines, and `current.v1.json` |
| `diary-identity` | author-ruled historical diary-number alias map |
| `generated-artifacts` | codegen review manifests and committed projections |
| `contract-meta` | non-generated Contract pure-parameter sidecars |
| `guide` | generated Guide manifest and flat projection |
| `telemetry-receipt-check` | retained Phase-1 telemetry receipt |
| `auth-invalidation-report` | recomputed composed authorization-invalidation receipt |
| `control-catalog` | generated catalog JSON and generated Guide blocks |
| `deployment-identity` | the two Cloudflare deployment-identity JSON records |
| `result-transform-ship-gate` | result-transform retained ship receipt |
| `relation-activity-publication` | source-pinned relation-activity carrier and readers |
| `sequence-allocation-publication` | source-pinned sequence-allocation carrier and readers |
| `local-store-publication` | persistent-store carrier and anchor |
| `local-store-carrier-receipt` | carrier-exit and bundle-attribution receipts |

> **Author ruling — 2026-08-07 (Charlie Cheever).** Seven concurrent lanes on
> 2026-08-07 each paid one to three complete fail-closed runs of the 14-gate
> registry, about 11 minutes per run. Those complete runs caught zero defects
> introduced by the push under test. Three lanes ultimately needed the
> all-or-nothing `SNAPBACK_DRIFT_GATES_BYPASS=1` because unrelated state was
> already red: `client-bundle-metrology`
> ([ticket](../issues/20260807-main-drift-client-bundle-metrology.md)),
> `local-store-carrier-receipt`
> ([ticket](../issues/20260806-local-store-carrier-receipt-stale-on-main.md)),
> and `auth-invalidation-report` infrastructure failures in fresh worktrees.
> Skipping all selected gates was worse than a targeted attribution waiver.
>
> Trigger-matched gates therefore always run, while a broad or unknown path
> supplements them with the measured fast core: `contract-meta`, `guide`,
> `telemetry-receipt-check`, `control-catalog`,
> `relation-activity-publication`, `sequence-allocation-publication`,
> `local-store-publication`, `result-transform-ship-gate`, and
> `local-store-carrier-receipt`. Each measured at no more than 1.5 seconds on
> the ruling machine and the tier measured about 3 seconds in aggregate.
> `SNAPBACK_DRIFT_GATES_FULL=1` opts a release-critical push into the complete
> registry.
>
> The complete registry runs every two hours under the
> `com.snapback.drift-backstop` launchd service against fresh `origin/main` in
> a dedicated clone. It uses the existing idempotent backstop ticket mechanism;
> `scripts/install-drift-backstop-schedule` installs the service. Moving the
> complete sweep from fail-closed pushes to the backstop is honest because the
> backstop is now actually scheduled.
>
> Staleness attribution is per gate. When a selected gate fails at the pushed
> revision, the hook re-runs that gate at the update's merge-base baseline. A
> non-infrastructure failure at both revisions is loudly reported as
> `PRE-EXISTING`, points to its open ticket when one exists, and does not block
> the push; a green baseline, an unavailable baseline, or infrastructure
> ambiguity still blocks. The loud bypass remains for emergencies.
>
> The hook also reads `.node-version` and prepends the matching Volta image bin
> directory to `PATH`, so method-pinned gates inherit Node 24.18.0. It must
> never wrap the runner or gate command in `volta run`: Volta can translate a
> child's exit 1 into exit 126, which this runner correctly classifies as an
> unavailable-command infrastructure error.

> **Author ruling — 2026-08-11 (Charlie Cheever, in session), amending the
> 2026-08-07 ruling above per LLP 0232's accepting change.** Four narrowings,
> each effective only when its implementing change lands; the 2026-08-07
> behavior stands until then. (1) "Infrastructure ambiguity still blocks" is
> reversed only for a runner-controlled setup/provision failure whose
> normalized signature is corroborated at every resolved merge-base (LLP 0232
> D-3); a green, different, or unavailable baseline does not corroborate, and
> all other ambiguity — content reds, unknown classification, nondeterminism —
> continues to block. (2) "Trigger-matched gates always run" is amended to
> permit receipt-validated reuse: a selected gate may be satisfied by a
> validated per-gate execution receipt whose verified semantic input closure
> is byte-identical (LLP 0232 D-1); absent a valid receipt the gate runs.
> (3) "Failed prepare commands are exit-2 infrastructure errors" is narrowed:
> only runner-controlled, baseline-corroborated setup/provision failures are
> infrastructure; a content-caused prepare failure (for example, the pushed
> revision breaking the build a prepare performs) is content evidence and
> blocks. (4) "File no backstop ticket" is amended: the runner emits durable,
> idempotent, signature-keyed ticket requests for inherited-red,
> corroborated-infrastructure, and nondeterministic outcomes, projected onto
> `main` by an explicitly authorized source-ticket publisher (LLP 0232 D-3/
> D-8). The registry contract additionally gains per-gate versioned
> `semanticInputClosure` declarations with admission checks, execution
> receipts, and derived validation receipts (LLP 0232 D-1).

> **Author ruling — 2026-08-13 (Charlie Cheever, in session), superseding the
> ordinary-push execution requirement in the dated rulings above.** Ordinary
> pushes still compute the exact ref-update path union and select the same
> trigger, always-run, and broad/unknown tiers, but they report and defer the
> selected commands for revisions targeting `origin/main` to the scheduled
> two-hour backstop. A non-main ref is reported without claiming a scheduled
> verdict; its later `origin/main` landing is selected independently. There is
> no ambient same-change frozen-record veto.
> `SNAPBACK_DRIFT_GATES_STRICT=1` explicitly
> runs the selected commands with the 2026-08-11 D-3 classifier; add
> `SNAPBACK_DRIFT_GATES_FULL=1` for the complete registry. For backward
> compatibility, `FULL=1` alone implies strict/full and `BYPASS=1` remains an
> accepted loud skip. D2.2 affected product checks, D2.3 canonical scheduled
> verification, D2.4 release/platform proof, ticket idempotency, and
> attribution remain. Activating the backstop as ordinary frozen-record
> authority also activates D-3's closed classifier there: clean content reds
> repeat once, contradictions become unattributed nondeterminism tickets,
> stable content reds retain signature-epoch attribution, and runner-controlled
> setup failures retain self-health streaks. LLP 0232's 2026-08-13 amendment
> owns the boundaries for dangerous and irreversible operations.

The tracked `.githooks/pre-push` consumes Git's ref-update stream, computes the
union of paths in every committed landing being introduced (plus the net diff
for a rewritten update), and asks `selectDriftProneGates` for the registered
checks. It never selects from working-tree-only edits. A known path with no
drift trigger selects zero trigger-matched gates beyond the configured
always-run tier. A path classified `all`, or a path with no classification,
selects its trigger-matched gates plus the fast fail-broad core; strict full
mode selects every registered gate. Ordinary mode prints the selected gates
and returns without running their prepare/check commands.

Strict mode retains the prior execution contract. A new failure names the
stale record, canonical check, and exact regeneration command, while
baseline-proven pre-existing staleness is reported and allowed. Multi-ref
updates use the union of committed paths and report each revision/ref count;
unknown and broad selections are explicit in both deferred and strict output.

The agent-safe publication checker's own file has an explicit publication rule
ahead of the broad `tests/` fallback. Changing that trigger/record therefore
runs its owning drift gate without converting an otherwise known path into a
full-registry environment probe; genuinely unknown test paths still fail broad.

When strict mode requests a revision that cannot run in the invoking worktree, the hook's
detached checkout is created beside it so sibling repositories retain their
normal resolution. It mirrors every installed `node_modules` tree below a
tracked project directory into a real ignored directory (linking the entries,
not the directory itself), initializes an already-available Ibex submodule,
and reuses explicit or locally prepared native caches. Registry entries declare
non-built-in Node modules and required ignored/prepared paths, which are
resolved or projected before the gate starts. Missing modules or prepared
paths, missing executables, signals, and stable bootstrap/environment
diagnostics are runner-setup evidence. In strict D-3 mode, only
baseline-corroborated runner-controlled failures proceed as `INFRASTRUCTURE`
with a ticket request; content-caused prepare failures remain content evidence
and block. The backstop uses the same content/setup boundary and repeats a
clean content red once before attribution; contradictory determinate outcomes
over an unchanged observed execution closure become unattributed
nondeterminism tickets. The closure binds the tracked tree, declared prepared
inputs, the complete installed dependency-tree bytes including symlink targets,
actual resolved module-package bytes, submodule Git trees/status and
prepared runtime artifacts, command identity, sanitized environment, and
named tool executable bytes at both execution boundaries. A topology that
cannot support a first-parent causal claim stays unattributed. The backstop
retains its infrastructure streak/ticket protocol and never mislabels a
runner-controlled setup failure as stale-record drift.

The auth-invalidation report declares the ignored Todo and RBAC generated
manifests compiled by its Rust receipt tests. They are environment inputs, not
the auth frozen record; absence in a detached checkout is therefore an
infrastructure failure, while a prepared checkout projects the exact bytes
from the invoking environment.

#### Dependency mirror cache

Detached checks reuse a dependency-link scaffold keyed by SHA-256 over the
root `bun.lock`, every tracked package manifest, the cache schema, platform,
and architecture. The scaffold contains directories and links, not a second
mutable package installation. Repository-local workspace links are written
relative to their repository position, so copying the scaffold into a detached
checkout resolves them to that checkout's packages rather than the invoking
worktree. External dependency links retain the prepared dependency tree as
their source, matching the pre-cache isolation contract.

Cache publication is staged under a unique directory and renamed into the
content-addressed destination only after its receipt and complete payload have
been written. Concurrent builders may duplicate the bounded first-build work,
but only one complete directory wins; losers validate and reuse that winner.
An existing malformed entry is an infrastructure failure rather than a stale-
record conclusion. A changed lockfile or tracked package manifest selects a
new destination and cannot reuse the old scaffold.

On macOS the scaffold is materialized with `cp -cR -P`, preserving symlinks
while asking APFS for clonefile copies. If that command or filesystem does not
support cloning, Node's recursive copy with `COPYFILE_FICLONE` falls back
safely to an ordinary copy. The scaffold contains no dependency payload bytes,
so the portable path does not byte-copy installed package trees.

Submodules are likewise explicit gate inputs rather than universal isolation
setup. The auth-invalidation report declares `vendor/ibex` because its
bootstrap needs the vendored Cargo dependency; JavaScript-only gates do not
clone Ibex merely because the invoking worktree has initialized it. Required
submodule absence or initialization failure remains an exit-2 infrastructure
error.

Git's repository-local hook environment (`GIT_DIR`, `GIT_WORK_TREE`, index,
object-directory, prefix, and related variables) is stripped from every nested
Git and gate process. Connection and author identity variables remain. This is
required when the pushed local revision is not the invoking worktree's current
HEAD: cwd, not the hook caller's exported repository state, must select the
detached revision.

On a genuine refusal, record identity, check command, and regeneration command
are printed before optional working-tree-diff inspection. Diff inspection is
best-effort and non-fatal; even a checker that invalidates its Git context
cannot suppress the developer's repair command. Captured JavaScript checker
diagnostics retain their assertion and diff text but omit stack frames; an
infrastructure failure retains its complete diagnostic output.

`SNAPBACK_DRIFT_GATES_BYPASS=1` remains the compatibility bypass. Any other
value refuses; the accepted value prints a conspicuous banner and the skipped
gates. In ordinary mode it additionally explains that deferral is already the
default; in strict mode it retains its historical emergency-skip meaning.
`SNAPBACK_DRIFT_GATES_STRICT` and `SNAPBACK_DRIFT_GATES_FULL` likewise accept
only exact `1`. `FULL=1` alone preserves legacy callers by implying strict/full;
the preferred complete-registry spelling names both variables. Neither mode nor
the bypass disarms `node scripts/drift-prone-gates.mjs backstop`: that
command checks the registered set independently of path selection at the
selected `main` revision, normalizes the failure signature, attributes the
current signature epoch along first parent when possible, and files
`issues/YYYYMMDD-main-drift-<gate>-<signature>.md`. The `Drift gate` plus
`Failure signature` markers are the idempotency key: re-observation updates the
existing ticket's `Last observed` revision, while a distinct signature for the
same gate gets a distinct ticket. A legacy gate-only open ticket adopts the
first observed signature in place; moving a resolved ticket to
`issues/closed/` rearms that signature.

Telemetry keeps D2.4's distinct semantics: its same-change check proves the
retained receipt is historically valid, but an ancestral `LAGGING` or
`OVERDUE` receipt remains legal on ordinary `main`. Exact-current telemetry is
still a release/promotion obligation, not a pre-push requirement.

#### D2.2 Affected proof

Run on every PR and `main` push for the subsystem(s) selected by a checked
path-to-suite map. Target: under 10 minutes for JS/docs work and under 20 for
native work. Examples:

- Rust/runtime changes select Clippy, Rust tests, native build/readiness, and
  relevant real-server acceptance;
- client/codegen changes select the affected package suites, type checks,
  bundle metrology, and relevant demos;
- Cloudflare/shared-protocol changes select the Cloudflare corpus;
- demo/harness changes select the changed demo plus shared harness coverage;
- package/runtime-distribution changes select cold-install and platform
  package proofs; and
- versioned-seed/storage changes select the complete LLP 0109 corpus.

Shared authorities such as `Cargo.toml`, `Cargo.lock`, `package.json`, the root
lockfile, toolchain pins, common harnesses, workflow definitions, and the path
map itself deliberately fan out to all affected suites.

The authority now lives beside the runner in
`scripts/local-proof-selection-policy.v1.json`. It classifies all 134 stable
canonical gates into fast/affected groups; `scripts/select-local-proof.mjs`
binds the base/head diff, policy bytes, parsed gate inventory, selected groups,
prerequisite closure, and heavyweight-tool requirements into one reopenable
receipt. Any unknown path, workflow/selector change, root toolchain authority,
or other shared authority selects every gate. Every affected code selection
also includes LLP 0010's Contract/Exact and admin behavior lanes. Historical
replay fixtures cover client resume ordering, native storage/route behavior,
Cloudflare deployment identity, and generated required surfaces.

#### D2.3 Complete latest-main proof

Run the complete canonical inventory against the newest `main` revision on a
bounded schedule or equivalent debounced latest-head mechanism, and on demand.
It is the repository-wide integration verdict, not a per-commit attribution
claim. Target: under 30 execution minutes after D3.

Only one complete latest-main proof may be running for a branch. New pushes
coalesce to the newest pending revision. The fast and affected lanes retain
per-change attribution for the failures most likely to be introduced by that
change; the complete proof detects dependency-map mistakes and cross-subsystem
interactions.

The canonical `local-proof` workflow now runs this complete inventory every
six hours and on manual dispatch under a non-cancelling latest-main concurrency
group. Pull requests and `main` pushes use affected selection instead; pull
request updates cancel their superseded affected run, while each `main` push
uses a commit-unique concurrency group so GitHub cannot replace a pending diff
with a later event that does not contain it. The workflow plans selection
before installing Bun, Chrome, Rust, Cargo audit, or the large Ibex submodule
and skips those setup costs when the selected closure does not need them. Both
the selection receipt and gate JSONL are retained on green or red.

Telemetry Phase 1 was the first slice to establish this latest-main pattern.
Its separate six-hour/manual workflow still produces one clean Linux evidence
snapshot, while the canonical workflow described above now supplies the
complete inventory cadence. Telemetry candidates remain historical evidence
when `main` advances; ordinary receipt assessment reports
`CURRENT | LAGGING | OVERDUE | DIVERGED` without misclassifying valid older
measurements as corrupt.

#### D2.4 Nightly, release, and platform proof

Historical compatibility, clean-machine package installation, expensive
retained-evidence smoke/full modes, and promised platform tuples run on their
relevant affected changes and again at nightly or release cadence. Release
claims remain blocked unless the claim-relevant gates of their required
matrix are recent and green; unrelated red gates are ticketed and named in
the promotion record rather than blocking it (re-scoped by LLP 0189 D-6).

For retained telemetry evidence, three executable claims are distinct:
historical validation, rolling-head assessment, and exact-current release /
capability-promotion authority. The scheduled full producer owns rolling
health; ordinary merges may proceed with an explicit ancestral
`LAGGING`/`OVERDUE` receipt. A frozen release candidate is required to pass the
exact-current mode (preserved as a stricter per-claim protocol under LLP 0189
D-7, not re-scoped by its D-6). Real candidate publication and default-tag
promotion now invoke `scripts/verify-telemetry-phase1-proof --require-current
<frozen-candidate-sha>` through the shared release gate before their first
irreversible effect. Publication runs at the clean candidate checkout after
qualified-ledger binding and before npm mutation; promotion assesses the
candidate ledger's frozen `revision`, not its possibly newer checkout, before
authority acquisition or dist-tag mutation. Their candidate ledger and
promotion receipt retain the assessment. No current capability-maturity record
cites telemetry and its validator consumes none; any future telemetry-backed
maturity record must use the same exact-current path. LLP 0154's 2026-08-06
amendment is the normative trust contract.

No test is moved to nightly merely because it is slow. Its cadence follows the
risk it covers: a seed change still runs seed compatibility before landing; an
unrelated LLP prose change does not.

### D3 — remove redundant execution within a full proof

#### D3.1 Suppress the disposable doctor link after an authoritative build

Keep `scripts/ibex-doctor`'s full exact-link probe for interactive diagnosis,
fresh-worktree bring-up, and an explicit clean-machine lane. Add a mode that
performs its source, artifact, toolchain, loader, and readiness checks without
creating a disposable Cargo target. Use that mode only when the same proof has
an authoritative build-and-qualification producer.

Measured full-proof saving: approximately 7.5 minutes.

#### D3.2 Reuse one bootstrap/readiness result

Make bootstrap return early when its digest-bound receipt proves the exact
current binary, vendored runtime, and qualification contract. Later consumers
verify the receipt in milliseconds. A feature-bearing telemetry binary remains
a distinct build identity and does not reuse an incompatible receipt.

#### D3.3 Gate cleanup on measured headroom

Do not run the per-package test-profile clean unconditionally and then discover
that the runner had ample headroom. Compute the cleanup decision first. When
preservation is safe, retain artifacts needed by the later filtered
versioned-seed Rust proof and final binary build. When cleanup is required, log
which later rebuild cost it intentionally creates.

#### D3.4 Cache the immutable versioned-seed predecessor explicitly

Publish or restore the exact predecessor worktree/runtime cache using keys that
include platform, Rust authority, predecessor commit, Cargo lock digest, Ibex/
Hermes pin and patch inputs, and the suite's verified-build schema. Continue to
revalidate the binary digest and build identity before use. Stream current and
historical Cargo output with timing markers.

The current source binary and filtered Rust witnesses must reuse the ordinary
proof's artifacts where identities match; otherwise the log must explain the
identity difference that forced a rebuild.

#### D3.5 Deduplicate behavior execution

Within bundle metrology, execute identical behavior commands once even when
multiple immutable ledgers cite them. Across the proof, allow a machine-
readable successful package-test receipt from the exact source/toolchain/input
identity to satisfy the metrology behavior requirement. The ledger continues
to record every behavior command it requires; only duplicate execution is
removed.

#### D3.6 Parallelize only isolated JS test programs

Replace long package `&&` chains with a bounded runner after each file declares
whether it is process-isolated, filesystem-mutating, port-owning, or dependent
on generated state. Begin with pure codegen and client unit tests. Keep shared-
server and browser suites serialized until their isolation is proven.

### D4 — treat Cargo parallelism and target consolidation as experiments

`CARGO_BUILD_JOBS=1` closed observed `rust-lld` SIGBUS failures. Moving directly
to `-j 8` is not an accepted optimization merely because the current runner is
self-hosted. Measure `expo-large` memory, disk, mmap, and linker behavior with
`-j 2`, `-j 4`, and higher on an isolated branch. Adopt the highest stable
setting only after repeated full runs; retain an automatic or documented
fallback to one.

Likewise, consolidating 57 Rust integration targets may reduce link count, but
it is a large mechanical change with test-selection, module-state, `@ref`, and
failure-isolation consequences. Instrument link time first. Pursue
consolidation only if D1–D3 leave it among the dominant costs.

`cargo-nextest`, `mold`/`lld`, codegen-unit tuning, and remote build caching are
valid experiments, not assumed conclusions. Each changes a toolchain or
execution boundary and needs its own measured acceptance.

### D5 — make test economics part of the inventory

Every recurring gate declares:

- owning subsystem and maintainer;
- unique risk or product claim it protects;
- prerequisites and outputs;
- path selectors and cadences;
- expected warm and cold runtime budgets;
- whether it mutates source, owns a port/browser/server, or requires a clean
  checkout;
- cache identity; and
- the last known unique failure, when available.

CI emits one machine-readable timing artifact containing queue/concurrency
delay, setup time, gate duration, cache hits, selected/not-selected/blocked
state, root failure, and peak disk information. A test exceeding its budget
does not automatically become flaky or skippable, but it creates an owned
regression that cannot disappear into a 100-command shell log.

Before deleting a test as redundant, use one of:

- a mutation test showing another selected gate kills the same relevant
  mutants;
- retained failure history showing the candidate has no unique failures over
  a meaningful period, plus an overlap review; or
- proof that the product claim it guarded no longer exists.

Deletion or cadence demotion remains a reviewed inventory change.

## Rollout

### Phase 0 — instrumentation and dependency graph

1. Add per-gate timing and structured results without changing selection.
2. Encode producer/dependent relationships.
3. Make keep-going report `BLOCKED` and prove with fixtures that a failed
   binary producer does not launch any dependent server suite.

Exit: one broken producer yields one root failure, bounded blocked results, and
no repeated startup timeout.

### Phase 1 — fast and affected selection

1. Create and test the fail-closed path-to-suite map.
2. Move the fast lane to `expo-small` where its dependencies permit.
3. Add affected Rust, client/codegen, Cloudflare, demo, and packaging groups.
4. Keep the current complete proof running during comparison.

Exit: for a representative corpus of historical diffs, selected tests include
the gate that caught the historical defect; unknown paths select the full
affected set; docs-only feedback is under 3 minutes.

### Phase 2 — latest-main cadence

Move the complete inventory from every `main` push to a bounded latest-main
cadence after Phase 1 demonstrates reliable affected selection. Cancel
superseded pull-request complete proofs; preserve coalescing for latest-main.

Exit: `main` receives regular complete verdicts without continuous queued
per-commit full proofs, while every push retains fast and affected verdicts.

### Phase 3 — native and package deduplication

Land D3.1–D3.6 independently, measuring each against the same baseline. Do not
claim summed estimates until an integrated run measures the interaction.

Exit: complete latest-main execution is under 30 minutes; ordinary native
affected execution is under 20; no readiness, historical, package, or
behavioral claim was removed.

### Phase 4 — optional build experiments

Only after the preceding phases, evaluate Cargo jobs, linker choice, nextest,
and integration-target consolidation. Keep changes that improve repeated
end-to-end proof time without reintroducing resource failures.

## Acceptance

This RFC is implemented only when all of the following hold:

1. every maintained test is present in the cadence inventory;
2. an unclassified changed path fails closed into broader coverage;
3. dependency fixtures prove independent failures continue and dependent
   suites do not execute;
4. LLP 0010's Contract/Exact and admin behavior requirements remain selected
   for affected and complete proofs;
5. LLP 0109's complete case-by-surface corpus runs for relevant changes and
   complete/release cadence before capability claims;
6. LLP 0145 byte receipts retain behavioral acceptance without duplicate
   command execution;
7. LLP 0154 receipt validation, smoke, and full remint retain distinct honest
   claims at their declared cadences;
8. clean-machine/runtime-package and required browser lanes remain failures,
   never silent skips, when selected;
9. timing artifacts demonstrate the latency targets over at least ten
   representative runs; and
10. the most recent eligible complete battery is green on the claim-relevant
    gates before release or capability promotion, with unrelated reds
    ticketed and named in the promotion record (re-scoped by LLP 0189 D-6;
    originally "a complete latest-main proof is green").

## Non-goals

- No test or assertion is deleted by this RFC.
- No required prerequisite becomes an automatic skip. `BLOCKED` is a failing
  selected-proof state with a truthful causal explanation.
- No capability may advertise from an affected subset when its governing LLP
  requires the complete corpus.
- No release/platform claim is inferred from a different platform or stale
  receipt.
- The deliberate burst cadence on `main` is not slowed or gated.
- The full doctor is not weakened; its disposable-target probe moves to the
  contexts where that diagnostic claim is unique.
- Artifact and performance ceilings are not loosened to make CI green.

## Risks and counterweights

- **Path selection can miss a dependency.** The map fails broad on unknown and
  shared-authority paths; complete latest-main detects map mistakes; historical
  diff replay tests the selector before activation.
- **A scheduled full proof loses exact per-commit attribution.** Fast and
  affected lanes preserve narrow attribution; the full proof identifies the
  tested revision and the bounded landing window.
- **Splitting jobs can increase total runner-minutes.** Move only truly cheap
  work to `expo-small`; measure aggregate runner time as well as wall time; do
  not upload multi-gigabyte Cargo targets merely to manufacture parallelism.
- **Cache reuse can conceal stale native state.** Every cache remains exact-
  key and digest/build-identity verified; cache miss is slower, never a skip.
- **Parallel JS tests can share hidden state.** Isolation metadata is required,
  and mutable/server/browser suites remain serialized until proven otherwise.
- **Receipt cadence can become ambiguous.** Each result states whether it is a
  validator, smoke, or full measurement and the source/input identity it
  covers.

## Open questions

- **OQ1 — latest-main trigger (resolved for the current inventory):** both the
  canonical proof and telemetry full producer use fixed six-hour GitHub
  schedules plus manual dispatch and non-cancelling latest-main concurrency
  groups that coalesce pending heads.
- **OQ2 — selector authority (resolved for Phase 1):** the checked JSON policy
  lives beside the proof script. Package/demo-owned generated fragments remain
  a possible later refactor, not a prerequisite for fail-closed selection.
- **OQ3 — receipt input closures:** which telemetry and performance inputs are
  truly claim-affecting, and which broad source bindings are accidental? Any
  narrowing requires the owning LLP's evidence review.
- **OQ4 — binary artifact transfer:** is a qualified served binary small and
  stable enough to share between jobs without making upload/download slower
  than a cached rebuild? Measure before splitting the native lane.
- **OQ5 — Cargo concurrency:** what is the highest repeatedly stable job count
  on `expo-large`, including simultaneous work from other workflows?

## Required documentation updates when implemented

- Amend [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) §CI and Review Gates
  to distinguish affected per-change acceptance from complete latest-main and
  release inventory cadence.
- Amend [LLP 0109](./0109-versioned-seed-evolution.spec.md) §12/§16.6 to record
  the relevant-change and complete-proof execution points without weakening
  its advertisement gate.
- Amend [LLP 0145](./0145-client-bundle-architecture.research.md) Phase A to
  permit exact-result behavior deduplication while preserving every ledger's
  declared command set.
- Amend [LLP 0154](./0154-minimal-observability.rfc.md) implementation record to
  distinguish receipt validation, feature smoke, and full remint cadence.
- Update the closed keep-going issue or open a corrective issue recording that
  its dependency-aware exit criterion was not met by the flat runner.

## Status

Accepted, partially implemented. Phase 0, the fast/affected selector, the
latest-main cadence, and the first two native-deduplication legs now have
executable code:

- `scripts/verify-local-proof` names and times every gate, records
  `PASS | FAIL | BLOCKED | NOT_SELECTED` as JSONL, and declares the generated,
  native-runtime, current-binary, readiness, surface, and browser producer
  edges used by their dependents;
- `tests/proof_runner_v0.mjs` proves independent continuation, transitive
  blocking, strict runtime/static timeout agreement, natural-124 versus
  timeout identity, bounded capture with a surviving double-forked writer,
  same-group TERM resistance, and signal cleanup of a genuine `setsid()`
  descendant, while `tests/local_proof_inventory_v0.mjs` proves
  unknown edges, duplicate ids, missing producers, the bounded non-fail-fast
  Rust workspace command, and a new direct real-server gate without
  current-binary readiness fail closed;
- CI uploads the result artifact even when the proof is red;
- the canonical proof builds/qualifies the ordinary binary before invoking
  `ibex-doctor --reuse-authoritative-build`, preserving full doctor as the
  default bring-up/clean-machine claim; and
- repeated bootstrap calls reuse only a coherent restricted-handler-VM receipt
  for the clean exact current revision and debug identity. Dirty trees and
  receipt mismatch rebuild normally;
- the telemetry slice of Phase 2 has a scheduled/on-demand latest-main Linux
  producer, while ordinary receipt checks separate historical validity from
  rolling lag; its exact-current validator now gates real candidate publication
  and default-tag promotion at the frozen candidate revision; and
- CI decides whether target cleanup is required before deleting test artifacts;
  measured-safe headroom preserves them for the final build and versioned-seed
  witnesses, while low or unmeasurable headroom still cleans fail-safe;
- every canonical gate is classified by a checked policy, selected gates close
  over their producers, unknown/shared paths run everything, and four
  historical defect diffs replay to the gates that caught them;
- explicit docs/guide changes exercise a fast boundary, while affected code
  retains required Contract/Exact and admin behavior and reports its exact
  selection receipt; docs-only changes no longer select Cargo- or
  `node_modules`-dependent gates, while Rust and public-package README owners
  request those prerequisites explicitly; and
- the complete inventory now runs on six-hour/manual latest-main cadence rather
  than once per push, with heavyweight setup conditional on selected claims.
- the pre-push frozen-record selector now reports and defers selected gates by
  default; explicit strict mode retains synchronous execution and its complete
  D-3 classification, while the two-hour backstop remains authoritative.

No test, assertion, platform obligation, capability gate, or receipt claim was
removed. The measured 7.5-minute doctor saving and bootstrap savings remain
projections until a green integrated CI run produces the new timing artifact.
D3.4–D3.6, D4 experiments, the complete D5 ownership/risk metadata, ten-run
latency evidence, and the final release/promotion green-history condition
remain open. The next
recommended move is to observe affected-selection and complete-latest-main
artifacts long enough to validate the latency targets before pursuing D3.4
predecessor caching or D3.5 behavior deduplication.
