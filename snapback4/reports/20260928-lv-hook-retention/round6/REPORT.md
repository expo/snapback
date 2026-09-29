# LV round 6 — retention and truthful overload together

Branch `sb4-intent/lv-hook-retention`, LV parent `25ed46bfe`, merged main
`dc21eb085fb7bdfbc7ea244b6d1b0ec8c8d8a073`. Read all six prior prompts,
reports/journal entries, LLP 3000.029, the Snapback 4 fence and guide surface,
FU's merge message and round-5 report, and RG round 6 / OS round 8's matrix
rules. Applied `llp-orient`. Ran `git fetch origin` then `git merge origin/main`;
resolved all conflicts. No push, publication, shared tool install or budget change.

## Combined semantics

FU's validated refusal decoding, transport causes, online/offline distinction,
Retry-After/jitter, probe pacing, terminal change-poll refusal behavior and
once-view no-retry protections survive. LV's dependency fences, indexed
reconciliation, complete footprints, ephemeral floors, source deadlines and
asset grant/refusal ordering survive. Sync captures its evidence serial before
FU's bounded safe-read transport; a retry cannot discharge newer cutless evidence.
Online change polling includes asset-only owners and also respects FU's stop flag.
All six added FU journal entries are appended without changing any LV entry;
`merge-preservation.json` records both parent identities and the audit.

The merge needed more than textual conflict resolution:

- Download decoding preserves the validated code and the refusal/grant authority
  cut. Coded `E_RATE_LIMIT` leaves existing handles and retained media readable;
  current `E_ASSET_UNKNOWN` revokes them before callbacks. An old refusal still
  cannot overtake a newer grant. Malformed HTTP bodies are `E_HTTP_RESPONSE`,
  not invented asset authority. E_ASSET_VIEWED leaves the granted first view alone.
- The extracted local asset helper preserves the actual transport failure when
  no retained ordinary media exists. It checks credentials before fallback;
  obsolete failed replies preserve their cause and obsolete successful handles
  are revoked without another download.
- A real combination regression found that exhausted query admission refusals
  entered LV's authoritative reconciliation. A coded admission refusal evaluated
  no authority: direct callers still receive E_RATE_LIMIT, while observations,
  remembered answers and both clocks' floors remain unchanged. Mounted plain
  refreshes retain existing data under its original deadlines. Actual null,
  denial, subset, deadline and scope evidence still invalidate immediately.

LLP 3000.029 §11 records the distinction and compatibility behavior; its existing
§§8–10 remain the fence/footprint/epoch rules. No authorization or meter rule,
capacity, contract shape, dependency or generated publication file changed.
The full model run additionally exposed retries of terminal absence: accepting
a denied result in an already-closed, signed-out or terminal-store scope now
avoids the retired request signal’s three backoffs. All data still meets every
original fence. Three named terminal regressions fail before and pass after.
The scope audit found no broken governing reference or new LLP requirement.

## Astra review

The requested round-5 review was absent at the initial check and appeared during
verification. Astra's verdict is **READY WITH CHANGES**, with no blocking production
finding. Its Low was missing regression coverage when both `ephemeralReads` and
`reads` are absent. Added four process/wasm withdrawal and delayed-reply cases;
all pass. An isolated compiled-client mutation replacing the all-tables fallback
with `[]` fails all four with the intended disclosure assertions. Sources were
not mutated in the tested worktree. See `review-certificates.log.gz` and
`mutant-certificates.{json,log.gz}`.

Astra's previously observed initial-owner timeout remains unexplained. Repeated
passes do not establish its cause; this round makes no claim to resolve it.
Re-read the completed review before committing, with unchanged digest in
`inputs.json`. No review of round 6 itself is claimed.

## Await audit and delivery matrix

Every added/changed LV awaited expression relative to main is explicitly covered,
including awaits moved into media helpers and the changed online refresh. Final
matrix: **166 sites = 49 required + 117 optional**, each transient and persistent;
**333/333** checks pass. All 158 main classifications/recipes/absorbs flags survive.
All cases reach their named site and inject failures, and every optional case
posts each of the three healthy FIFO IDs once while the fault persists.

The detailed nine-row delta, moved-expression accounting, injection boundaries
and retained invariants are in [AWAIT-DELTA.md](./AWAIT-DELTA.md). Exact source/site
censuses, preservation mapping and per-case results are adjacent JSON artifacts.
No original owner or assertion was removed; new sites have no default recipe.

## Qualification

- Broad affected client suite: **1,078 passed, zero failed/cancelled/skipped**,
  431 s. The admission correction preceded this run; the terminal correction came later. The four review cases were
  added afterward and passed separately, and are included in the full run.
- Whole guide: **98/98** (`cargo test -p snapback4-lang --test guide`).
- Server overload: **3/3** (`cargo test -p snapback4 --bin snapback4 overload`).
- Rust independent dependency census: **5/5**
  (`cargo test -p snapback4-lang --test read_dependencies`).
- Complete delivery matrix: **333/333**; combined authority/overload cases **6/6**.
- Astra certificate cases: **4/4**; isolated fallback mutation killed **4/4**.
- Client build/declarations pass. Reference audit: **523 LLP docs, 9,884 refs,
  zero errors or unchecked references**. Whitespace checks pass.

Ran `bash scripts/test.sh` **exactly once**, with command-local `ulimit -n 4096`,
exit **1**. Exact summary:

```text
== 2 failure(s) in 1378 s
   client tests
   client models
```

The client shards report **4,798 pass / 2 fail / 10 skipped**.
Full models report **78 pass / 1 cancelled** (the online session test's
240-second timeout). Rust, fixtures, build/wasm, docs budget, release guard and
all package/app typechecks pass. The three failing/cancelled cases are **ours**:

1. `app replacement never persists a late successor before probing the kept session`:
   make the fixture's replacement probe an explicit held boundary.
2. `server-class watches run locally first and recover remembered server data offline`:
   establish a checked server answer after apply before testing offline remount.
3. `online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`:
   terminal denials unnecessarily took retired-request retries; eliminate those
   waits for safe terminal absence, without weakening data acceptance.

The first two reproduce on the round-5 LV SDK and pass on the isolated main SDK;
they remain LV-attributed failures. No baseline or environmental exemption is
claimed. Full failure names, initial failed repair, controls and resolution are
in FAILURES.md. This is an intermediate red full run, **not** a green final-tree
qualification. The terminal-denial correction was made after the online model
timed out, while the full run completed; final scope qualification is separate.
No timeout, model count or budget changed.

Final correction qualification:

- **558/558** client cases, including FU overload, all 333 matrix cases,
  terminal/session boundaries, residency, durable/ephemeral fences and review
  regressions (`terminal-affected.log.gz`).
- Three terminal-denial regressions pass with zero retry waits; all fail on the
  pre-correction client. The official online session model passes all **5,000**
  sequences in **87.1 s**, with its original **240 s** timeout.
- Official full-count models: **79/79**, zero failed/cancelled/skipped,
  297 s, including **5,000** session sequences on each tier and **3,000**
  online-client interleavings (`models-qualified.log.gz`).
- Final browser witnesses: **3/3**, both LV profile gates plus FU overload
  (`browser-final.log.gz`); whole guide **98/98** (`guide-final.log.gz`);
  package/app typechecks pass (`typecheck-final.log.gz`).

These checks qualify the final corrections separately; the single full run's
failures remain recorded above.

Both browser profile gates report:

```json
{"route":"/conversation/bob","mounts":1,"loadingAfterData":0,"profile":"alice"}
```

The affected command includes FU's overload and real browser overload suites,
LV retention/fencing/footprint/ephemeral suites, independent models, cost tests,
pages, authority and presence. Its exact command is `affected-command.json`.
All intermediate reds and expected counterfactuals are attributed in
[FAILURES.md](./FAILURES.md); counts of overlapping scopes must not be added.
No new Expo/iOS UI qualification is claimed on this Linux host.

## Wasm and custody

Canonical merged build: **2,042,203 B raw / 593,641 B GNU file-input gzip-9**.
Unchanged cap **593,719 B**; **78 B headroom**. This is one gzip byte above the
round-5 recorded artifact, and +633 B over FU's recorded main artifact; neither
is a separately rebuilt attribution control. No overrun or cap adjustment.
SHA-256 `d82c05104aaab6954278a37c1962ac6735b5e4cf91bdc7ddd7f75eafd4458466`.
Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt. See
`wasm-measurement.json`; final source digests are in `qualified-sources.json`.

The local merge commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
No push or publication.
