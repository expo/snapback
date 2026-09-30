# RX round 0 — declarative receipts

Date: 2026-09-30. Branch: `sb4-intent/rx-declarative-receipts`.
Base: `2cb2b5f141befd4c5dfd6afdc6c0725867f3c747` (0.4.9).
Status: tested prototype; the full allocation abstraction remains proposed.
Nothing pushed or published.

## Result

A message table can declare:

```quarry
  receipts by .conversation, .ordinal from .sender to members
```

The compiler generates receipt projection, delivery/seen mutations, progress
queries, member watermarks and the runs table. The existing SDK binding,
reporter and visible-screen `useReceipts` continue to use the same operation
names. No SDK or `contract.ts` changes were necessary. The core interpreter
refuses application writes to generated progress and runs, and performs
metered run cleanup within authorized member removal. Delivery uses a server
read of the first live blocker before writes, so it can skip expired and deleted
positions before the reported run while respecting a live blocker. The normal
meter, replay and partition log apply.

This is a round-zero prototype, not the completed abstraction. The starter
still allocates ordinals, captures recipient counts, and stamps join floors
in its application mutations. One receipt family per schema and reserved
operation/table names are deliberate prototype restrictions.

Design, authority, bounds, prediction/offline behavior and the explicit
starter-store adoption path are in
[LLP 3000.022 §14](../../../llp/3000.022-delivery-the-sdk-reports.rfc.md#14-declarative-receipts-rx-round-zero-2026-09-30).
That section has RFC status; the accepted reporting contract remains intact.

## Size and compatibility

| Source | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Social starter `schema.q`, physical lines | 294 | 225 | −69 (23.5%) |
| Receipts guide source, physical lines | 350 | 308 | −42 |

[starter-before.q](./starter-before.q) is the exact base starter, also used as
the independent handwritten differential control. Existing receipt behavior
tests were not changed. Only guide discovery/definition facts were extended
for the new syntax, diagnostics and manual card.

`guide receipts` leads with the clause. `guide manual-receipts` retains the
complete prior manual recipe, and `guide sequences` remains its expert gap
reference. Schemas without the clause retain their prior serialization and
semantics. The exact starter layout can adopt the clause while preserving its
stored watermarks/runs and public operation names; arbitrary manual layouts
require an explicit migration and are not inferred. Trusted administrative
seeds may restore receipt data; ordinary recipients may report only for their
authenticated viewer. The declaration carries an older-device capability fence.

## Verification

Final affected run ([affected-final.log](./affected-final.log)); the earlier
pre-census pass is also retained as [affected.log](./affected.log):

- New receipt suite: 9 passed. Twelve deterministic generated schedules of
  100 transitions each compare manual/declarative server answers, both device
  answers, and server/device answers after every transition: four seeds ×
  expiry/no-expiry on memory devices and two seeds × expiry/no-expiry on
  SQLite devices. Operations include sends, out-of-order deliveries, seen,
  removal, rejoin, expiry and physical deletion. Logical clocks are fixed
  ahead of wall time so test speed cannot change expiry outcomes.
- Authority: outsider reporting, invalid/inverted ranges, future delivery and
  seen positions, direct watermark patches, run insertion and upsert forgery
  refuse. Administrative removal clears runs and drops old requirements;
  rejoin starts at the current floor.
- Gap/meter/replay: expired rows are skipped, a live blocker stops the prefix,
  deletion clears it, collected debt may report after expiry, meter failure
  leaves state unchanged, and covered-run replay writes no events.
- Offline/adoption: delivery queues without prediction; forged seen writes
  refuse on the device; seen predicts under held coverage; leave prediction
  includes both the member and its run deletion. Existing manual
  out-of-order read progress survives schema adoption and gap closure.
- Existing delivery suite: 16 passed.
- Whole guide: 105 passed, including the unchanged exact receipt transition,
  late-join, removal, run-bound and 49-recipient behavior test. Every primary
  and manual guide Quarry block compiles. Final wording of the compaction
  limitation is also checked in [guide-final.log](./guide-final.log).
- Readauth: all 81 tests passed after reviewing/updating the authoring census
  for the added manual card and server-only generated delivery
  ([readauth-final.log](./readauth-final.log)).
- `ref-check --verbose`: 525 LLP docs, 9,974 refs, 0 errors, 0 unchecked
  ([ref-check.log](./ref-check.log)). `git diff --check` passed.

The single full-suite invocation began before the final additive parser
compatibility correction and census update. Final affected suites above
recheck those changes. The core/wasm code did not change after that invocation
began. The full run is preserved in [suite.log](./suite.log). It ran exactly once,
exited 1, and ended with (logs omit trailing blank lines only):

```text
== 1 failure(s) in 1531 s
   cargo test
```

Every actual failing test/check in that run:

| Failure | Attribution | Resolution |
| --- | --- | --- |
| `snapback4-device::readauth`, `census::authoring_census` (80 passed, 1 failed) | **Ours** | Its expected corpus still put `card/receipts/1:delivered` in the eligible class and omitted the new manual card. Reviewed all 12 additions and 3 removals: the original recipe remains eligible on `manual-receipts`; generated delivery is deliberately server-only. Updated the census; full readauth rerun: **81 passed, 0 failed**. |
| Aggregate `cargo test` check | **Ours; same failure above** | No other Rust target failed. |

Baseline failures: **0**. Environmental failures: **0**. The final correction
was verified by affected reruns; the full suite was not run a second time.
The nominal 60-second suite budget remains exceeded; no counts, timeouts or
checks were reduced. Expected fault-injection refusals are not failing tests.

The full run recorded 4,368 Rust passes, the one census failure, and 33
existing ignores; client integration **5,308 passed / 0 failed / 10 skipped**;
serial models **79 passed / 0 failed**, retaining their full 5,000-sequence
walks; fixture wrapper **9 passed / 0 failed**. The unchanged public-client
social-starter test passed. Build, wasm, release guard, docs budget, SDK
and application typechecks all passed. The final CLI was rebuilt after the
additive parser correction ([build-final.log](./build-final.log)).

## Wasm

Final pre-suite `scripts/build-wasm.sh`, Rust 1.97.0, wasm-bindgen 0.2.127,
locked Binaryen 132: **1,988,236 B raw / 596,247 B gzip**. This exceeds the
inherited 593,719 B ratchet by 2,528 B. The authorized increase sets the ratchet
to measured gzip plus 1,000 B = **597,247 B** in the same commit.

The required runtime change is the receipt schema capability/descriptor,
shared-interpreter progress ownership checks, and metered member-removal
cleanup. Generated Quarry and guide prose are compiler-side, not wasm.
This is a whole-artifact measurement; the base artifact was not rebuilt for
component attribution. No logical meter ceiling changed. The earlier
pre-import-policy build measured 1,988,210 / 596,229 B and was superseded.

## Failures encountered before the final affected run

All following failures were ours and fixed; they are not baseline failures:

- Initial harness compile: `WriteState::Sent` needed its fields pattern and
  device `apply` needed its first-page flag, not a timestamp.
- Initial implementation compile: `KeyProvenance` has `Const`, not `default`
  or `Literal`. Two accidental root-workspace Cargo invocations were
  corrected to the independent `snapback4` workspace.
- Initial harness assumptions: the full social starter has expected existing
  notes; device answers are core Values, not wire JSON; 30 ms expiries raced
  the wall clock. The harness now compares values at one deterministic clock.
- Receipt insertion guard initially rejected the compiler's zero defaults
  when rejoining. Insert-only zero initialization is allowed; forged nonzero
  progress and all ordinary progress patches remain refused.
- Guide integration initially missed new diagnostic definition/recovery pins,
  default card routing and keyword lists. A wording attempt disturbed a
  pinned language fact and briefly exceeded the existing aggregate word
  target. The facts were restored, the keyword-list fact extended for the new
  card, and introductory wording shortened within the existing target.
- Post-start compatibility review caught `receipts:` being parsed as a
  clause instead of an ordinary column. The parser now distinguishes the
  colon, and a regression test passes. That test initially used an unbounded
  query in its harness; its page is now bounded.
- Staged whitespace checking found extra terminal blank lines in the generated
  recipe and affected logs; removed them without changing log content.
- Both pre-ratchet wasm measurements exceeded the old budget. The required
  increase, measured final bytes and reason are recorded in the ratchet,
  journal and commit message.

## Remaining implementation

1. Engine-owned message-only ordinal allocation, automatic send-time
   recipient count capture, and automatic join-floor capture. The RFC fixes
   their intended transaction order and prediction semantics; current code
   still trusts the starter's explicit allocation recipe.
2. Multiple named families and configurable audience fields/operation names.
3. Raw-core descriptor/generated-program identity admission and migration
   tooling for arbitrary manual layouts; future semantic delivery changes
   must change their binding fingerprint. Current generated bodies come from
   the trusted compiler.
4. Complete compaction across already-delivered runs separated by expired
   holes: the current first-live-blocker read can leave a saturated 64-run
   group at `RUNS_FULL` until a held run is explicitly reported again.
   Automatic convergence of that shape is not claimed. Also pending:
   clause-level expression source mapping and large-backlog/long-hole scale
   qualification. This round proves bounded behavior and atomic meter refusal,
   not large-backlog latency.

## Governing context

The scoped `llp-orient` pass used the available skill at
`/home/ccheever/lanes/q03r4/vendor/llp/skills/llp-orient/SKILL.md` because this
worktree's skill symlink is uninitialized. Constraints: LLP 3000's one Rust
interpreter and Snapback 4 fence; LLP 3000.022 §§2–6 (success is coverage,
publication origin, binding fingerprints and replay); LLP 3000.015 §2
(sequence authority); LLP 3000.025 (expiring read prefix). Current authoring
facts came from `guide receipts` and `guide sequences`. The open design risk
is automatic allocation/adoption custody, explicitly left in §14.5 rather
than claimed implemented. Hand-off: next RX implementation round.
