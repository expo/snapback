# TOK2 measurements and decision-fact ledger

The replay reduces terminal output from **20,072 to 5,435 o200k_base tokens
(72.92%)** over 40 commands on three private wave-33 lane copies. All command
arguments and exits match: 37 successes and three refusals. Successful default
outputs are at most three lines; refusals in this replay are three lines.
Focused gate fixtures additionally exercise the nine-line budget and independently
copyable next commands. `check` remains under DX11's existing budgets.

| Command | Calls | Before tokens | After tokens | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| deploy (fresh, staging, production) | 9 | 2,241 | 2,223 | 9,007 | 8,763 |
| deploy --check | 6 | 204 | 153 | 786 | 549 |
| releases | 12 | 2,268 | 407 | 8,490 | 1,483 |
| rollback --check | 3 | 3,075 | 1,536 | 12,407 | 6,648 |
| rollback | 3 | 945 | 269 | 3,532 | 1,000 |
| data | 6 | 10,442 | 149 | 23,046 | 520 |
| test | 1 | 897 | 698 | 4,102 | 3,838 |
| **Total** | **40** | **20,072** | **5,435** | **61,370** | **22,801** |

Separate actual startup replay: 282 → 88 tokens, 803 → 277 bytes, six → three
lines. Both preserve URL-first stdout and the readiness record. Actual
`serve-check` receipt rendering: 29 → 38 tokens, 91 → 145 bytes, one → two lines.
The latter adds the private receipt pointer and is intentionally **not** claimed
as a token saving; complete machine JSON is still 29 tokens for this small case.

`metrics.json` retains per-call bytes/tokens/lines/times and binary SHA-256s,
without store values or raw terminal rows. `replay.py` reproduces the sequence
against `~/sb4-loop/wave33/apps/` using **copies under `/tmp/tok2`**; it never
opens an original store. It needs Python plus tiktoken. Run before/after phases
with the respective pinned binaries. The saved-source test points to the actual
`snapback/` leaf, not its parent deployment metadata directory.

This is a representative workflow replay, not a random sample or an entire
bakeoff rerun. It includes six data reads; their row payloads account for most
of the aggregate saving. Release-only commands improve 8,733 → 4,588 tokens
(47.46%). No claim is made that each command improves by 70%, or that the model's
entire input or elapsed build time falls by that amount. Timings are unpaired
local observations, not latency evidence. The final startup-only guard prevents
a false working-schema warning when source is absent; the 40-command replay has
source present, so that guard does not change its measured presentation.

## Session extraction

`measure-session-output.py` scans wave 32/33/34 Snapback `.agent.ndjson` files,
pairs local/archived Codex calls with actual result blocks and process/cell
polls, and reads Muse bash and bash_input result events. Codex's `input_text`
blocks are included. The sanitized `session-output.json.gz` has 3,785
attributable tool-result records, 15,570,437 UTF-8 bytes and 3,956,005 tokens:

| Wave | Records | Output tokens entering context |
| --- | ---: | ---: |
| 32 | 1,010 | 1,383,764 |
| 33 | 1,748 | 1,409,765 |
| 34 | 1,027 | 1,162,476 |

The archive includes command family and success/refusal/error/running-unknown
per result. Intermediate polls retain unknown outcomes rather than borrowing
success from another chunk. A shell's exit describes that shell; mixed commands
are explicitly composite. Indirect proof runners and package scripts are
included, with script inference based on the final manifest. Composite shell
output cannot be attributed to one constituent command, and dynamically assembled
commands without an identifiable invocation are not claimed complete. These are
observed emitted tokens, **not** later repeated model-input tokens. The extraction
counts tool wrappers because they too enter context; native replay counts stdout
plus stderr. The wave-33 bakeoff and wave-34 early analysis supplied prioritization,
not a multiplier applied to the replay.

## Decision facts retained

Each row is a checklist for the budgeted terminal verdict. The complete old
transcript and structured evidence are in `.snapback4/last/<command>.txt` and
available through `--explain`/`--verbose`. Existing JSON contracts stay complete;
`test --json` and proof-runner JSON add complete structured reports.

| Command | Facts that remain immediately visible |
| --- | --- |
| deploy, including fresh/staging/production | Mode and actual activation/release; target; pending or failed qualification; security fixes/gates; actual backfills; dormant visibility/counts; changed exported result paths/types and missing fields; witnessed questions and hazards; exact next commands when gated. |
| deploy --check | No-write preview and target; changed shape/visibility/backfill/security facts; compatibility result; required next actions. Unchanged repeat is one line, changed repeat prints changed facts. |
| rollback / rollback --check | Target retained release; actual activation or no-write preview; dormant/changed results and data risks; incompatibility/refusal text, including long UTF-8 clauses and double spaces; required action and witness information. |
| releases | Current/selected/version state and pending qualification/security advice; changes only on repeats. Full events/items/cursors remain JSON/detail evidence. |
| data | Selected table, returned count, limit/more/dormant information; explicitly skipped ephemeral inspections; repeated rows use changed IDs/counts. Actual values remain in the named private file and complete JSON. |
| serve startup | URL first, exact readiness protocol; release/clock constraints; descriptor warning when relevant; private full startup facts. Development lifetime/logging and host initialization timing are unchanged. |
| test | Case counts, query status/caps/refusals/denials/not-run counts; finite campaign rather than proof; lack of authored cases; coverage reasons with all affected operation names; synthetic observations needing replay; campaign receipt failure warnings; full failing case clauses/refusal evidence and action. |
| proof runner | Passed/failed verdict, readiness/observed interval/store-lock release or decisive failure, command/code; private complete receipt. JSON returns all fields. |

Unknown type forms retain their full representation. Nullable and omittable
wrappers are distinct. Data-loss/visibility facts are not suppressed by repeat
caches. Preview timestamps, elapsed timings and relative security-notice ages do
not manufacture changes. Corrupt/missing history reprints facts; history never
controls release execution. Reports/history use owner-only permissions,
no-follow reads and atomic replacement. If report custody fails, full evidence
prints to the terminal, even if that exceeds the normal budget; a completed
activation is never reported as rolled back because a detail write failed.

## Validation and provenance

Verbatim Muse and fresh Codex reviews live under `llp/reviews/`; compressed raw
transcripts are retained here. Both independent compact-rendering reviews are
READY. Reviews are source reviews, not executed qualification claims.

`run-scoped.mjs` invokes the affected selector's planning/receipt engine and
retains its conservative full plan. Because shared docs/command metadata expands
to 450 client files and the brief explicitly prohibits the complete pool/five
crates, the scope override is explicit: CLI units, 15 CLI integration targets,
18 actual client consumers, guide and generated API/doc checks, and ref-check.
An initial root inventory attempt failed on unrelated Snapback 1 missing root
deps/ignored generated leaves; Snapback 4's fence excludes those gates. The
scoped runner does not claim the full selector plan or publication qualification.
The worktree-root `WORKSTREAM-REPORT.md` records final receipts, commits and
packed `qualify-linux.mjs --consumer-only` results, including preliminary reds.
