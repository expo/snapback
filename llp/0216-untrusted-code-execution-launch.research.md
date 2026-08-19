# LLP 0216: What it would take to launch untrusted code execution on Snapback's two runtimes

**Type:** Research
**Status:** Draft
**Systems:** Runtime, Security, API, Deployment, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-10
**Revised:** 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-10
**Related:** LLP 0009, LLP 0047, LLP 0048, LLP 0040, LLP 0058, LLP 0134, LLP 0204

## Summary

LLP 0204 D6 shipped `POST /api/v1/run` (and MCP `run_code`): a surface that
lets a third party — or an AI agent — submit a small program to run
server-side against the app's data (`crates/snapback/src/server.rs:22394` `invoke_run`). The
surface is registered, bounded, and envelope-digest-bound, but **every current
target refuses it** with a typed capability refusal
(`SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED`), because no target carries an
"evidenced untrusted-code profile" per LLP 0047. That refusal is deliberate: the
threat class is *adversary-authored* code, not the app owner's own handlers, and
LLP 0009 names the prerequisite plainly as **comprehensive preemption**. Owner-code
runtime qualification (`snapback runtime-qualify`) is explicitly not accepted as
evidence (`crates/snapback/src/manifest.rs:12945-12953`, `@ref LLP 0204#d6`).

This document is decision support, not a design. It puts Snapback's two code
runtimes side by side — the **Ibex restricted Hermes worker** and **workerd / V8
isolates** — enumerates what each enforces today, proposes the concrete evidence
battery that would justify flipping each runtime's `hosted_untrusted_code` gap to
"profile evidenced," lists the genuine gaps and their difficulty, and
recommends a phased path with a confidence level.

**Bottom line up front:** workerd / V8 is materially closer to launchable. Its
kill domain (process-per-invocation, SIGKILL) is already implemented and tested,
its conformance twin (LLP 0048) already exists as the deterministic testbed, and
the Cloudflare target manifest already reports `wall_clock_timeout` and
`cpu_budget` as `Enforced`. Ibex's restricted worker denies ambient authority by
construction and has an interrupt path, but query/top-level-mutation preemption
is **honestly Missing** and its kill primitive is a cooperative in-thread
interrupt, not a collateral-free forcible kill — closing that needs
Hermes/Ibex-level engine work, not just Snapback code. Recommend promoting the
V8 leg first; keep Ibex a trusted-local runtime with the gap declared.

## Background: the gate we shipped (S4 Landing B)

Two independent checks stand between `/api/v1/run` and any execution:

1. **The manifest evidence gate** —
   `manifest::untrusted_code_profile_evidenced` (`crates/snapback/src/manifest.rs:12954`).
   It passes only when both hold:
   - the `hosted_untrusted_code` capability gap is **absent** from the target
     manifest, and
   - each of **eight** required resource limits appears as exactly one row with
     status `Enforced` (`UNTRUSTED_CODE_REQUIRED_LIMITS`,
     `crates/snapback/src/manifest.rs:12934`):
     `wall_clock_timeout`, `action_wall_clock_timeout`, `cpu_budget`,
     `maximum_result_size`, `maximum_rows_read`, `maximum_rows_written`,
     `maximum_host_call_count`, `maximum_heap_size`.
   A missing row, an `Advisory`/`Missing` row, or a duplicate row all refuse.
   There is no partial credit.

2. **The executor-promotion gate** — even a manifest that passes is still
   refused at `run_code_capability_refusal` (`crates/snapback/src/server.rs:22371-22392`) with
   `executorPromoted: false`, until an author-gated landing replaces that match
   arm with a real checker/executor. "There is no partial executor behind
   today's unevidenced profiles."

Neither gate is satisfied by any shipped target. The three committed manifests
all declare the `hosted_untrusted_code` gap and none reports the full
eight-limit vocabulary:

| Limit row | local-dev-sqlite-ibex | cloudflare-do-sqlite-v8 |
|---|---|---|
| `wall_clock_timeout` | **Missing** | **Enforced** |
| `action_wall_clock_timeout` | Enforced | (absent) |
| `cpu_budget` | **Missing** | **Enforced** |
| `maximum_result_size` | Enforced | (absent; reports `maximum_row_bytes`) |
| `maximum_rows_read` | absent | absent |
| `maximum_rows_written` | absent | absent |
| `maximum_host_call_count` | absent | absent |
| `maximum_heap_size` | absent | absent |
| `hosted_untrusted_code` gap | declared | declared |

(Sources: `schemas/capability.manifest.local-dev-sqlite-ibex.json`,
`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json`.)

Two facts fall straight out of that table. First, **even the killable V8 target
cannot pass the gate as written** — it declares the gap and does not emit rows
named `maximum_result_size`, `maximum_rows_read`, `maximum_rows_written`,
`maximum_host_call_count`, or `maximum_heap_size`. The required-limit vocabulary
in `manifest.rs` and the limit rows targets actually emit have drifted; part of
"what it would take" is reconciling that vocabulary (see §4 Gap G0). Second, the
local Ibex target is the furthest away: it reports the two most security-critical
rows — `wall_clock_timeout` and `cpu_budget` — as **Missing**, which is the
honest posture LLP 0009 requires.

## 1. The two runtimes side by side

### 1a. Ibex restricted Hermes worker

**What runs here.** Two distinct Ibex execution paths exist and must not be
conflated:

- The **owner-handler VM** (`crates/snapback/src/runtime.rs`, `RuntimeGuard::create`,
  `crates/snapback/src/runtime.rs:889`): `ex_hermes_create_no_eval` builds a no-eval Hermes
  runtime, fresh per invocation, with a per-VM armed strict host context
  (`arm_strict_host_context`, `crates/snapback/src/runtime.rs:885`). This is the runtime
  `snapback runtime-qualify` exercises (`qualify_handler_vm`,
  `crates/snapback/src/runtime.rs:983`). It runs the *app owner's* trusted handlers. It is
  **explicitly not** untrusted-code evidence (LLP 0204 D6).
- The **restricted external-script worker**
  (`vendor/ibex/src/engine/hermes_restricted_worker.cc`, driven from
  `vendor/ibex/src/restricted_worker.rs`, armed by
  `packages/snapback-app-cli/code-mode-ibex.mjs`): the CLI's "app-bound
  restricted worker," the closest thing Snapback has to an untrusted-code
  sandbox. It runs on a dedicated OS thread with a coordinator/producer/consumer
  thread discipline (`restricted_worker.rs:205`, `:1085`).

**Isolation provided today (restricted worker).** Strong, and mostly *by
construction*:

- Ambient authority is denied structurally. The lockdown script deletes
  `Date`, `eval`, `Function`, `WebAssembly`, `Intl`, and `Math.random` before
  authored code is evaluated
  (`hermes_restricted_worker.cc:151-167`), and the dynamic-code latch
  `ex_hermes_vm_disable_eval` is called as the *non-bypassable* enforcement
  (`:168-174`) — the worker refuses to construct at all if the latch is
  unavailable (`EXACT_HAVE_HERMES_DYNAMIC_CODE_LATCH`). Bare Hermes ships no
  Ibex host globals to begin with.
- The only powers reach the program through a single frozen broker object
  (`__ibexAppBoundWorkerV1`, `hermes_app_bound_bridge.cc:145-246`,
  `Object.freeze` + non-configurable `defineProperty`), and the arming record
  pins `dynamicCode: 'disabled'`, `moduleRegistry: 'empty'`, a closed
  `capabilities` list, and a set of digests (`code-mode-ibex.mjs:119-138`).
- A heap ceiling is set at GC-config time (`withMaxHeapSize(heap_bytes)`,
  capped at 512 MiB, `hermes_restricted_worker.cc:215-223`).
- A result ceiling is enforced in the settlement codec (result bytes ≤ 16 MiB,
  a `fault` is raised past the ceiling, `hermes_restricted_worker.cc:106-115`),
  and the CLI arming caps `resultBytes`, `brokerOperations`, `openSubscriptions`,
  `frameBytes`, `stderrBytes`, `openTimers`, plus `runWallMs`
  (`code-mode-ibex.mjs:100-115`).

**LLP 0047 eight-limit mapping (restricted worker):**

| LLP 0047 limit | Restricted-worker status | Mechanism / gap |
|---|---|---|
| query wall-clock | **Not enforced by preemption** | `runWallMs` is a coordinator-side deadline; the engine is interrupted cooperatively, not killed. See below. |
| mutation wall-clock | **Not enforced** | Same. Manifest reports `wall_clock_timeout: Missing`. |
| action wall-clock | Enforced (owner VM path only) | `action_wall_clock_timeout: Enforced` via the ENG-23324 detached-action watchdog (LLP 0009 DK-5). Not the restricted-worker path. |
| CPU/instruction budget | **Missing** | Hermes exposes no instruction-count budget; `cpu_budget: Missing`. |
| max result size | Enforced | Settlement codec ceiling + `resultBytes` (`hermes_restricted_worker.cc:106`, `code-mode-ibex.mjs`). |
| max rows read/written | Advisory-ish | `brokerOperations` caps broker calls, but no `maximum_rows_read`/`_written` row is emitted. |
| max host-call count | Enforced (as broker ops) | `brokerOperations` ceiling; not emitted under the required row name. |
| max memory/heap | Enforced | `withMaxHeapSize`; not emitted as `maximum_heap_size`. |

**Escape surface a malicious program would probe:**

- **CPU / wall-clock exhaustion — the load-bearing hole.** The interrupt path
  is `ibex_private_restricted_engine_interrupt_v1` →
  `ex_hermes_interrupt_eval(handle, runtime_nonce)`
  (`hermes_restricted_worker.cc:290-294`). This is the same asynchronous
  interrupt Snapback arms for owner actions/nested mutations, which LLP 0009
  describes as "asynchronously breaks CPU-bound JavaScript" — but LLP 0009 is
  explicit that ordinary query and top-level-mutation preemption "remains
  honestly Missing," and that native host work "can only be abandoned after a
  bounded grace rather than forcibly killed" (`0009…rfc.md:40-47`, `:199-206`).
  The interrupt is delivered to a runtime evaluating synchronously on its own
  thread; there is no way to *kill that thread* if the interrupt check is not
  reached (e.g. a tight loop that the engine's interrupt polling does eventually
  observe is fine, but the guarantee is engine-cooperative, not host-forcible).
  LLP 0009 names this exactly: "comprehensive preemption remains a prerequisite
  for hosting untrusted code."
- **Memory bomb.** Bounded by `withMaxHeapSize` — a genuine ceiling — but the
  failure mode (Hermes GC OOM behavior on the shared worker thread) needs to be
  proven to fail closed rather than abort the process or wedge the thread.
- **Deep recursion / stack exhaustion.** No explicit stack-depth budget in the
  arming record; Hermes native stack overflow behavior under adversarial
  recursion is unverified for this path.
- **Giant results.** Covered by the settlement ceiling and `resultBytes`.
- **Ambient-authority leak.** Strongly defended by construction (lockdown +
  latch + frozen broker). The residual risk is prototype-pollution reach-through
  to the host broker object; the broker is frozen and non-configurable, which is
  the right posture, but this is what an adversarial suite must probe.
- **Timing side channels.** `Date` and `Math.random` are deleted and
  `Intl` removed (`hermes_restricted_worker.cc:155-162`), closing the obvious
  clocks. `performance`/`SharedArrayBuffer`-style timers are not present in bare
  Hermes; the suite should confirm none re-enter.

**Kill domain.** One worker runs on one dedicated thread
(`restricted_worker.rs`), and destroy is `ibex_private_restricted_engine_destroy_v1`
(`hermes_restricted_worker.cc:296-302`). Because the kill is a cooperative
interrupt plus thread teardown rather than an OS-level process kill, **a
runaway that never yields to the interrupt cannot be guaranteed collateral-free
without engine support.** This is the structural difference from the V8 leg.

### 1b. workerd / V8 isolates

**What runs here.** `crates/snapback/src/workerd_exec.rs` — the LLP 0048 conformance twin's
engine leg and the LLP 0040 Cloudflare harness, proven locally before deploy.
The same single-sourced handler harness (`packages/snapback-harness`) is hosted
in a local workerd process, speaking the async host-call protocol over a private
loopback transport; only the executor is swapped
(`workerd_exec.rs:1-17`). The deployed Cloudflare target is
`cloudflare-do-sqlite-v8` (Durable-Object SQLite, `vmLifecycle:
fresh-isolate-per-deploy`).

**Isolation provided today.** By *discipline* on the local leg, by *platform* on
Cloudflare (LLP 0048 §Security posture, `0048…rfc.md:236-251`):

- The harness strips ambient globals at module init and exposes only `ctx`
  powers (same conformance floor as Ibex). A denial suite probes both directions
  (ambient globals and host-object reach-through) to keep that discipline from
  eroding.
- **Fresh per invocation:** one workerd process per invocation
  (`workerd_exec.rs:13-17`).

**LLP 0047 eight-limit mapping (workerd / V8):**

| LLP 0047 limit | V8-leg status | Mechanism |
|---|---|---|
| query / mutation wall-clock | **Enforced** | Process-level deadline; on expiry the process is killed (`workerd_exec.rs:485-495`, `:814-830`). Cloudflare manifest: `wall_clock_timeout: Enforced`. |
| action wall-clock | Enforced | Settlement/quiescence deadlines + process kill. |
| CPU/instruction budget | **Enforced** (Cloudflare) | Platform CPU limit (`cpu_budget: Enforced` in the CF manifest); on local workerd, approximated by the wall-clock process kill. |
| max result size | Enforced | `MAX_INVOKE_RESPONSE_BODY_BYTES` = 8 MiB (`workerd_exec.rs:91`); CF `maximum_row_bytes`. |
| max rows read/written | Not emitted under required names | Host-op table can count, but no `maximum_rows_read`/`_written` row is emitted yet. |
| max host-call count | Not emitted under required name | Counted at the host boundary; no `maximum_host_call_count` row. |
| max heap size | Enforced (platform) | Workers isolate memory limit; CF reports `maximum_storage_bytes`, not `maximum_heap_size`. |

**Escape surface a malicious program would probe:**

- **CPU / wall-clock exhaustion.** Fully defended: the busy loop is killed by
  terminating the whole process (`drop(child)`, `workerd_exec.rs:814-830`,
  diagnostic `SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED`,
  `killDomain: process-per-invocation`). Already tested — see
  `crates/snapback/tests/workerd_twin_v0.rs:969` `busy_loop_is_killed_with_no_commit_and_no_collateral`.
- **Memory bomb / deep recursion.** V8 has real per-isolate heap limits and
  stack guards; on Cloudflare these are platform-enforced. The local leg needs an
  adversarial suite to confirm the process dies and commits nothing.
- **Giant results.** Bounded by the 8 MiB response ceiling
  (`workerd_exec.rs:91`), refused before commit
  (`local_workerd_invoke_rejects_oversized_bodies_before_handler_execution`,
  `crates/snapback/tests/workerd_twin_v0.rs:371`).
- **Ambient-authority leak.** Defended by discipline (global strip + denial
  suite). The honest caveat (LLP 0048 §Security posture): local workerd is *not*
  a hardened sandbox; hosted untrusted execution needs the real platform
  defense-in-depth (Workers for Platforms) plus LLP 0047 evidence, not just the
  harness discipline.
- **Prototype pollution reaching host.** The harness authenticates the private
  invoke/host/response transport with per-invocation tokens
  (`RESPONSE_TOKEN_HEADER`, `workerd_exec.rs:94`) and uses independent
  invoke/host/response capabilities (LLP 0009 revised notes), narrowing
  reach-through.

**Kill domain.** **One invocation** (`workerd_exec.rs:13`). Wall-clock
enforcement is OS process termination, so a busy-loop kill provably cannot take
an unrelated invocation with it, and a killed mutation commits nothing because
its buffered writes die with the process. This is the collateral-free property
LLP 0047 demands and Ibex cannot yet match.

### 1c. Side-by-side verdict

| Axis | Ibex restricted worker | workerd / V8 |
|---|---|---|
| Ambient-authority denial | **By construction** (strongest) | By discipline (local) / platform (CF) |
| Forcible kill of a runaway | Cooperative interrupt only | **OS process kill** (strongest) |
| Query/mutation wall-clock | Missing (honest) | **Enforced** |
| CPU budget | Missing | **Enforced** (CF platform) |
| Collateral-free kill domain | Not guaranteed | **One invocation, proven** |
| Result/heap ceilings | Present (own names) | Present (own names) |
| Conformance testbed | none for untrusted path | **LLP 0048 twin exists** |
| Distance to gate | Far (needs engine preemption) | Near (needs limit vocabulary + evidence + promotion) |

Neither leg's manifest may claim the other's strength (LLP 0048 §Security
posture, stated asymmetrically). Ibex is the ambient-denial champion; V8 is the
killability champion. Untrusted code needs *both*, and only V8 has the one that
LLP 0009 names as the prerequisite (comprehensive preemption).

## 2. The evidence bar

What concrete, testable evidence would justify flipping a runtime's
`hosted_untrusted_code` gap to "profile evidenced"? The right vehicle already
exists: the LLP 0048 conformance twin
(`crates/snapback-conformance/src/bin/snapback-conformance-twin.rs`) and its adversarial corpus
(`crates/snapback/tests/workerd_twin_v0.rs`). The battery below extends that corpus. Every item
is an *adversary-authored program submitted through `/api/v1/run`'s real path*
(not an owner handler), and the pass condition is a **stable `SNAPBACK_*`
diagnostic + no committed writes + no collateral to a concurrent invocation.**

### Adversarial evidence battery (per runtime)

| # | Attack program | MUST result in |
|---|---|---|
| A1 | Infinite loop `while(true){}` | killed with `SNAPBACK_HANDLER_WALL_CLOCK_EXCEEDED`, no commit, concurrent invocation unaffected |
| A2 | CPU burn just under, then over, the budget | budget-scoped kill; the under-budget run completes |
| A3 | Memory bomb (unbounded array/string growth) | fail-closed OOM diagnostic, process/isolate dies, nothing committed |
| A4 | Deep/infinite recursion | stack-guard refusal, no crash of the host, no commit |
| A5 | Giant result (return > ceiling) | oversized-result refusal *before* commit (`workerd_exec.rs:371` pattern) |
| A6 | Ambient power attempts: `fetch`, `process`, `eval`, `Function("…")`, `require`, `import()`, timers outliving the invocation, `Date.now`, `Math.random` | each refused at the boundary; none observable |
| A7 | Host reach-through / prototype pollution against the injected client and broker | frozen/non-configurable surfaces hold; no privilege escalation |
| A8 | Timing side-channel probes (any residual clock) | no high-resolution clock reachable |
| A9 | Stale-continuation host call after settlement | refused (invocation-epoch guard, `runtime.rs:1007`; LLP 0047 acceptance) |
| A10 | Killed mutation that buffered writes | commits nothing (`crates/snapback/tests/workerd_twin_v0.rs:988-993`) |
| A11 | Host-call-count / rows-read / rows-written flood | refused at the declared ceiling with a structured diagnostic |
| A12 | Concurrent adversary + honest invocation | the kill of the adversary leaves the honest one intact (collateral-free kill domain) |

For **workerd / V8**, A1, A5, A9, A10 already have passing tests in
`crates/snapback/tests/workerd_twin_v0.rs`; A2–A4, A6–A8, A11–A12 are the net-new corpus rows.
The twin's three-class divergence report (contract violation / declared engine
fact / diagnostic noise — LLP 0048 §The conformance contract) is the machine
-readable evidence artifact.

For **Ibex**, A1–A4 are the ones that currently cannot be guaranteed to pass,
because the kill is cooperative. A6–A8 are expected to pass strongly (ambient
denial by construction). The battery is what would *reveal* the preemption gap
as a hard red rather than a documented Missing.

An evidence run must also produce the eight `Enforced` limit rows the manifest
gate reads, computed on the real runtime (LLP 0048's "capability fields computed
on the real runtime," `0048…rfc.md:228-234`), so the manifest is honest rather
than hand-asserted.

## 3. The gap list

### Genuinely missing today, per runtime

**Shared (both runtimes):**

- **G0 — Limit-vocabulary reconciliation.** `UNTRUSTED_CODE_REQUIRED_LIMITS`
  (`manifest.rs:12934`) names eight rows; no target emits five of them
  (`maximum_result_size` on CF, `maximum_rows_read`, `maximum_rows_written`,
  `maximum_host_call_count`, `maximum_heap_size`). Either the manifests must emit
  these rows (computed on the runtime) or the required set must be revised to the
  rows targets actually enforce. **Snapback-only change; low difficulty** but
  needs an author decision on the canonical vocabulary (see OQ2).
- **G1 — Executor + server-side checker.** `/api/v1/run` extracts caller
  authority but ships no executor; `run_code_capability_refusal` hard-refuses
  even a passing manifest (`server.rs:22371`). A real type-checker against
  `code-mode.d.ts` and an executor that binds the injected client to the
  caller's grant and routes every nested call through ordinary admission (LLP
  0204 D6 "Authority") must be built. **Snapback-only; medium difficulty.**
- **G2 — Per-app aggregate fairness.** LLP 0047 §Limits calls concurrency
  ceilings and queue depth a real hosted requirement that belongs to the hosted
  product design, "named here so its absence is a known gap." **Product-layer;
  medium.**

**workerd / V8 specific:**

- **G3 — Platform defense-in-depth vs. local discipline.** Local workerd is not
  a hardened sandbox (LLP 0048 §Security posture). Hosted untrusted execution
  needs Workers-for-Platforms-class enforcement, not just the harness global
  strip. **Depends on Cloudflare platform posture; the local leg is evidence,
  not the enforcement.**
- **G4 — Emit the computed limit rows** (the V8 slice of G0), including
  `maximum_rows_read`/`_written`/`maximum_host_call_count` counted in the host-op
  table. **Snapback-only; low–medium.**

**Ibex specific:**

- **G5 — Comprehensive preemption.** The prerequisite LLP 0009 names. Today the
  restricted-worker kill is a cooperative `ex_hermes_interrupt_eval` plus thread
  teardown; there is no host-forcible, collateral-free kill of a runaway that
  ignores the interrupt, and query/top-level-mutation preemption is Missing.
  Closing this needs **Ibex/Hermes engine work** (a guaranteed interrupt-poll
  cadence or a killable execution boundary), upstreamed through Ibex's review
  discipline before the gitlink advances (LLP 0009 §Supply Chain,
  `0009…rfc.md:979-985`). **High difficulty; not Snapback-only.**
- **G6 — Stack-depth and OOM fail-closed proofs** for the restricted worker
  under adversarial recursion/allocation. **Mix of Snapback harness + Hermes
  behavior verification; medium.**

### Difficulty summary

| Gap | Owner | Difficulty |
|---|---|---|
| G0 limit vocabulary | Snapback | Low (needs author call) |
| G1 executor + checker | Snapback | Medium |
| G2 aggregate fairness | Product | Medium |
| G3 platform DiD (V8) | Cloudflare platform | Medium (external) |
| G4 computed rows (V8) | Snapback | Low–Medium |
| G5 comprehensive preemption (Ibex) | Ibex/Hermes | **High** |
| G6 stack/OOM proofs (Ibex) | Snapback + Hermes | Medium |

## 4. Recommendation

**Promote the V8 leg first; keep Ibex a trusted-local runtime with the gap
declared.**

Rationale, argued from the evidence rather than by default:

1. **The prerequisite is already met on exactly one runtime.** LLP 0009 makes
   comprehensive preemption the named gate. workerd/V8 has it — a proven,
   tested, collateral-free process kill (`workerd_exec.rs:814-830`,
   `crates/snapback/tests/workerd_twin_v0.rs:969`). Ibex does not, and closing G5 requires
   engine-level change in a vendored dependency, which is the highest-cost,
   longest-lead item on the board.
2. **The testbed already exists for V8.** The LLP 0048 conformance twin, its
   three-class divergence report, and four of the twelve battery rows are
   shipped. The V8 evidence battery is an *extension* of running machinery;
   the Ibex one would be built from a runtime that cannot yet pass A1–A4.
3. **The V8 manifest is already two-thirds honest.** `cloudflare-do-sqlite-v8`
   reports `wall_clock_timeout` and `cpu_budget` as `Enforced`. The remaining
   manifest work is vocabulary reconciliation (G0/G4), not new enforcement.

**Phased path for the V8 leg:**

- **P1 — Reconcile the limit vocabulary (G0/G4).** Decide the canonical eight
  rows; emit them computed on the runtime. Author decision + Snapback code.
- **P2 — Land the adversarial battery (§2) as LLP 0048 corpus rows** on the
  `local-conformance-sqlite-workerd-v8` leg, all green, machine-readable report
  retained. This is the E3 adversarial-fixtures evidence LLP 0134 will require.
- **P3 — Build the server-side checker + executor (G1)** behind the still-closed
  `run_code_capability_refusal` arm, with the injected client bound to the
  caller's grant (LLP 0204 D6; LLP 0058 shared-invocation authority governs how
  the prepared grant threads every nested call).
- **P4 — Run the battery on the real Cloudflare target** (LLP 0040 deploy leg),
  confirming platform enforcement (G3), and produce the computed-on-real-runtime
  manifest.
- **P5 — The capability-promotion act (LLP 0134 §4) + author ratification.**
  Remove `hosted_untrusted_code` from the target's gaps and flip the executor
  arm — both author-gated in one landing (`server.rs:22371-22375`).

**What the LLP 0134 / LLP 0058 promotion act requires.** Untrusted code mode is
a per-target capability id; promoting it off `experimental` binds the eight
LLP 0134 §2 evidence items, of which the load-bearing ones here are: **E1**
governing-contract standing (LLP 0047 and LLP 0204's D6 Accepted and witnessed
Implemented, with the untrusted-code acceptance items in LLP 0047 §Acceptance
green); **E2** acceptance-corpus breadth rerun green on the supporting target at
the candidate revision; **E3** the adversarial fixtures above rerunning green in
the same run, *including* the acknowledgment-gate refusal witnessed as the final
record of the gate the promotion removes; **E4** the two-tree capability-claim
audit (candidate + staged promotion tree); and **E8** the author's dated act.
LLP 0058's staged-auth-mode/shared-invocation-authority protocol is the contract
that keeps the injected client's grant bound through every nested call the
program makes, so E3's authority-isolation negatives have a spec to test against.

**Confidence.** *Moderate-high* that workerd/V8 is the correct first runtime and
that the phased path is sound — the enforcement primitive and testbed already
exist, so the remaining work is evidence, vocabulary, and executor construction,
all Snapback-controlled except G3 (which is a platform posture Cloudflare already
provides for wall-clock/CPU). *Moderate* on total effort, gated on G1 (executor +
checker) being more subtle than it looks — binding the client to the caller's
grant across nested admission is where authority bugs hide. *Low* confidence that
Ibex can be made launchable for untrusted code on any near horizon: G5 is
engine-level, upstream, and unscheduled; recommend Ibex explicitly remains the
trusted-local runtime with `hosted_untrusted_code` a declared, honest gap.

## 5. Open questions for the author

1. **Is Ibex untrusted-code execution a goal at all, or is the honest
   trusted-local posture the permanent answer?** If G5 (Hermes comprehensive
   preemption) is not worth funding, we should say so and stop treating Ibex's
   gap as temporary. This changes whether the restricted worker's adversarial
   battery is worth building.
2. **What is the canonical limit vocabulary (G0)?** Should the eight required
   rows in `UNTRUSTED_CODE_REQUIRED_LIMITS` be the contract that targets must
   emit (forcing new computed rows), or should the required set be revised to the
   rows the killable target actually enforces (`maximum_row_bytes`,
   `maximum_storage_bytes`, …)? The gate cannot pass until these agree.
3. **Does "profile evidenced" require the real Cloudflare deploy (P4), or is the
   local `local-conformance-sqlite-workerd-v8` battery (P2) sufficient to flip
   the gap on the hosted target?** LLP 0048 is explicit that local workerd is
   evidence, not a hardened sandbox — so does promotion demand the platform leg?
4. **Should `/api/v1/run` remain single-refusal until the *entire* phased path is
   done, or is there value in landing the executor (G1) behind a still-closed gap
   so the checker can be exercised against the corpus before any target
   promotes?**
5. **Aggregate fairness (G2):** is per-app concurrency/queue-depth enforcement a
   launch blocker for untrusted code, or a fast-follow? LLP 0047 scopes it to the
   hosted product design, but an adversary submitting many programs is a real DoS
   vector the per-invocation limits do not cover.

## Status

Draft. Decision-support research for the author's 2026-08-10 commission on
launching `/api/v1/run` untrusted-code execution. Recommends a runtime and a
phased path; does not design the executor.
