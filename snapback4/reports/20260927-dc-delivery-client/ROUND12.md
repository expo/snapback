# DC round 12 — start-only refusal guidance and regression coverage

2026-09-27, `sb4-intent/dc-delivery-client`, starting at round-11 commit
`a91f8f9d9`. Read the prompts through round 11, every existing DC report and
journal entry, and both complete round-10 reviews. Round 9 was stopped and
superseded by round 10; its deleted report was not recreated. No push or
publication. This round changes text and tests only; the runtime queue already
implements the ruling.

## Files and findings

Paths are relative to `snapback4/` except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/guide/codes.rs` | Grok's landing blocker: `why E_BOUND` now says ordinary non-retryable refusal, one callback, park until the next start, new id then, no in-session retry, and a committed repeat is a no-op report. |
| `crates/snapback4-lang/src/guide/refusals.rs` | Replaces the stale expiring-scan replay instruction with the same delivery rule. |
| `crates/snapback4-lang/src/guide/sequences.md` | Receipt-gap guidance uses that rule after explaining atomic bound refusal. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Replaces the ambiguous fresh-id recovery referral with the complete start-only rule. |
| `../llp/3000.025-expiring-mutation-read-prefix.rfc.md` | Sections 5 and 7 point at the start-only queue witnesses; section 6's card copy agrees. Separates the engine sweep/replay experiment from queue recovery and latency. Historical review records and Revised text remain unchanged. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | One guide regression checks all four rendered surfaces for the new facts and rejects the obsolete replay instructions. |
| `packages/snapback4/test/delivery-refusal.test.mjs` | Astra: six multi-position cases, interval/group eviction times why/denied/headless envelopes. Grok: three reset(false) cases, one per envelope. |
| `packages/snapback4/test/delivery-clients.test.mjs` | Strengthens all three local adapter refusal cases through the actual fence() path used by observeIncarnation, with persisted-park eviction and recollection before restart. |
| `JOURNAL.md`, this report and `round12/` | One append-only dated entry and durable test/mutation evidence. |

The exact requested whole-tree search was run:
`rg -n "same id|replay the same|mint a new id|fresh id" snapback4 llp`.
An additional case-insensitive search catches `fresh-id` and replay spellings.
The four guide sites and LLP 3000.025 sections 5–7 were the remaining current
instructions for the removed path. Other matches describe uncertain transport
retries, ordinary receipt replay, unrelated identity rules, negative assertions,
or history. In particular, LLP 3000.025 section 2's direct engine experiment
still correctly replays a recorded failure and executes a new id after sweeping;
it does not prescribe SDK scheduling. Prior reports, review records, Revised
history and existing journal bytes are preserved.

Scoped llp-orient used the initialized skill in sibling lane-a5, because this
worktree's link is unresolved. Context: LLP 3000 sections 3–4 (fence/budgets),
3000.019 section 4 and 3000.021 section 3.2 as amended (SDK ownership),
3000.022 sections 3–6 (collection, queue, identity and no-op reports), and
3000.025 sections 3, 5–7 (backlog refusal and recovery), all in `llp/current/`.
The receipts card and operations manual already agree with the ruling.
No design deviation, new LLP, runtime change, dependency or tool installation.

## Behavior and discriminating tests

No new Quarry form or wire field. Existing guide examples continue compiling.
For example, a report for `[41,43]` receiving either
`{state:"failed",why:{code:"E_BOUND"},head:10,store_id:"S"}` or
`{denied:{code:"E_BOUND"}}` calls `onDeliveryRefused` once and parks that
entire interval. After its debt is evicted and `[41,44]` is recollected, the
only new report before start is `{conversation:"c",from:44,through:44}`.
The next `start()` sends `[41,43]` with a different id and can succeed.
A committed report run again remains a no-op under LLP 3000.022 section 6.

The six new eviction cases exercise both the real 256-run interval limit and
the TS collector's group eviction with a one-group fixture cap. They check
that eviction actually happened, exact outgoing coverage, one callback, no
terminal refused entry, a retained start park, and successful new-id recovery.
The three reset cases evict the persisted park after `reset(false)`, recollect
41 beside clean 42, and require only 42 to send before calling `start()` on
the same queue. The three existing local adapter cases now exercise `fence()`
and require silence on recollection, then new-id success after reopening.

Every added test fails when its protected behavior is removed:

| Negative control | Result |
| --- | --- |
| Reviewer's exact `effects.parked = [run[0], run[0]]` mutation | All **6/6** new multi-position cases fail: actual `[42,44]`, expected `[44,44]`. |
| Clear `untilStart` on every reset, including false | All **3/3** new queue cases fail: actual `[41,42]`, expected `[42,42]`; all **3/3** strengthened local adapter cases fail with two reports instead of one. |
| New guide assertion against unmodified round-11 text | Fails at `why E_BOUND: missing E_BOUND is an ordinary non-retryable refusal`. |
| Restore each of codes/refusals/sequences/bounds individually | Each of **4/4** controls fails at its named surface. |
| Append `Replay the same id first.` to otherwise correct copy | Fails the explicit obsolete-text assertion, proving the negative guard. |

Queue mutations use Node module-load hooks and never edit production or built
files. Guide controls restore each file byte-for-byte in `finally`; the final
whole-guide run qualifies the restored source. All controls fail assertions,
not timeouts or import failures. Reproduction drivers and logs are in `round12/`.

## Qualification and all failures

Node 24.13.1 and Bun 1.3.14 through existing worktree-local symlinks; Rust
1.97.0, eight Cargo jobs, incremental/dev/test debug info disabled. Frozen Bun
install changed no dependency or lockfile. Package build passed.

| Check | Result |
| --- | --- |
| Refusal and adapter tests | 44 passed |
| Delivery, queue, real integration, browser, source census and prediction routing, final serialized run | **365 passed**, zero failed/skipped |
| Approval lifecycle, model and oracle, `SNAPBACK4_APPROVAL_MODEL_SEEDS=240` | **874 passed**, zero failed/skipped |
| Whole guide, after restoring all negative controls | **91 passed**, zero failed |
| Language delivery/clause/integration/replay | 26 passed, one existing optional measurement ignored |
| Device delivery, memory and SQLite | 30 passed |
| Core delivery | 3 passed |
| HTTP delivery | 6 passed |
| CLI rebuild and actual `snapback4 why E_BOUND` output | Pass; new rule present, obsolete replay absent |
| Reference audit from repository root | 521 LLP documents, 9,742 refs, zero errors/unchecked |
| Whitespace and changed-source line limits | Pass |

Failures are retained, including the initial red run:

- **Baseline fixture race:** the concurrent 365-test run had 364 passes and
  one failure, `an exhausted attempt retains its collection boundary while
  another interval runs`, `delivery.test.mjs:184`: undefined group at `g.owed`.
  Its test file and runtime queue/state sources are byte-identical to round 11.
  The fixture returns NOT_MEMBER to every later report beginning at 1, so a
  scheduled subsequent report can delete the group before its assertion.
  A controlled extra pump reproduces exactly that failure on unchanged source:
  original id1 replays, then new id3 gets the reused refusal. The loader checks
  those source bytes against HEAD before probing. The unmodified queue file
  passes **59/59** alone, and the full serialized affected run passes **365/365**.
  These passes do not erase the concurrent failure. No runtime or existing
  assertion was weakened. This baseline fixture remains open.
- **Ours, corrected:** the first new guide test used a String and &str in one
  array (three E0308 diagnostics). Borrowing the explanation as `why.as_str()`
  fixes its compilation; the subsequent pre-fix run fails the intended assertion.
- **Ours, corrected diagnostic probe:** the first baseline-race loader matched
  two existing test sites instead of one and stopped at its match-count guard.
  Narrowing it to the complete target assertion reproduces the real failure.
- **Expected negative controls, ours:** the 12 queue/adapter mutation failures,
  initial stale-guide assertion, four individual guide reversions and appended
  obsolete-text control above. They are discrimination evidence, not final reds.
- **Environmental failures:** none observed. Two exploratory path lookups found
  no guessed guide-test file or round11/bin directory; existing definitions and
  round5/bin paths were used. No tool was installed to resolve them.

Reproduce the baseline race from `snapback4/`:

```sh
node --import ./reports/20260927-dc-delivery-client/round12/baseline-queue-race.mjs \
  --test --test-name-pattern='an exhausted attempt retains its collection boundary' \
  packages/snapback4/test/delivery.test.mjs
```

The wasm was not rebuilt: Rust device/runtime inputs did not change. Remeasuring
round 11's identical artifact gives **2,019,815 B raw / 585,193 B gzip**, SHA-256
`fcb6e9a265f5c317efc6592eadd81cc439b9cf3a0d7310b2ebf6ef7de9286dd1`.
The unchanged integration budget is **586,193 B**, leaving 1,000 B. Gzip uses
the build script's named-file `gzip -9 -c` convention. Runtime meters are unchanged.

**Did not run `scripts/test.sh`**, as instructed. Round 11's full qualification
stands for this branch; its exact summary was exit 0:

```text
== 0 failure(s) in 1712 s
```

No new full-suite claim, no push and no publication. Existing unsupported-host
fallback under-reporting remains as recorded in ROUND11.md: accept a fallback
manifest on a process/Expo/custom device without deliveryCommit, then read its
delivery state; the accepted answer can have no supplementary debt. Ordinary
publication remains transactional. This round introduces no new open product
problem; the baseline test race above remains reproducible.

Requested checks, from `snapback4/` with the pinned tools on PATH:

```sh
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
node --test --test-concurrency=1 packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/prediction-routing.test.mjs
SNAPBACK4_APPROVAL_MODEL_SEEDS=240 node --test packages/snapback4/test/approval-*.test.mjs
cargo test -p snapback4-lang --test guide
(cd .. && ./ref-check --verbose)
```
