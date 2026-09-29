# LV round 2 — dependency authority and indexed reconciliation

Implemented on `sb4-intent/lv-hook-retention`; local commit only, no push or publication. Started with `git fetch origin && git merge origin/main`. Merge `49a7215f3` preserves both sides of the append-only journal. Read rounds 0–1, their prompts, LLP 3000.029, and Astra's complete NOT READY review. Grok was checked before implementation and again before completion; its completed source review is incorporated. Input digests are in [inputs.json](./inputs.json).

## Design and implementation

[LLP 3000.029 §8](../../../../llp/3000.029-hook-retention-with-invalidation.rfc.md#8-round-2-authority-follows-dependencies), with a Revised line, makes data dependencies the authority unit. Rule-probe tables count. Unknown dependencies conservatively cover all tables; an explicit empty server footprint certifies no data dependencies. No row-level independence exemption is inferred.

A reported cut, authoritative refusal, null, or subset replacement fences local and remembered/composed evaluation of affected dependencies until the replica publishes that evidence. Exactly matching canonical read keys share a replacement. Other affected observations withdraw before callbacks rather than receiving another query's shape. New argument sets and aliases use the same dependency floor. Whole server replacements meet known cuts and request barriers without discharging the replica fence. Known cuts and cutless serial barriers remain independent, so a later numbered replacement or an already-running sync cannot erase cutless evidence. Cutless replies use request ordering, not an invented sequence zero. Existing scope, credential, generation, deadline and delivery gates still apply.

`ReadIndex` maintains canonical-key and dependency-table indexes, including the unknown bucket. Reassigning dependencies updates registration; closing unregisters both. A new table cut sweeps its affected bucket once. Subsequent replacements at that cut visit their exact matching owners. Known unrelated mutation footprints do not schedule a refresh. Cost tests forbid a per-result `values()` scan and measure **800 owner visits for 400 replacements**, for both shared-table and distinct-table populations (also checked at 100 and 200).

The profile proof remains narrow. Online historical mutation receipts preserve observations whose validated interval covers both the receipt and the returned current head. Local sync captures an empty outbox and tracks subsequent prediction effects by table; an unrelated notes admission/settlement cannot cancel the profiles proof. Relevant or unknown effects still cancel it. Gaps, saturated change intervals and own-profile predictions remain invalidation. The guide and operations manual state those limits.

Asset refusals and grants compare authority cuts, then request-start order when cuts tie or either reply omits a cut. The server includes the refusal cut captured under the authority lock. Older refusals cannot revoke newer SDK handles or overwrite cached media; newer refusals fence older in-flight grants before their handles or bytes can be published. Offline cached reads capture the device watermark before revalidating the home, so an unrelated later applied cut does not falsely revoke valid retained media. Expiry, scope changes, transport failures and E_ASSET_VIEWED keep their previous stronger/exception behavior. Copied URL strings or previously decoded pixels are outside SDK ownership.

The change server caches public-put program proofs for the generation and builds them directly from program objects. A 400-program test performs 20 polls with 400 visits, then genuinely adopts a changed rule and requires 800 cumulative visits and replacement proofs. It no longer performs a program-name search inside every program traversal on every poll.

Grok's additional findings are covered: dependency-scoped prediction tracking, a cutless barrier that survives a known cut, qualified profile guide wording, and removal of `answers.replacement` killed by both actual synced-data regressions and the independent model. Grok's claim that cross-key evidence was acceptable is superseded by the user's round-2 requirement and Astra's real reproductions.

## Adversarial witnesses

| Finding | Regression evidence |
| --- | --- |
| Overlapping args and differently shaped aliases | Real HTTP online/process/wasm observations; subset and authoritative null withdraw overlaps without shape copying. |
| New local alias after remote null | Real process and wasm replicas still contain the old row while changes/sync are held; the new direct/observed alias cannot disclose it, then recovers after apply. |
| Historical online replay | Real replay receipt without tables, asserted replayed=true; hold the profile re-read and inspect the still-mounted gate before releasing it. |
| Unrelated prediction during profile apply | Browser wasm over real IndexedDB; hold a profile sync, admit a notes prediction, then apply the held page with the notes send still pending. |
| Older asset refusal / older in-flight grant | Real online/process HTTP replies and retained media; cut-bearing and cutless ordering unit cases. Removing the per-asset refusal guard fails. |
| Reconciliation cost | 100/200/400 owners, shared/distinct tables; 2N visits and no unrelated scan. |
| Repeated change-poll proof work | 400 programs, 20 polls, real generation adoption; removing the cache guard yields 8,000 rather than 400 visits. |

Both browser profile witnesses use the comparative's profile schema and report:

```json
{"route":"/conversation/bob","mounts":1,"loadingAfterData":0,"profile":"alice"}
```

The independent model owns two rows' authorization history, replica application and learned revocations separately from the client. Forty seeded schedules generate 160 events over eight observations, three retention policies, overlapping list arguments, point queries and a differently shaped alias, plus a remote operation unavailable on the replica. Starts, completions, change notifications, apply, unrelated predictions and random completion drains vary independently. It invokes the production evaluation and final reconciliation paths; it does not call the replacement fence as its expected-state update. Removing that fence now fails generated schedules. Intermediate survivors and oracle corrections are disclosed in [FAILURES.md](./FAILURES.md).

All **ten final JavaScript mutation checks** are killed by assertions: overlap withdrawal, replacement call, replacement call under the independent model, dependency fence, profile prediction proof, replay coverage, asset ordering, in-flight per-asset refusal, indexed matching, and cutless sync serial. [Results](./mutations.json), [runner](./mutations.mjs), [output](./mutations-qualified.log.gz). The separate Rust proof-cache mutant is also killed: [output](./mutant-program-proofs-qualified.log.gz).

## Verification and failure accounting

Ran `bash scripts/test.sh` from `snapback4/` **exactly once**. Exact summary:

```text
== 2 failure(s) in 1167 s
   cargo test
   client tests
```

[Full log](./test-sh.log.gz), exit 1. This is an intermediate implementation run, not a green full-suite qualification of the final tree. The main client worker reports 4,508 tests: 4,482 pass, 15 fail, 1 cancelled, 10 skipped. A separately scheduled acquisition worker reports 11/12 passing; its other shards and the server-e2e shards pass. All 79 complete app/session/online model tests pass. Build, wasm, docs budget, release guard, package build/typecheck, chat and Expo typechecks, and fixture wrapper checks pass.

Every ordinary failing name and attribution is in [FAILURES.md](./FAILURES.md) and [failures.json](./failures.json). Only the acquisition failed-preflight assertion is **baseline**, reproduced on merged HEAD with the queued mutation receipt delivered before the failed sync. Its fixture now isolates the intended preflight behavior. All other unexpected failures are **ours**, including test fixtures, stale expectations, the empty-footprint bug, cutless sequence handling, and verification setup. An unbounded scoped Rust invocation exhausted file descriptors; bounded execution passes without a product change. No environmental product-test exemption is claimed. The unavailable dedicated iOS simulator is an **environmental coverage limit**; no new Expo UI success is claimed.

Final qualification scopes overlap; do not add their counts:

| Check | Result |
| --- | --- |
| Canonical affected client tests, including all new regressions, both browser gates, old failed full-suite cases, authority/asset/presence/page/deadline suites, client seams and delivery matrix | **1,417 pass / 0 fail / 0 skipped**, [command](./affected-canonical-command.json), [log](./affected-canonical.log.gz). |
| HTTP Rust tests, `cargo test -p snapback4 --bin snapback4 serve:: -- --test-threads=4` | **156 pass / 0 fail / 4 ignored**, [log](./rust-http-bounded.log.gz). |
| Whole guide, `cargo test -p snapback4-lang --test guide` | **98 pass / 0 fail**, [log](./guide-qualified.log.gz). |
| Client build / declarations | Pass, [log](./build-empty-proof.log.gz). |
| Delivery await audit | All 156 classified sites retained; 313 fault cases pass inside the affected run. Asset helper extraction moves five awaits; cached-home validation adds one read-only state capture. [Audit](./await-audit.json). |
| Reference/whitespace audit | 523 LLP documents, 9,866 refs, zero errors or unchecked refs; `git diff --check` passes. [Log](./ref-check-final.log.gz). |

Final source changes were frozen during the final canonical affected run. No known failing affected case remains. Intermediate red logs retain their original names even when a name contains “qualified” or “final”; the failure inventory prevents treating those as green evidence. The broad wrapper timeout and earlier mutation survivors are also recorded.

Compatibility changes are deliberate: authority propagates across different query names/arguments, with overlapping shapes withdrawn; unrelated known footprints no longer refetch opted-out observations; a receipt can fence an interrupted old base before it is published by apply. Tests distinguish that public fence from the engine's private staged image. No engine authorization, disclosure or meter rule, dependency, budget or core storage policy changes. `local.ts` is 1,485 lines after extracting asset acquisition plumbing. Only reads-06 changes in the guide fact-home inventory.

## Wasm and custody

The canonical wasm is **2,040,999 B raw / 593,213 B GNU file-input gzip-9**, SHA-256 `001b4f9e47acead1dc202060f35e409c4ae31826d972e88965489b3e3cd8c436`. It is byte-identical to rounds 0–1. Cap remains 593,719 B, leaving **506 B**. [Measurement](./wasm-measurement.json).

No shared tool installation, push, deployment or publication. The local commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
