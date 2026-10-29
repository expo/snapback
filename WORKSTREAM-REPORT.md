# Integration 34 — Snapback 4 0.4.50

Worktree: `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
This report is committed before the final landing gates so they can bind an
unchanging commit. Actual final verdicts, receipt paths and the pushed commit are
recorded in `/tmp/integration34/final-evidence.json`. Delivery requires those
gates to pass; an earlier red is never relabelled as a pass.

## Merges and version

Started clean on the existing Integration 33/report history. Initial main merge
`7c60e07cf7` includes `5913715c25`, the requested publication/supervisor fixes and
the additional web-startup landing. Merged the four commissioned tips with
`--no-ff`, in order:

| Lane | Tip | Merge |
| --- | --- | --- |
| TOK6 | `3190405978` | `05144a6fa7` |
| STARTER2 | `bf4c889fda` | `dcdb79d06f` |
| VER2 | `36d7802605` | `cdfed56f45` |
| DX17 | `ec20e324c7` | `9bedffb894` |

Early version bump: `ca4be0ad4a`, **snapback4 0.4.50: integrate bounded guides,
starter repairs and one verify loop**. Cargo/workspace lock and all four published
package manifests agree. The consolidated 0.4.50 Guide changes entry and complete
24-version historical changelog are retained by `1590117dfa`.

Fetched again and merged main `63af15cff1` as `3725cea692`: incoming research,
benchmark evidence, tickets and journal entries only; no crates or client runtime
changed. Both append-only journal tails were preserved. A final fetch and any
required integration still precede the non-force push to `main`.

## Overlap resolution

STARTER2/VER2 share one ordered verify path and one visible stderr heartbeat,
initially and every five seconds across phase boundaries. Check and shutdown
always execute. Acceptance/frontend successes can be reused only under VER2's
conservative source/environment/live-session rules; direct phases always run.
The bounded stdout verdict retains original refusals and targeted reruns.
STARTER2's browser helpers, typed write helper, successful-check handoff and safe
diagnostic repairs remain. Both previous generated README suffixes remain owned;
application edits remain owned by the application.

TOK6's app-specific API routing, explicit generic digests and bounded embedded
references remain. DX17's consolidated recipe and checker occupy the day-two
surface. Frozen caller outcomes remain observations; current-client failures and
cleanup remain strict. The workflow stays at 7,996 source bytes, day2 at 7,998.

A faulty conflict helper initially truncated starter/docs content. `e3446143e6`
restored the starter module, all four LLP subsections and the complete journal;
`1590117dfa` restored the entire historical changelog from main and consolidated
all four 0.4.50 notes. Original build/test reds are retained. The final source has
no conflict markers or lost historical version entries.

## npm cache and fresh-store leaks

`ad91d3b34c` introduces a creator-owned disposable npm cache for maintained packed
proof/test entry points, inherited by nested commands. Both cache-variable cases
are set identically. Client-file runners own each file's cache and TMPDIR and
remove them after process-group cleanup, including forced child exits. The suite
shell owns its cache via its existing cleanup trap. Clean userspaces keep caches
inside disposable userspaces; tests never clear the shared home cache.

`1606aaa40c` transports the helper into relocated test fixtures;
`ac3b955f1c` transports it with the DX8 installed consumer and removes the remaining
shared/single-case overrides; `ac9cafb694` and `45fe3eb97f` cover loopbar drivers
and standalone ceremony commands. No global cache fallback remains there.

`npm-cache.test.mjs` runs real npm twice on distinct pack bytes through the real
publication command owner. Under an isolated HOME, default `~/.npm` growth is
exactly zero and the private cache is removed on both exit 0 and exit 7. This is
an executed packed-install guard, not a fake npm or reproducible-pack assumption.

Fresh-host Rust fixtures confine child TMPDIR to fixture-owned roots. The real
`dev_reset` regression observes a fresh store there, kills the host, then proves
fixture cleanup removes it. Client-file confinement covers JS timeout/group-kill
paths. Closed `issues/closed/20261028-snapback4-test-runs-leak-fresh-store-dirs.md`.
No product startup sweep or foreign/wave store access was introduced.

## Reviews and verification evidence

Both fresh Codex/high and Muse/high delta reviews returned READY on
`1606aaa40c..ac3b955f1c`. Actual outputs and provenance are committed under
`llp/reviews/3000.037.000-integration34-*-round{1,2}.*`. Round 1's material DX8 and
DX9 findings were fixed, and Muse's optional ceremony advisory was also applied.
Reviews do not confer publication qualification or measured dollar savings.

Completed preflight and conflict evidence under `/tmp/integration34/`:

- Native, locked WASM and client builds/typechecks passed.
- Conflict Node regressions: 23 passed; final cache/progress/relocation checks:
  8 passed. The real fresh-store kill regression passed.
- Root generated-artifact bootstrap/check, inventories, docs budget and ref-check
  passed. Root guide: 22 passed, zero failures/skips/preconditions. Final gates
  repeat affected root checks after the incoming documentation merge.
- A direct actual-CLI TOK1 probe passed: 4,845-byte app packet, named openRequest
  navigation with evidence args, explicit generic client/proof/auth fingerprints.
- The literal broad affected run is retained at
  `target/affected/ad91d3b34c85-1793301861165.json` and
  `/tmp/integration34/affected.log`. It spans source changes and is not a final
  pass. Its two obsolete CLI assertions were corrected in `ac3b955f1c` and
  `d97f98fd4e`; its other completed crate results remain evidence, not relabelled
  qualification. The full initial plan remains recoverable.
- Complete `qualify-linux.mjs --consumer-only` chain passed at `d97f98fd4e`:
  `/tmp/integration34/consumer-r3/consumer.json`. Twelve generated frontend
  witnesses, six host starter/toolchain cases, and Ubuntu 24.04/Alpine clean
  userspaces passed. This receipt correctly states `publicationQualified:false`.
  The subsequent history restoration and incoming documentation are requalified
  by the complete final red check, rather than attributed to this earlier HEAD.
  Earlier DX8/helper and DAY5/assertion reds remain in `consumer.log` and
  `consumer-final.log`; neither has a passing receipt.

The final lean affected pass uses the selector's own `planAffected`/`runPlan`
source binding. Both complete and scoped plans are retained under
`/tmp/integration34/affected-final/`. The version/corpus changes conservatively
select unrelated full crate suites, models and semantic difftests. The scoped
pass retains CLI units and changed/relevant integrations, the language suite,
changed client tests plus runner regressions, builds, fixtures and root checks;
only the unrelated W8B calibration is excluded from its CLI targets. The full
publication red check retains all omitted work, including W8B and the full client
pool. Scope overrides are explicit; a scoped affected receipt is not a full-suite
or publication claim. No language/planner/store semantics changed.

Final affected receipt pointer:
`/tmp/integration34/affected-final/receipt-path.txt`.

Final complete Linux publication red-check receipt:
`/tmp/integration34/redcheck-final/qualification/receipt.json`.

The supplied `~/sb4-pub-0447-kit/redcheck-at.sh` actually takes a records directory
and hardcodes a forbidden publication worktree. Its equivalent complete
prepare/full-qualifier sequence is adapted at
`/tmp/integration34/redcheck-at-safe.sh` for this worktree and an explicit commit;
the run retains the original driver's digest and its own exact driver. It never
accesses the active 0.4.49 publication worktree or `target/publication/`.
Qualification uses private strace 6.17 after the lane-documented 6.8 decoder issue;
no listener-audit rule is relaxed. The complete red check must produce exit 0,
a green suite and an exact-source receipt before push.

## WASM, resources and limits

Strict measurement (`wasm-measure.log`) passed family and server-only absence
checks: **2,416,593 raw / 738,504 gzip / 556,149 Brotli bytes**. Budget:
**739,004 gzip bytes**, exactly measurement + 500 B. Whole-artifact gzip is 46 B
below 0.4.49, with unchanged raw length; no independent feature attribution or
runtime-ceiling increase is claimed.

Final long jobs use 60G user scopes, incremental/debug payloads disabled and Cargo
jobs capped at 16, with at most two heavy jobs. No full test.sh was invoked as an
ordinary landing check; the commissioned full qualifier owns the complete suite.
All commits use Charlie Cheever's requested identity. Other worktrees, active
publication paths and wave stores remain untouched.

No npm publication or Mac qualification is claimed. The coordinator's same-window
combined cost gate remains separate. Lane samples are not individually
significant; dollar savings are not inferred from correctness, mechanical proof
reuse or these integration checks.
