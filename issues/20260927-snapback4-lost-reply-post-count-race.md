# Snapback 4: lost-reply test races sync receipt recovery

- **Status:** Open
- **Date:** 2026-09-27
- **Area:** `snapback4/packages/snapback4/test/client-seams.test.mjs:286`
- **Observed during:** lane DC round 8, sole `scripts/test.sh` run on `03b510f4c`
- **Classification:** Baseline fixture race, also reproduced with merged baseline `17021fb9d`

`W6d native: two client POSTs with the caller id apply once after a lost reply`
failed at line 293: `f.attempts.length` was 1, expected 2. The fixture throws
after the first mutation commits, but does not prevent sync from delivering
that write's acknowledgement before retry. The native client can therefore
recover its sent receipt without a second mutation POST.

`local.ts`'s existing `flushOnce` checks `successSequence(entry)` and
`recoverReceipt` before sending. Published acknowledgement recovery is intended;
the fixture's unconditional two-POST assumption is stronger than that behavior.
The fixture declares no delivery binding, and these production paths and this
test are unchanged by round 8.

## Reproduction and baseline evidence

From `snapback4/`, after building the package and native binary:

```sh
node --test --test-name-pattern='W6d native: two client POSTs' packages/snapback4/test/client-seams.test.mjs
```

The original assertion failed once in the concurrent full suite. Twenty
isolated runs on current source and twenty with the merged baseline delivery
module all passed. Passing isolated runs do not resolve the race.

A controlled interleaving reproduces the exact assertion on both versions:
in the fixture's `callerFixture` fetch wrapper, replace

```js
if (drop) { drop = false; throw new TypeError("committed acknowledgement lost"); }
```

with

```js
if (drop) { drop = false; await sleep(100); throw new TypeError("committed acknowledgement lost"); }
```

Then run the selected test above. Both versions observe **one POST, one row,
and a sent replayed receipt**, followed by `1 !== 2` at the same assertion.
The temporary delay and diagnostics were applied through a Node module-load
hook only; no tracked fixture or production byte was modified.

Baseline comparison replaces `dist/delivery.js` in memory with the transpiled
source from `17021fb9d`. That is the only runtime file changed by round 8;
all other package and server inputs are identical. Evidence in this worktree:
`snapback4/target/lane-dc-round8/full-suite.log`, `seams-repeats.txt`,
`seams-order-{current,baseline}.log`, and
`seams-order-evidence-{current,baseline}.log`; the latter contain row/receipt
diagnostics. The loader is `seams-order.mjs`, with `baseline.mjs` selecting
the baseline runtime.

## Follow-up

Make the retry-specific fixture hold sync acknowledgements until the second
POST, preserving its same-id/two-POST assertion and at-most-once server proof.
Separately keep coverage for successful recovery through sync with one POST.
Do not force a redundant production POST or relax the exactness assertion to
hide which recovery path the test exercised. This unrelated fixture repair
was not folded into the small delivery-bound round.

## 2026-09-28 — EX round 1 recurrence

The sole full run after merging `5763da073` failed at the same assertion:
one POST, expected two, at `client-seams.test.mjs:293`. The test and all SDK,
core and device runtime sources are unchanged by EX. A focused serial rerun
passed (two POSTs, one application); that does not close this known race.
Evidence: `snapback4/reports/20260928-ex-social-example/round1/test-sh.log.gz`
and `full-failure-controls.log.gz`. No runtime workaround was introduced.
