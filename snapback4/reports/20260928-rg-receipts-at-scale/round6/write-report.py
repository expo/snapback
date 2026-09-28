"""Render the explicit matrix table from the classified source census and results."""
from pathlib import Path
import json
out=Path(__file__).resolve().parent
sites=json.loads((out/'await-sites.json').read_text())
results=json.loads((out/'matrix.json').read_text())
manifest=json.loads((out.parents[2]/'packages/snapback4/test/delivery-fault-sites.json').read_text())
assert len(results)==2*len(sites)
by={(r['index'],r['mode']):r for r in results}
wasm=json.loads((out/'wasm.json').read_text())
report='''# RG round 6 — receipt delivery under repeated faults

Astra's blocking observation-read stall is fixed. The generated matrix found
and fixed one more gate: receipt recovery for an already-proven successful
head. Both operations now schedule the existing retry and let the FIFO visit
later entries. The observation read catches only its own rejection and makes
sync eligibility false; `syncOnce()` keeps its existing failure boundary.
Unknown heads still require custody reads and durable settlement before the
next send. Production changes are three replaced lines in `local.ts`, with no
new state or public surface; the file remains 1,500 lines.

Read rounds 0–5 prompts/reports/RG journal entries, the Snapback 4 fence and
rules, and the complete Astra review before coding. Grok was unfinished at
start; it completed READY during this round and was read in full. Its Low
(recovered event shape), omitted settling-marker control, and weak round-4
exit-code-only control checks are covered below. No waiting for Grok and no
new review delegation. [Context pack](CONTEXT.md).

Inherited merge instruction: fetched and merged origin/main
`ea7ecc896c166c31caf88f843e0c4dce4ea900b6` in local merge `87c918ebf`.
The only conflict was the append-only journal; both parents' entries were
retained in their original order. The implementation is on that merged tree.
No push, publication, version/budget increase or tool installation.

## Reproductions and delivery behavior

Copied Astra's reproduction from
`/tmp/rg-r45-astra-vpk9iwum/snapback4/packages/snapback4/test/rg-extra.test.mjs`
into the audit module: a completed but unobserved success, a second admitted
send, persistently failing observation-only `queued()` read, and eight
five-second retries. It fails before the fix with one POST instead of two
([before](astra-before.log)); it passes after the fix. The round-6 guard
removal controls recreate that failure.

The additional gate is `deliverAcknowledgedReceipt` at the same proven-success
head. A receipt-history rejection used to end the entire FIFO pass. The matrix
injects below that awaited helper, leaving the ordinary queue read healthy;
the persistent case cannot send either healthy tail without the new guard.
Retrying receipt delivery retains the existing reference-counted emission
owners. No receipt is invented and no unknown execution is skipped.

Grok's event-shape check now checks the exact recovered object, including
`replayed: true` and absence of `result`, in replacement integration tests and
both overlapping-owner orders. A separate retiring-settlement test pins its
emission marker across a queue read and confirms bounded cleanup after release.
The existing integration race can be protected by another live snapshot; the
focused test proves the settling guard itself.

## Matrix boundary and invariants

[Manifest](../../../packages/snapback4/test/delivery-fault-sites.json),
[recipes](../../../packages/snapback4/test/delivery-fault-recipes.mjs),
[runner](../../../packages/snapback4/test/delivery-fault-matrix.test.mjs),
[source census](await-sites.json), [results](matrix.json), and
[final TAP](matrix-final.log).

140 sites generate 280 cases: 92 optional and 48 required, each transient and
persistent. A real wasm device is acquired, completes a success without
observing it, then admits two more sends behind a held queue read. Branch
recipes drive acknowledgement, receipt recovery/save, reset housekeeping,
backend adoption, reconnect/probe/change-feed, exit settlement, native fallback,
media home/manifest/byte pruning, hold reasons and clock persistence. No app
hooks or matrix instrumentation enter the distributed client.

The instrumenter uses the TypeScript AST and async call context. Host calls,
fetches, response decoding and stream reads fail below their existing catches;
compound awaits inherit those real failures. Explicit no-op callback recipes
reject the callee instead. The queue iterator's `next()` is included. Six
non-rejecting timer/exit waits are marked O*: a resolve-only promise cannot
honestly be made to reject. Their cases fail the upstream operation once or
persistently, reach the wait and demonstrate bounded recovery. Exit transport
still resolves within its existing one-second bound.

This is the SDK delivery boundary, not recursive fault injection into the wasm
engine or every IndexedDB/native transaction instruction: those are represented
by `DeviceCore.call`. The entry fixture is an admitted, live persona client.
Session revocation/credential deletion, client construction/close, independent
query rendering and media upload/view APIs are separate lifecycles. A revoked
session is not permission to post a healthy send; the awaited refusal checks at
the delivery boundary are included. Reset/adoption bookkeeping uses controlled
host replies; the existing real replacement/restore audit remains independent.
Pruning of emission IDs, receipt counts and metering/notification calls is
synchronous; it adds no await. Their ownership and bounds remain covered by
the audit, pending/clock tests and prior controls. Media byte/manifest pruning
and custody calls that do await are explicit rows below.

The exact manifest rejects a changed/new await in the listed delivery owners.
A second AST boundary seal inventories awaits across the client source tree,
including owners outside that list: a new helper/module cannot silently escape
classification. Updating that seal requires reviewing reachability, then adding
a recipe and required/optional classification for a delivery site. There is no
default recipe; ambiguous/missing sites fail. The two census mutations test both
an added delivery await and an added helper await. This is conservative source
change detection, not a claim of a sound static call-graph analysis.

For every case:

- Freeze time, fail once or on every attempt, and advance eight five-second
  retries. Assert no attempts occur while time stays frozen. Timer delays must
  be among 250/500/1000/2000/4000/5000 ms and stay monotone after the initial
  successful tail settlements (which legitimately reset the existing backoff).
- Optional failures must let all three healthy IDs POST once and emit exactly
  once while the fault remains; `client.write(id)` agrees during the failure.
- Required failures may withhold an unknown head or a receipt lookup. Removing
  the fault must restore progress, FIFO and receipt agreement. "Required" does
  not mean all sites always block: a post-commit result or bounded exit wait may
  preserve progress, while the underlying uncommitted custody call cannot be
  ignored. Each row states the custody/transport reason.
- After recovery, each terminal ID has exactly one `onWrite`, and lookup agrees.
  Transient callers reach their terminal outcome within their wait. A persistent
  fault can outlast the contract's 25-second caller wait and return `pending`;
  same-ID caller collection after repair returns the terminal outcome without
  another POST or event. A Promise that already returned pending is not changed.
- Lost mutation response/processing is necessarily different from optional
  housekeeping: indices 11 and 116 exercise an unknown response and replay the
  same ID (four POST attempts transient; twelve persistent including recovery).
  They keep one terminal notification and FIFO; they do not assert one HTTP
  attempt when its result was lost. Actual server at-most-once remains covered
  by the receipt/settlement suites. No healthy optional-fault send is reposted.

The final result file records actual reachability, injected failures, whether
an outer await propagated rejection, retry delays and POST counts. A swallowed
inner failure is expected for a guarded optional call, not evidence of a missing
injection. Every final case must reach its classified site and inject a fault.

## Awaited-site table

R = required custody/transport read or write; O = optional to healthy delivery;
O* = optional, non-rejecting wait with upstream-failure injection. T/P means
transient/persistent both pass. Full expressions are in the census; long
expressions are abbreviated here. IDs are the manifest's stable case indices.

| ID | Source / owner | Awaited call | Class and reason | T/P |
|---:|---|---|---|---|
'''

def reason(i,r):
 if r['classification']=='optional':
  if r.get('absorbs'):return 'O* — bounded resolve-only wait'
  if i in [52,80,81,95,96]:return 'O — already-proven success; retry recovery, continue FIFO'
  if i in [53,54,63,64,65,66,67,68,82,83]:return 'O — observation only; queued custody is already established'
  if i in [7,50,107,108,109,110,111,112,113,114,139]:return 'O — media housekeeping; preserve repair flag/serial chain'
  if i in [5,13,97]:return 'O — sync preflight; unresolved receipt retains its own custody'
  if i==98:return 'O — known outcome survives failed receipt repair'
  if i in [10,129,130,131]:return 'O — held-reason bookkeeping; retain retryable head'
  if i==133:return 'O — sampled clock metadata; preserve retryable save chain'
  if i in [25,124,125,126,127,128]:return 'O — native discovery/install fallback'
  if i in [8,12]:return 'O — independent query/restore bookkeeping'
  return 'O — observation/reconnect/adoption; healthy outbox remains authoritative'
 if i in [0,1,84,87,88,89,90,91,99,100,101]:return 'R — cannot answer/retire unknown custody without queue/receipt read; store recovery heals'
 if i in [2,6,62,74,75,77,78,86,92,94,105,106]:return 'R — uncommitted terminal custody cannot be discarded; store recovery heals'
 if i in [48,55,57,58,59,60,79,85,93,138]:return 'R — cannot bypass unknown FIFO head or dispatch ownership; store recovery heals'
 if i in [69,70,71,72,73]:return 'R — reopen must validate store/head before authorizing replay; recovery heals'
 if i in [76,102,103,104]:return 'R — exit outcome/custody may remain unknown; bounded exit resumes ordinary recovery'
 return 'R — mutation transport/response has no usable outcome; same-ID retry after recovery'
for i,s in enumerate(sites):
 m=manifest[i]
 assert all((i,mode) in by for mode in ['transient','persistent'])
 expr=s['expression'].replace('|','\\|')
 if len(expr)>155:expr=expr[:152]+'…'
 report+=f"| {i} | `{s['file']}:{s['line']}` {s['owner']} | `{expr}` | {reason(i,m)} | pass/pass |\n"
report+='''
## Mutation controls

[Runner](controls.py), [results](controls.json), [run log](controls-final.log).
The round-6 runner reruns the exact round-5 script (which reruns round 4), copies
its evidence under [prior-controls](prior-controls/), then restores all historical
report bytes. The five round-4 kills must now also contain `ERR_ASSERTION` and
`testCodeFailure`; exit 1 alone is insufficient. Every new kill requires its
named behavioral assertion (or the named census failure), not merely an error.

The 27 new mutations plus 11 prior mutations cover:

- New observation and acknowledged-receipt guards; final-loop sync removal;
  terminal observation delivery/retry; committed-reply recovery; known-receipt
  persistence; pending-receipt sync preflight.
- POST bookkeeping, sync transport/backend, follow, changes and probe guards;
  native discovery/install and legacy JSON fallbacks; bounded exit rejection;
  media/network serial recovery; clock serial/cache recovery; held-reason metadata.
- Exact recovered event shape, active settling-marker pruning, adding an
  unclassified delivery await and adding an await in a new helper.
- Prior media gate/backoff/flag, admission, receipt-save, pre-dispatch and all
  snapshot/replacement/overlapping emission-owner mutations.

Several awaits share one owning guard; the controls remove that guard once,
while the matrix injects at every listed site underneath it. An optional call
whose rejection is safely handled by its enclosing dispatcher has no redundant
catch added merely to satisfy a mutation. Synchronous marker guards are tested
separately. No mutation touches the live source or distributed build.

## Qualification

[Commands](commands.sh) run from `snapback4/`; toolchain Node 24.13.1. Rust uses
`CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
No `scripts/test.sh` invocation; the supervisor owns that landing suite.

| Check | Result | Evidence |
|---|---:|---|
| Client build / typecheck | pass / pass | [build](client-build.log), [types](typecheck.log) |
| Audit including copied Astra reproduction and Grok checks | 60 pass | [audit](audit-final.log) |
| Generated fault matrix + census | 281 pass (280 cases + census) | [matrix](matrix-final.log) |
| Clock / pending / React | 141 pass | [log](clock-pending.log) |
| Receipts / delivery | 212 pass | [log](receipts-delivery.log) |
| Settlement | 90 pass, 1 named skip | [log](settlement.log) |
| Media | 72 pass, 1 named skip | [log](media.log) |
| Transport | 12 pass | [log](transport.log) |
| Web admission | 55 pass | [log](web-admission.log) |
| Whole guide | 94 pass | [Rust log](rust-guide-delivery.log) |
| Rust receipt/delivery modules | 42 pass, 1 ignored benchmark | [Rust log](rust-guide-delivery.log) |
| Native build | pass | [log](native-build.log) |
| Wasm build / existing budget | pass | [log](wasm-build.log), [measurement](wasm.json) |
| Mutation controls | 38/38 killed | [results](controls.json) and prior-controls |
| References / whitespace / source size / append-only journal | pass | [final checks](final-checks.log) |

Totals: 923 client passes and 136 Rust passes, 1,059 passing checks/tests in
those test modules; three explicitly skipped/ignored tests are not passes.
The settlement skip needs a legacy server binary, the media skip is macOS-only,
and the Rust ignore is the opt-in throughput benchmark. None is new.
No baseline or environmental test failure. Ordinary wasm dead-code/unused
warnings remain in the log. No d-01 algorithm or server/device code changes,
no new CPU/browser timing claim, and no per-row pending-list reread.

## Failure ledger

All failures encountered this round are ours, including expected red controls.
The final unmutated qualification is green. Baseline failures: none.
Environmental test failures: none.

| Failure / experiment | Classification and disposition |
|---|---|
| Copied Astra regression before fix: one POST, expected two | Ours, inherited lane defect; fixed and mutation-killed |
| Matrix persistent acknowledged-receipt read stranded the tail | Ours, newly found lane defect; new guard and control |
| Early census/recipe runs: inaccessible branches, required reads treated as optional, missing fault hits | Ours, test construction; branch-specific recipes and explicit classification; retained logs listed below |
| Exit/follow instrumentation had shifted AST offsets; direct JSON injection was outside a catch | Ours, instrumentation; transformed exit assignment after transpile and injected below response methods |
| Reset synthetic flag and buffered changes fixture could loop without waiting | Ours, fixture; bounded reset injection and exhausted-budget fallback; interrupted development runs retained |
| 278 failures after adding census test before top-level awaited imports | Ours, harness lifecycle; Node's root after-hook removed hooks too early; all module imports now precede test registration |
| Receipt-save guard mutation survived when another path repaired the receipt first | Ours, weak fixture; hold alternate repair until target lookup observes the failure; control now dies |
| Grok shape/settling mutations initially survived integration-only selection | Ours, overlapping protections obscured mutation; explicit overlapping event-shape and retiring-settlement checks kill both |
| Four caller-recollection failures at sites 81/96 | Ours, fixture served watermark 10 after applying 11; corrected sync response preserves monotone store head |
| Backoff assertion failed on valid reset after successful tails | Ours, assertion; retain exact allowed delays/no-spin and enforce monotonicity after initial successful settlements; prior reset-every-pass control still dies |
| Fallback media-remove site was not reached with a host-supplied media store | Ours, fixture; select the real fallback storage adapter for its two cases |
| One transient follow-delay case initially injected before reaching the intended wait | Ours, scope; inject in the follow sync context and assert every site is reached |
| Controls: wrong expected message, teardown held admission barrier, later changed census failure text | Ours, runner/assertions; specific messages corrected, queue gate released in teardown; final 38 controls pass |
| Staged whitespace check found blank-space indentation in TAP and a trailing empty Rust log line | Ours, evidence formatting; normalized only trailing whitespace/EOF newlines in round-6 logs |
| Missing guessed paths, stale skill link, wrong working-directory prefix/redirection, explicit TypeScript import at nonexistent hoisted path | Ours, command setup; read-only sibling skill and resolved package imports/paths; no shared-path install |

[Development failure inventory](development-failures.json) enumerates every
failed test name/error by retained development log; [line index](development-failures.txt)
points to the original output. Interrupted `matrix-full-first.log`,
`matrix-full-second.log` and early controls are experiments, not qualification.
Expected control assertion failures are in each mutation log and the controls
JSON. Failed evidence is not counted as a pass or hidden as baseline drift. Round-6 text logs have trailing whitespace and extra EOF blank lines normalized; test output and failure content are retained.

## Wasm and handoff

'''
report+=f"Current rebuilt wasm: **{wasm['raw']:,} B raw / {wasm['gzip9_file_input']:,} B GNU file-input gzip-9**, unchanged {wasm['budget']:,} B budget, **{wasm['headroom']} B headroom**. SHA-256 `{wasm['sha256']}`.\n\n"
report+='''Relative to round 5: raw −968 B, gzip +587 B. These are the current merged
Rust inputs; round 6 changes only TypeScript/tests/docs and contributes no wasm
input delta. The build used the standard script without wasm-opt (its normal
available-tool path); no tool was installed or ceiling changed.

LLP 3000.019 §3.3 now records both proven-success housekeeping boundaries and
the required-custody distinction. One dated journal entry is appended. Commit
locally with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`; push and publish
nothing. Supervisor review/landing remains separate from this local evidence.
'''
(out/'REPORT.md').write_text(report)
