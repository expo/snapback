# Lane DC, round 7 — session-scoped bound retries

2026-09-27, branch `sb4-intent/dc-delivery-client`. Read rounds 0–6 prompts,
reports and DC journal entries, Astra's round-6 review and Grok's incomplete
review file. First ran `git fetch origin && git merge origin/main`; it reported
`Already up to date.` No conflict, push or publication.

## Files and behavior

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `packages/snapback4/src/delivery.ts` | Replaces persisted budgets with a queue-lifetime map keyed by fingerprint and group key. Keeps same-id replay first, allows eight replay-confirmed replacement ids with 1–60 s backoff, then parks as `start` without refusal. An in-memory pending-id marker prevents eviction before replay from creating fresh initial ids. CAS re-edits reuse one minted replacement; start parking advances fairness and yields the pump turn so continuously replenished spent debt cannot monopolize it. Removes spending coverage, capped wakes and terminal bound callbacks. An older membership retry subtracts already reported/refused coverage before restoring recent debt. |
| `packages/snapback4/src/delivery-state.ts` | Removes `BoundBudget`, group/retired counters and bound/stopped parks; keeps fingerprint-scoped refusal tombstones and ordinary debt limits. |
| `crates/snapback4-device/src/device/delivery.rs` | Removes bound state from retirement and restoration; keeps manifest-only reconciliation, collection and activation behavior. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Replaces the superseded persisted-budget/wake/terminal tests with session lifetime, eviction, clean-coverage, restart, no-callback, CAS and transition witnesses; retains replay-first/backoff and held-attempt witnesses. |
| `packages/snapback4/test/delivery.test.mjs` | Startup tests cover retry/start parks; retired-state tests retain fingerprint checks; new older-membership tests protect reported and refused coverage. |
| `crates/snapback4-device/tests/delivery.rs` | Replaces the two memory/SQLite persisted-budget tests with range-refusal retention under interval and actual 4,096-group eviction, including reopen/recollection. Fingerprint-scoped adoption, manifest, cursor and capacity regressions remain. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Documents the session counter, start-only delay, restart recovery and no bound callbacks. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Two-sentence §4 E_BOUND row, Revised entry, and removal of obsolete persisted-budget/spending/refusal prose. |
| `JOURNAL.md`, this report | Append-only round record, evidence and limits. |

Manifest-only bindings, startup barriers, held-attempt priority, fingerprint
fences, acceptance, outbox order and the consumer TypeScript fix remain.
Pump outcomes use an explicit discriminant to retain consumer-mode narrowing.

## Forms and examples

No new syntax, public API or request field. The existing clause remains:

```quarry
mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal
```

The successful answer's existing manifest descriptor is consumed unchanged:

```json
{"delivery":[{"fingerprint":"fixture:messages","table":"messages","mutation":"delivered","args":["conversation","from","through"],"rows":[["c",41],["c",43]]}]}
```

It produces separate `[41,41]` and `[43,43]` direct reports, never 42:

```json
{"id":"report-1","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

A first `denied: E_BOUND` replays `report-1`. Replayed `state: "sent"`
retires 41. A replayed `{state:"failed",why:{code:"E_BOUND"}}` permits a
replacement id after backoff, at most eight times for this group in this queue.
The ninth recorded bound failure parks until the next session; it never enters
`refused` or invokes `onDeliveryRefused`. The counter does not reset on success,
park, recollection, eviction, reconnect, `wake("start")`, or queue fencing;
constructing the next queue resets it, on both client tiers.

## Tests and discrimination

- Replay-first: a simulated committed report whose HTTP response is denied
  executes once; replay finds its successful receipt and retires coverage,
  including when the eighth replacement has already spent the allowance.
- Two recorded failures followed by success use exactly three ids, each
  failure first replayed with its own id; backoff boundaries are pinned.
- A bare `denied` or bare `why` without a failed receipt never mints a new id.
- Eight replacements then `start` parking on local and online queues;
  serialized local state carries no budget, timer/reconnect/start wakes do not
  replenish it, and a new queue permits replacements again.
- Twenty-five eviction-before-replay cycles through both the manifest
  collector and actual wasm publication stay at one initial id and zero new
  ids in that session. Whole-group eviction is separately exercised through
  the real TS collector with a one-group capacity.
- Interval and whole-group pressure after exhaustion, followed by merged
  `[41,42]` recollection, delays both without transport or refusal; both succeed
  after restart when the backlog clears.
- Success, full/start parks, transport exhaustion and queue fencing cannot
  reset the group counter. Fingerprint and group keys receive independent limits.
- A due full park cannot replace a held replay on reconnect/start/timer.
- The older online membership retry does not re-create a terminal bound
  callback; separate reported/refused tests prove settled coverage cannot be
  resurrected at all.
- A CAS re-edit debits and mints its replacement only once.
- Continuous collection into a spent group yields to another ready group after
  one parking turn. The pre-fix test fails at 20 turns rather than one;
  advancing scheduling order on each park and yielding the pump turn fixes it.

The old round-6 queue/state loaded under the new tests fails 11 cases. Thirteen
isolated mutations fail with assertions: skip replay; accept a bare denial as a
failure receipt; reuse the failed id; remove the eight-mint cap; forget the
lost-replay guard; mint fresh attempts for a spent group; replenish on success;
emit a bound callback; let a park replace a held attempt; debit again on CAS;
restore settled coverage from an older retry; omit the scheduling turn on a
park; continue pumping indefinitely while spent debt is replenished. These use
Node module-load hooks, not edits to production source.

## Qualification

Evidence: `target/lane-dc-round7/`. Same existing worktree-local Node/Bun links
and Cargo tools as round 6; Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
wasm-bindgen 0.2.127, no wasm-opt, eight Cargo jobs, dev/test debug info disabled,
`CARGO_INCREMENTAL=0`, fd limit 65,536. No tool installed on a shared path.

| Artifact | Raw B | Gzip B |
|---|---:|---:|
| Round 6 | 2,022,584 | 585,153 |
| Round 7 | 2,022,205 | 585,167 |
| Accepted round-1 remainder | 2,024,468 | 585,362 |
| Unchanged checked-in gate | — | 572,841 |

Raw wasm shrinks 379 B; gzip grows 14 B and stays **195 B below** the accepted
remainder. This is not a claimed gzip reduction. The state removal changes
only a few Rust JSON construction sites; the larger deletion is TypeScript.
No budget, compiler profile, dependency, codec allowance or meter changed.
Wasm SHA-256: `8c86042158304b7b2c48acad400762ad5964c62e2311009cb3e6b9bf064176fb`.

Frozen install, package build/typecheck, source and artifact censuses, and
whitespace checks pass. Affected delivery/census/Chromium tests: **154 passed**;
final queue tests: **77 passed**, including the two added older-membership
regressions. The standalone complete-device inventory passes **1,359 tests,
zero failed, three ignored**; it preceded the two final range-refusal eviction
cases, whose complete delivery-target rerun passes **30/30**. Whole guide:
**86/86**. The full run also passes all **1,361 final device tests**, with three
existing ignores. Consumer TypeScript routes: **9/9**. Reference audit: **518 LLP docs,
9,656 references, zero errors and zero unchecked**.

Ran `scripts/test.sh` **exactly once**, exit 1. Its exact summary is:

```text
== 1 failure(s) in 1529 s
   wasm build
```

| Failed step | Attribution | Reproduction and disposition |
|---|---|---|
| `wasm build` | **Baseline** | `bash scripts/build-wasm.sh`: 585,167 B gzip exceeds the unchanged 572,841 B gate by 12,326 B. It remains within this lane's accepted 585,362 B remainder. No gate raised. |

There are no lane-owned or environmental failures in that full run. Rust:
**3,961 passed, zero failed, 24 ignored**, including all **1,361** device tests.
Main client tests: **2,766 passed, zero failed, ten skipped**; isolated client
shards: **56/56**; fixture wrappers: **9/9**; seeded client models: **78/78**.
Native and package builds, package/consumer/app typechecks, the whole guide,
documentation checks and the release guard pass. The source/artifact census
also passes separately.
Full output: `target/lane-dc-round7/full-suite.log`; exit status:
`target/lane-dc-round7/full-suite.exit`.

Reproduce from `snapback4/` with the environment above:

```sh
export PATH="$PWD/target/lane-dc-round5/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
export CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/web-review.test.mjs
cargo test -p snapback4-device
cargo test -p snapback4-lang --test guide
cargo test -p snapback4-lang --test routes
node scripts/attribute-wasm.mjs --families --check-families --check-absent
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The separate complete-device run reuses the worktree-local copy of the normal
Rust test driver narrowed to `snapback4-device`, retaining inventory, shards,
assertions and doctests. The required full suite uses the original driver. The final scheduling
fairness correction was added during its model phase, after its ordinary client
phase; the final affected tests qualify that correction. No second full suite
was run. The pre-fix fairness failure is ours, now fixed; deliberate mutation
failures are expected negative controls.

## Decisions and limits

The brief's eviction-before-replay case needs more than a counter: the counter
cannot be debited before a failed replay, so repeatedly evicting the initial id
would mint fresh initial ids forever. The implementation remembers unresolved
bound ids in memory and, if their rows disappear, delays new attempts for that
group until restart. It adds no persisted state, refuses no clean coverage,
and restores no evicted debt. This is a conservative session delay; it can also
delay unrelated newly collected positions in the same group before all eight
replacements have been used. That engineering choice is documented in §4 and
the operations manual.

The session allowance charges minting, so an id reserved during an ultimately
abandoned CAS may consume allowance without being sent. Repeated edits of that
same CAS reuse its reservation. This conservatively under-reports and cannot
exceed the mint limit.

Scope context from `llp-orient`: LLP 3000 §§1–4, LLP 3000.022 §§3–5 (current),
LLP 3000.021 §3.2 as amended, and LLP 3000.002's codec/wasm constraints. Read the
skill from initialized lane-a5 because this worktree's vendor link is broken.
No new LLP, gate or runtime API. Hand-off: none beyond supervisor review.

Open baseline: `bash scripts/build-wasm.sh` reproduces 585,167 B gzip versus
572,841 B; integration owns the already accepted ratchet change. Prior scope
limits remain: hosts without conditional supplementary commits omit fallback
manifest debt (accept such a manifest on a custom/process/Expo handle without
`deliveryCommit`, then read delivery state; the answer resolves but that debt
is absent). Ordinary publication remains transactional. No new comparative,
DS/ER server, full wasm parity, native process-kill or browser-crash qualification
is claimed. No push or publication.
