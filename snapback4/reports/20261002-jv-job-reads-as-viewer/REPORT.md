# JV round 0 — jobs read as their recipients

2026-10-02. Branch `sb4-intent/jv-job-reads-as-viewer`, based on
`738d45830c9d51c9c92f65180c56cbecb2f2b068`. Local commit only; no push or publication.

## Result and design

LLP 3000.007 **§21.12** extends §21.1's digest contract. A job sweep can use
`as recipient.principal:` to evaluate reads and ordinary declared Quarry queries
with the recipient's rules, audiences, field disclosure and expiry. The block
updates outer local accumulators; writes and effects happen afterward.

```quarry
    unread = 0
    as p.principal:
      for chat in all(unreadPreview(periodStart, periodEnd, null)):
        unread = unread + chat.unread
    if unread > 0:
      emit push { principal: p.principal, unread } once [p.principal, periodEnd]
```

The excerpt belongs inside a sweep and uses the complete jobs-card schema.
The jobs card now uses that UI query without a recipient membership walk in
the job; one sentence retains the intentional system-read pattern. The language
card includes the new syntax. The actions card distinguishes the new body scope
from schedule-level `as`, which still only names an action's service seat.

Persona, user, guest, application and service principals are allowed. `system`,
null and malformed identities refuse. Selection needs no login session.
Writes, emits, ID minting and guessed once-consumption calls refuse at compile
time, including expanded helpers, with “compute inside as; act outside” repair.
Reading an asset reference does not consume it; Quarry has no asset-consumption
operation. Invalid placement, nesting, escaping returns, unsupported query
calls and incomplete reads have dedicated diagnostics on `guide jobs`.

A direct query call returns `{ data, next }`. The streaming `all(query(...))`
loop verifies that the declared cursor actually owns the returned list, follows
every cursor and retains one page at a time. Start with null and exhaust the
loop for an exact total; `break` explicitly requests an early stop. Native,
held and ephemeral-table queries are not admitted. Unavailable or non-uniform
reads refuse instead of supplying a partial digest.

Ordinary server queries and job query calls use `Runner::run_server_query`,
including the ordinary server search substitution. No authorization evaluator
was added. Fresh read frames prevent viewer-cache leakage, while sharing the
chunk's rows/transaction, clock, public meter and guarded authorization work
allowance. No page resets the meter. Existing adaptive retry and parking own
over-budget recipients and roll back their effects and once keys. Embedded
bound queries/helpers participate in the existing job generation hash.

## Qualification

The final affected run is **142 passed, zero failed**:

| Target | Passed |
| --- | ---: |
| `job_viewer` | 9 |
| Entire `guide` target | 110 |
| `audience_bounds` | 10 |
| `helper_placement` | 8 |
| `intent_followup` | 5 |

Command from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test job_viewer --test guide --test audience_bounds --test helper_placement --test intent_followup
```

The deterministic randomized property test compares complete returned rows,
field presence and unread totals against ordinary client queries over the same
unchanged data snapshot and pinned clock: 24 datasets, 27 rooms each, 35 messages per room
(22,680 messages), six principals including no-access and removed-member
controls. Membership, read ordinals, sender, message time, tombstones and
expiry are varied; expiry includes one millisecond before, exactly at, and one
millisecond after the pinned clock. Both message pages and recipient chat pages
continue. Separate tests cover service-only rules, direct reads, earlier writes
in the same chunk, pinned `now`, restoring system authority, compile refusals,
forged effectful IR, cursor ownership, query-generation drift and a 17,000-row
recipient that parks at chunk size one with no effect or once key.

Two persisted-engine tests compare modern and hand-written digests across a
mid-period restart, rerun and idle period. One compiles the full archived
Calibration #28 schema/config/schedule, changing only the membership loop and
adding its UI query. It covers five chats, removed/no-access recipients,
follows/posts, expiry, tombstones, already-read and out-of-period messages.

`host-replay.mjs` additionally drives the actual native HTTP host and SDK
worker with a durable ledger. It replays Calibration #28's M8 five-person
fixture against the original archived job and its viewer-query replacement.
All application HTTP connections close before the boundary; there are no
open application clients. A SIGTERM and fresh listener restart at the
120-second period's midpoint, followed by completion and one idle period,
produce identical payloads:

| Recipient | New followers | Following posts | Unread messages | Unread chats |
| --- | ---: | ---: | ---: | ---: |
| D1 | 1 | 2 | 0 | 0 |
| D3 | 0 | 2 | 3 | 1 |
| D5 | 0 | 0 | 5 | 1 |
| D2, D4 | No digest | No digest | No digest | No digest |

Each implementation delivered 11 effects (eight message pushes and three
digests), zero duplicate worker idempotency keys, and zero idle-period digests.
The replay uses the supported development clock to advance the same periods;
it does not wait two wall-clock minutes. Logs retain listener PIDs and counts,
never service tokens.

`cargo check --workspace` passes. `./ref-check --verbose` reports:
`ref-check: ok — 525 LLP docs, 10072 refs in 31557 files, 0 errors, 0 unchecked`.

### Full suite

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
once from `snapback4/`, exit **0**. Exact summary:

```text
== 0 failure(s) in 1561 s
```

All phases pass: cargo build, wasm build, docs budget, release guard, package
typecheck/build, chat check, Rust tests, chat/Expo typechecks, fixture tests,
client tests and client models. Rust runs 284 binaries / 997 executions plus
workspace doctests. Client tests: 5,768 passed, zero failed, 10 skipped.
Models: 79 passed, zero failed, preserving 5,000 online + 5,000 local session
sequences and 3,000 online-client interleavings. Product code was frozen before
this run. Final qualification failures: **ours 0, baseline 0, environmental 0**.

See [FAILURES.md](FAILURES.md) for every development/qualification failure and
its disposition. No inherited failure is called baseline without a current-main
reproduction.

## Wasm ratchet

Locked Linux build: **2,038,385 B raw / 611,844 B gzip**. The full-suite build
confirms the standalone final measurement. The old 610,782 B cap is exceeded
by 1,062 B. The device carries the new IR codecs because backend program
serialization includes jobs, plus a fail-closed server-only execution refusal.
The viewer-query implementation itself is SQLite/server-only. Removing these
codecs would require changing the backend program format/custody beyond this
lane.

As authorized, `metrics/wasm-budget.json` raises the ratchet to **612,474 B**:
611,844 + 130 B for the stated macOS offset + 500 B headroom. macOS is estimated,
not measured here; its estimated gzip range is 611,954–611,974 B, leaving
500–520 B. Runtime meter ceilings are unchanged. The prior recorded Linux
artifact was 2,032,879 / 610,174 B; it was not rebuilt for a size comparison,
so no measured feature-only delta is claimed.

## Evidence

- [Affected tests](affected-final.log), [host replay](host-replay.log) and
  [reproducible host script](host-replay.mjs).
- [Full suite](test-sh.log), [workspace check](workspace-check.log),
  [final reference audit](ref-check-final.log), [final wasm build](wasm-final.log).
- [Failure ledger](FAILURES.md); earlier logs preserve corrected development
  failures rather than silently replacing them.

## Round 1 — review corrections (2026-10-02)

Astra's NOT READY and Grok's READY WITH CHANGES findings supplied by the
operator are addressed below. This is implementation/qualification evidence,
not a new independent review verdict. Round 0 above remains the historical
record. Branch `sb4-intent/jv-job-reads-as-viewer`; no push or publication.

### Corrections and read audit

| Finding | Correction and evidence |
| --- | --- |
| Astra P1 / Grok Medium: physical authorization exhaustion parks fitting work | Adaptive sweeps halve on internal `AuthorizationBudget` as well as `Bound`. The 300 independent comment→task→project→org chains with 16 member recipients finish in **2 chunks of 8, 3 retries**, each with `n=300`. All 32 before/after effects are unique, including a rerun. Sixteen calls for one recipient park at **size 1, 6 retries, E_RULE**, with no effects or keys. The internal variant remains distinct from an ordinary rule denial; no public diagnostic or allowance is widened. |
| Astra P1 / Grok Medium: direct incomplete reads commit | The common job read check now includes `non_uniform` and scalar unavailability, at both scope and declared-query exits. Unavailable scalar unwinds map to E_JOB_VIEWER_READ while budget errors retain their adaptive-retry identity. Non-uniform direct pages, loops, count, sum and exists, inline and through helpers, refuse and roll back an earlier emit/once key. |
| Astra P2: inner loops treated as sweeps | Enclosing placement moves to the existing `caller_loops` counter while `loops` starts fresh for lexical jumps. Unbounded public-table folds compile and return 3, inline and through helpers. Bare break/continue use E_JOB_VIEWER_FLOW; jumps inside inner loops remain valid. |
| Astra P2: viewer-dependent type facts survive | Both authority edges conservatively discard all pure-call facts, including facts on argument roots and implicit/transitive viewer dependencies. Snapshot field facts stay valid. Guards within the new authority can refine calls normally. Entry regressions cover direct, transitive and explicit-viewer helpers; an exit regression uses a fact on an assigned outer argument. |
| Astra P2: invalid runtime principal types | Null, integer, boolean, array and object values refuse before scope execution with E_JOB_VIEWER_PRINCIPAL. Empty string/ID and system refuse too. Valid ID/string principals retain their existing meaning. |
| Grok: direct ephemeral reads | The binder's table lookup refuses ephemeral data within the scope with E_JOB_VIEWER_QUERY. It covers points, scans, aggregates, exists, helper expansion and loop domains; declared-query validation remains in place. |
| Grok: raw lookup cache | Clear the one-slot cache on entry and exit of each read frame, including called queries. Keep the physical allowance and public meter, and accumulate `read_tables` as dependency bookkeeping. None of these retained items is an authorization verdict or disclosed row cache. The boundary unit test checks clearing without replenishing the allowance. |
| Grok: device evaluation order | Web builds omit the server-only builtin variants and reject them during decode. Native devices refuse before evaluating arguments, including a JobQuery all-loop domain. A poison argument must never execute. |
| Grok: transaction wording | The jobs card and LLP §21.12 explicitly say that reads see earlier uncommitted writes in the same chunk. A separate client transaction sees those writes only after commit. Equivalence applies to the same row snapshot and pinned clock. |

Read-form coverage is deliberate:

- **Point reads and keyed exists:** ordinary authorization may return null/false
  for a hidden or absent row while certifying that point answer. Tests compare
  visible, hidden and absent points to ordinary client results; those complete
  answers remain allowed.
- **Pages and for loops:** every executed scan sets the ordinary runner's
  monotone completeness flags. The enclosing `as` exit refuses a non-uniform
  answer even if the loop terminates or its result is assigned away.
- **Count and sum:** bounded pages retain those same flags; streaming scalar
  coverage refuses unavailable totals and the job adapter supplies the same
  E_JOB_VIEWER_READ diagnostic. Non-uniform unbounded domains already refuse
  during compilation; uniform owner-pinned totals still agree with clients.
- **Exists:** keyed probes retain ordinary complete true/false semantics;
  domain existence goes through scan/scalar coverage and cannot convert an
  incomplete answer into a digest.
- **Helpers:** expansion uses the same runner and flags, with the authority
  boundary outside the expansion. Both direct and helper forms are exercised.
- **Declared queries and all:** fresh frames use the same check and ordinary
  query evaluator; each page shares the physical allowance and public meter.
  The prior paging/search, expiry, disclosure, through, views, receipt and
  once-reference evidence remains applicable; it was not re-litigated here.

### Regressions and qualification

Affected integration run: **197 passed, zero failed** (18 job viewer, 110
guide, 10 audience bounds, 8 helper placement, 5 intent follow-up, 15 ephemeral,
10 read-through, 14 read-through transactions, 7 server opt-in). The cache
boundary unit test also passes. Final full-suite execution covers the last
additional native-device all-loop assertion and final guide wording.

The existing randomized equivalence property now adds **24 worlds with 35
owner-ruled documents each**, five readers (including no access), and seven
read forms. It compares **1,680 job outcomes** (840 direct, 840 query calls):
960 incomplete results must park without effects, and 720 complete results
must match ordinary query data. This extends the original 24-world membership,
message, field-disclosure and expiry property rather than replacing it.

An isolated checkout of exact **5e51108213** was rebuilt with the regression
module and modified property test, with no production edits. It reports
**9 passed / 9 failed**: all five Astra regressions fail, as do the expanded
property, direct-ephemeral refusal, device-stub identity and device builtin
refusal checks. The transplanted cache-boundary unit test separately fails at
its entry-cache assertion. These are expected negative controls, not baseline
qualification failures. See [negative-round0.log](round1/negative-round0.log)
and [negative-cache.log](round1/negative-cache.log).

The actual built web device also opens and reopens digest stubs, executes an
ordinary query, refuses a job query, and rejects JobAs plus both JobQuery
forms during decoding, before their poison argument can execute:
[wasm-device-repro.log](round1/wasm-device-repro.log), reproduced by
`node snapback4/reports/20261002-jv-job-reads-as-viewer/round1/wasm-fence.mjs`.
Running that same witness against a fresh round-0 Wasm build fails: all three
forms decode and execute the poison argument (ARGUMENT_EXECUTED). See
[negative-wasm.log](round1/negative-wasm.log).

`./ref-check --verbose` passes: `ref-check: ok — 525 LLP docs, 10074 refs in
31559 files, 0 errors, 0 unchecked`.

Ran `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
**once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1843 s
```

Every phase passed. Rust: 284 binaries / 997 executions plus workspace
doctests. Clients: **5,768 passed, zero failed, 10 skipped**. Models:
**79 passed, zero failed**, retaining 5,000 online and 5,000 local session
sequences plus 3,000 online-client interleavings. Injected E_AUTH refusals in
the model log are expected faults, not failed assertions. Implementation,
suite test sources and the budget remained unchanged during this run.

Final qualification failures: **ours 0, baseline 0, environmental 0**.
No baseline failure is claimed, so no current-main failure reproduction is
needed. Every corrected development failure and expected negative control is
listed in [FAILURES.md](FAILURES.md).

### Paired Wasm measurement and identity

Both builds use `scripts/build-wasm.sh`, Rust 1.97.0, wasm-bindgen 0.2.127,
locked Binaryen 132.0.0, the wasm size profile and the same Linux host.
The baseline was rebuilt from **738d45830c9d51c9c92f65180c56cbecb2f2b068**.

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Paired main rebuild | 2,032,879 | 610,174 |
| Round 1, complete server-only fence | 2,032,879 | 610,170 |
| Delta versus rebuilt main | 0 | **−4** |
| Round 0, rebuilt control (5e51108213) | 2,038,385 | 611,844 |

Round 1 reclaims **1,674 gzip bytes versus the rebuilt round-0 control**,
which exactly matches its historical record. The feature's measured delta
against the paired main control is −4 bytes, not +1,670. An intermediate codec-only omission measured
611,117 gzip bytes; omitting the variants too removes the remaining code/layout
cost. Full-suite build independently confirms 610,170. The ratchet returns
to the pre-JV **610,782 B**, with 612 B Linux headroom; macOS was not measured.

`backend_programs` sends job metadata with an ordinary literal-return body
containing the digest of the **complete server Program**. A job edit, including
an embedded query or expanded helper edit, still changes device backend
identity even without a generation change. Query/mutation bodies remain exact.
The stub uses existing IR, with no new decoder vocabulary; both device hosts
accept it. Web builds exclude JobAs/JobQuery; native devices still understand
server IR but cannot execute these forms. The unpublished round-0 transport of full job bodies to web devices is not
retained as a compatibility format. Stored server
programs, server activation hashes and job-generation checks retain complete
bodies. The existing queued-job generation-change regression passes.

Evidence: [main rebuild](round1/wasm-main-final.log),
[round-0 rebuild](round1/wasm-round0.log),
[lane rebuild](round1/wasm-lane-gated.log),
[affected tests](round1/affected-final.log),
[full suite](round1/test-sh.log), and the round-1 additions to
[FAILURES.md](FAILURES.md).

### Scoped LLP orientation and reconciliation

Scope: job chunks/read frames, binder authority boundaries, device backend IR
and the jobs guide. Governing documents are LLP 3000 (root, current),
LLP 3000.007 §21.12 and §5.2 (current), LLP 3000.013 §5.2 (current), and
LLP 3000.015 §2 (current). The Snapback 4 fence excludes the older tracks'
foundation gates. Constraints/rationale followed: one interpreter under
LLP 3000 §7; adaptive atomic chunks under LLP 3000.013 §5.2; shared physical
allowance under LLP 3000.015 §2; recipient read authority and transaction
semantics under LLP 3000.007 §21.12. No runtime ceiling is raised.

The existing §21.12 and LLP 3000.013 §5.2 are updated in place; the guide states the transaction and
refusal behavior, and the journal gets one append-only entry. Relevant @refs
still resolve. Remaining uncertainty is the unmeasured macOS artifact, covered
by the restored pre-JV cap's existing reserve. Hand-off: none.
