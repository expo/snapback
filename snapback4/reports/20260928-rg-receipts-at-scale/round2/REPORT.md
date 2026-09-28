# RG round 2 — observe settled writes and test exact unread counts

2026-09-28. Branch `sb4-intent/rg-receipts-at-scale`. First action fetched and
merged `origin/main` (`a745b110f`) into round 1 (`52b68fdd0`), producing
`b972d869b` without conflicts. Read both earlier prompts, reports and journal
entries and Grok's full review. The scoped [context pack](CONTEXT.md) records
the governing LLPs. No tools were installed, nothing was pushed or published,
and `scripts/test.sh` was not run; the supervisor owns the landing suite.

## Changes and controls

1. **Settlement.** Round 1 already fixed the ordinary successful-first-write,
   refused-second-write path. This round extends the same check to early
   flush exits and after the FIFO loop: when every remaining entry has a
   success sequence and any is unobserved, sync before returning. The helper
   runs outside the network chain and preserves `acquire=false` on startup.
   Refusal settlement still awaits publication; successful pairs retain FIFO
   with no sync between their POSTs. `local.ts` remains within 1,500 lines.
   The refused-tail regression now holds sync and proves both POSTs happen
   before release while the batch cannot finish before publication. Another
   test retires the tail through the real device before `begin_send`, forcing
   an early exit; its retry timer is frozen so a later retry cannot repair it.
   Disabling unobserved-success sync makes both regressions fail while the
   successful-pair control still passes ([final mutant](outbox-fenced-mutant.log)).
2. **Exact small-range counts.** Round 1's 63/64/65-candidate cases remain.
   A new independent truth table covers read-floor and join-floor boundaries,
   tombstones, each reader's self-send, unswept expiry, another group and live
   rows. Alice must count 2 and Bob 4, both directly and through batched view
   certification, with bounded probes/decodes. Removing only
   `&& k.matches(&row, member)` fails with 6 instead of 2
   ([Rust mutant](matches-mutant-rust.log)). The production algorithm and
   round-1 charged fallback allowance are unchanged by this round.
3. **Witness.** The generated 50-member / 10,000-message / 100-conversation
   witness reads the `unread` view it seeds. One quiet group has independently
   known mixed-range counts (1 and 2), also checked through Chromium. Every
   send additionally checks the sender's zero, a peer's one before `seen`,
   and that peer's zero afterward. The same missing-`matches` production
   binary fails the witness's first count with 6 instead of 1
   ([witness mutant](matches-mutant-witness.log), [JSON](matches-mutant-witness.json)).
4. **Cost and evidence.** Round 1 already corrected `check --cost`, its test
   and the maintains card: at most 64 stored keys are counted through a
   necessary predicate index, including unswept expired candidates which
   expiry/full-predicate checks reject; larger ranges keep the shared
   parent/expiry walk. Reads keep one examined/one-step public reservation;
   probes and walks consume the internal ledger. The cost regression is rerun
   here. The main and round-1 reports now describe the unmigrated run as a
   30-second settlement miss, with zero measured samples, **not an established
   `E_BOUND` refusal**. The screenshot attribution is withdrawn. The old
   append-only journal entry is corrected by this round's appended entry.

## Generated Chromium witness

The corrected witness passes all **72 exact unread checks**, three warmups
and twenty measured samples. [Summary](witness-summary.json),
[full browser/network detail](witness-detail.json.gz), [log](witness.log).

| Measure | Result |
|---|---:|
| Cold web ready | 1015.008 ms |
| Send/settlement p95 | 380.323 ms |
| Visible-render p95 | 252.800 ms |
| All-peer receipt convergence p95 | 846.768 ms |
| Durable saves / limit | 1,191 / 9,116 |
| Clock metadata writes / limit | 132 / 4,608 |

P95 uses sorted sample index 18 after excluding the three warmups. The added
sender/peer count checks run after send/settlement timing and before receipt
convergence timing ends; the final zero check follows that timing. This is the
generated fixture, not another calibration-store replay. Round 1 retains the
full builder migration and its full-corpus 704 ms p95. No original evidence
store was accessed or changed in this round. The final witness used the rebuilt production binary and final client source
([digests](digests.json)). It overlapped the generated device disclosure test,
which used about one CPU on this 96-logical-CPU host; no causal comparison is
claimed from the timing difference. The earlier successful witness is also
retained ([summary](witness-before-retry-summary.json),
[detail](witness-before-retry-detail.json.gz), [log](witness-before-retry.log)):
367.930 ms send/settlement p95 and all 72 counts correct. That run preceded
the final move of persistence-failure retry scheduling outside the network
callback and used the round-1 production binary. Both successful runs meet
the bound; these are measurements on this host, not an arbitrary-load guarantee.

## Validation

All final checks pass: **255 Rust tests and 479 client tests**. One Rust
measurement is explicitly opt-in and ignored. [Counts](test-summary.json),
[commands](commands.txt) and [exit codes](check-exits.txt) accompany full logs.

| Check | Result |
|---|---:|
| Rust row-view units | 24 passed |
| Core row-view/disclosure/sync-count/receipt integration | 31 passed |
| Device row-view, range and delivery | 53 passed |
| Whole guide | 93 passed |
| Rust delivery, replay conversion and receipt-gap tests | 42 passed, 1 opt-in measurement ignored |
| Cost certificates | 12 passed |
| React, clock, pending writes and outbox | 172 passed |
| Client receipt and delivery | 212 passed |
| Extra clock, including Chromium | 57 passed |
| Settlement, transport outcomes and store replacement | 38 passed |
| Client build/typecheck, debug and production builds, root reference audit | passed |

The standalone outbox module also passes 31/31; it overlaps the 172-test row
and is not extra coverage. Final client checks were repeated after moving
persistence-failure retry scheduling outside the network callback. That keeps
the observation check before every retry return without syncing inside the
serialized network chain. The root reference audit covers 522 LLP documents.
`scripts/test.sh` was not run. There is no new complete-suite claim.

## Failures and disposition

| Classification | Failure | Disposition |
|---|---|---|
| Ours, expected mutant | Missing full predicate returns Rust count 6 instead of 2 | Restore predicate; affected Rust suite rerun |
| Ours, expected mutant | The same production binary returns witness count 6 instead of 1 | Restore predicate and rebuild; final fixed witness passes all 72 checks |
| Ours, expected mutant | Refused-tail batch finishes before held publication; early-exit test never sees sync | Restore helper; 31-test outbox module passes; repeated with retry timer fenced |
| Ours, fixture | First witness assertion used `.data.value` for a scalar keyed count | Correct to `.data`; preserve [failed log](witness-scalar-fixture.log) and [JSON](witness-scalar-fixture.json); complete witness passes |

The first and retry-fenced outbox controls each have the same two expected
failures, not separate product findings. No baseline or environmental test
failure was observed. Inspection-only invocations also encountered
missing guessed file paths/globs and one malformed tool-call expression;
these are ours, corrected by file discovery/reissuing the call, and are not
product checks. An initial Python-gzip size used a different compressor;
the final size uses the build script's exact `gzip -9 -c` convention.

Wasm is **2,019,815 B raw / 585,381 B gzip**, byte-identical to round 1,
**812 B below** the unchanged **586,193 B** budget ([measurement](wasm.json)).
No wasm inputs changed, so it was remeasured, not rebuilt. The production
server is rebuilt after the deliberate mutation control. No new capability,
authorization rule, disclosure rule, public reservation or ceiling.

## Reproducing the controls

From `snapback4/`, use the build environment in `commands.txt`.

- Remove only ` && k.matches(&row, member)` in `row_views/live.rs`, run
  `cargo test -p snapback4-core --lib small_predicate_ranges_match_an_independent_unread_oracle -- --nocapture`,
  build `cargo build -p snapback4 --profile production`, then run
  `SNAPBACK4_BIN=target/production/snapback4 node witness/receipts-scale.mjs output.json`.
  Both tests fail on counts, before any latency assertion. Restore the source
  and rebuild before normal checks.
- In `local-receipts.ts`'s `syncSettledWrites`, change its early return to
  `if (!acquire || !force) return;`, build the client, then run
  `node --test --test-name-pattern='a success followed|an early flush exit|a queued send follows' packages/snapback4/test/store-reset-review.test.mjs`.
  The two observation tests fail; the successful FIFO pair passes. Restore
  the helper, build, then rerun the whole module.

All temporary mutations were restored in `finally` blocks; none belongs in
the final diff. Commands and exit codes distinguish expected failing controls
from the final checks.
