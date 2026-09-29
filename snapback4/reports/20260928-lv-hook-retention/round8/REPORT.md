# LV round 8 — expiry retries keep each invocation’s cursor

Branch `sb4-intent/lv-hook-retention`, starting at round-7
`c89758d1353ef453fb2e7bfb161d70bc89484b97`. Read rounds 0–7’s reports,
lane journal entries and prompts, LLP 3000.029, and the governing expiry/read
contracts. Applied `llp-orient`. Fetched origin: main advanced only to
`4a1e30ca7a02dc1d127ae34e2797678c0d50cf71`; `git merge-tree --write-tree`
reported no conflicts, so no merge was performed. No push or publication.

## Finding and correction

**The assertion was wrong; the product preserves the requested page.** The log
combined two invocations and assumed that only its final request could belong to
the continuation. Late expiry evidence may retire an attempt of either call.
For page one, every attempt must use `c: null`; for page two, every attempt must
use the accepted first page’s `next`. The latter cannot be reset to null or
advanced to a discarded reply’s cursor.

The fixture froze `/changes` before/after `fetch`, but a streaming fetch can
return heartbeat headers before its final body. A poll started before the freeze
can finish during page two. `waitForChange` processes its real cut and calls
`answers.changed`; `runLocal` rejects the older attempt and evaluates again with
the original arguments. Even evidence at a cut already reported by the first
server answer retires that in-flight attempt. This is the dependency-fence
behavior of LLP 3000.029 §§7–9, not permission to retain expired results.

LLP 3000.016 §2.2 requires original-argument fallback, cursor included. LLP
3000.028 §3.1 preserves expiry/publication fences; its §3.3 consumed-prefix and
mixed-search rules remain separate. The client/reads/expiry guide was read and
already describes immediate deadline withdrawal and cursor-based continuation.
LLP 3000.029’s Revised line and new §12 explain the false test assumption and
pin the per-invocation rule. No production TypeScript/Rust, public contract,
guide promise, meter, dependency, timeout or budget changed. No new gate or
LLP was added; no skill hand-off was needed.

The existing test now splits its request log at the actual call boundary. Four
new deterministic cases hold the real change-stream body until page two starts,
then process its expiry cut with sync still parked. They cover direct/observed
first pages on wasm and native process. Each requires exactly two continuation
requests carrying the same input cursor, rejects the expired local branch’s
cursor, preserves loading throughout the held first-page fallback, and verifies
all surviving rows exactly once with an expired second-page row omitted.

## Reproduction and controls

- Round-7 product, original test: **14/14**. Fifty sequential pagination runs
  (**200 cases**) and 100 runs across eight processes (**400 cases**) all passed;
  a separate 20-run fetch-delay probe (**80 cases**) also passed. These are timing
  probes, not evidence that the supervisor’s failure was absent.
- Controlled scheduling against the unchanged round-7 product and original
  assertion reproduces the failure in **4/4** cases, on **both covered hosts**:
  direct/observed first pages each produce `null, next, next` with correct rows.
  Only streaming delivery timing and failure diagnostics change in this probe;
  server metadata is real. See [trace](./controlled-before.log.gz) and
  [executed probe](./controlled-before.test.mjs.gz). The supervisor’s original log
  contains no packet trace, so this establishes the failure mechanism rather
  than claiming to recover its exact original event ordering.
- Revised complete expiry file: **18/18**. The four deterministic witnesses
  produce `audits-5, audits-4, audits-3, audits-1, audits-0`, terminal and complete;
  `audits-2` expired and never appears.
- Three isolated controls each fail all **4/4** intended cases with assertions:
  restore the old cross-invocation assertion; reset a retried continuation to
  null (duplicates page one); leak the expired local cursor (fails the expected
  post-expiry local branch). No control replaces the live SDK. Runnable command:
  `node reports/20260928-lv-hook-retention/round8/controls.mjs .` from `snapback4/`.
  [Results](./controls.json); [runner](./controls.mjs).

## Qualification

Ran `bash scripts/test.sh` from `snapback4/` **exactly once**, with command-local
`ulimit -n 4096` and normal suite concurrency/counts/timeouts. The final expiry test was unchanged throughout this run. The social fixture
correction below followed its failing stage while the model stage completed.
Exit: **1**. Exact summary:

```text
== 1 failure(s) in 1181 s
   client tests
```

[Full log](./test-sh.log.gz). **4,288 Rust tests pass (33 ignored); client shards total 4,836 pass /
1 fail / 10 skipped; 79/79 full-count models and 9/9 fixture tests pass.**
All other top-level stages pass. This is a red full run, not green final-tree
qualification. No second full run was made under the requested one-run limit;
a green full run remains required before landing. [Structured result](./full-run.json).

Separate affected scopes overlap and must not be added:

| Check | Result |
| --- | --- |
| Affected retention/fencing/footprint/ephemeral, expiry, search, FU overload/transports, browser and delivery matrix | **1,021/1,021**, zero failures/cancellations/skips, 114.9 s; [command](./affected-command.json), [log](./affected.log.gz). Two diagnostic data-presence assertions were added after this run began; the full suite above includes them. |
| Expiry file | **18/18**, zero failures/cancellations/skips; [log](./expiry-qualified.log.gz). |
| Whole guide | **98/98**, `cargo test -p snapback4-lang --test guide`; [log](./guide.log.gz). |
| Delivery matrix, included in affected run | **333/333**, all 166 existing site classifications unchanged; no product awaits added/moved. |
| Browser witnesses, included in affected run | **3/3**; both profile gates retain `/conversation/bob`, one mount and zero loading flashes; FU overload passes. |
| Ref-check and whitespace | **523 LLPs, 9,888 refs, zero errors/unchecked**; [log](./ref-check.log.gz). `git diff --check` passes. |

Every red and setup error is classified in [FAILURES.md](./FAILURES.md). The
original assertion and expected controls are **ours**; no baseline/environmental
exemption is claimed for them. The sole full-suite failure is the social smoke described below, classified
**ours** (an existing LV-contract fixture assumption), not baseline or environmental. No native Expo UI qualification is
claimed; the test’s native host is the Rust process ABI. No shared tool install.

## Additional full-suite finding — retained social search

The sole full-run failure was `social starter runs through the public client:
feed, likes, receipts, typing, media and retained history`, at
`social-starter.test.mjs:205`: expected the departed message ID but received `[]`.
It reproduces on unchanged round-7 production code **7/15** times in the isolated
trace probe; the first standalone rerun passed. An additional server-response
trace reproduces on attempt 8 and proves that `/q/searchChat` supplied the checked
current-server empty page at cut 59, rather than the device losing its retained
row. After sync the exact departed message returns from the replica. See
[schedule probes](./social-reproduction.log.gz), [wire trace](./social-server-trace.log.gz)
and [executed trace fixture](./social-trace.test.mjs.gz).

LLP 3000.029 §7 already permits a checked whole server replacement while the
replica is fenced, with delivered history available again after apply. The
fixture asserted the retained device domain after an intervening online typing
refusal allowed a newer change poll to arrive. It now explicitly syncs after
that boundary before making the assertion. No refusal or wrong row is accepted
as success; the exact IDs and all other smoke assertions are unchanged.

Correction qualification: **30/30** repeated smoke cases over three processes,
and **5/5** in the complete social-starter file, zero failures/cancellations/skips.
[Repetitions](./social-synchronized.log.gz), [full file](./social-qualified.log.gz).
This fixes the fixture synchronization; it does not relabel the original full
run as green. No product implementation changed during this investigation.

## Wasm and custody

The full suite rebuilt the canonical wasm: **2,042,203 B raw / 593,641 B GNU
file-input gzip-9**, SHA-256
`d82c05104aaab6954278a37c1962ac6735b5e4cf91bdc7ddd7f75eafd4458466`.
**Byte-identical to round 7; 78 B below the unchanged 593,719 B cap.**
[Measurement](./wasm-measurement.json). This round changes only tests and records.

[Inputs](./inputs.json) and [qualification source hashes](./qualification-inputs.json)
record custody. Generated builds and isolated control clients remain ignored.
The final test/doc source hashes are in [final-sources.json](./final-sources.json).
One append-only journal entry accompanies the local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publication remain
unperformed.
