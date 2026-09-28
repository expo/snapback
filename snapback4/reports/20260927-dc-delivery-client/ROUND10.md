# Lane DC, round 10 — ordinary start-only refusals

2026-09-27, branch `sb4-intent/dc-delivery-client`. Discarded the stopped
round-9 tracked edits and untracked ROUND9.md as directed; committed round 8
remains in history. Fetched and merged `origin/main` in `59c730083` before
implementation. Kept both complete journal histories (zero missing lines by
parent line-multiset comparison), both refusal registries, and combined main's
receipt catch-up/RUNS_FULL guidance with DC's SDK-owned reporting.
No push or publication; no shared-path tool installation.

## Files

Paths are relative to `snapback4/`, except the LLPs.

| File | Result |
|---|---|
| `packages/snapback4/src/delivery.ts` | Removes bound counters, pending IDs, replay-first, replacement reservations and the transport observer. Both envelopes take the ordinary non-retryable path, including headless denials: one callback, start-only parking, new ID on next start. Exact session suppression for all ordinary non-retryable refusals prevents interval/group eviction from resending recollected coverage; clean adjacent intervals proceed. Store restore/replacement denials take precedence over a report's original why. |
| `packages/snapback4/src/delivery-state.ts` | Removes the obsolete attempt replay flag. Fingerprint tombstones and ordinary retry state remain. |
| `packages/snapback4/test/delivery-bound.test.mjs` | Deleted all superseded bound-retry tests. |
| `packages/snapback4/test/delivery-refusal.test.mjs` | 21 regressions: both envelopes and headless denial; one callback; new-ID success after start; no timer/reconnect/publication/recollection retry; interval/group eviction; actual wasm publication pressure; ordinary E_INPUT parity; CAS callback; fingerprint/group/store isolation; store-failure precedence. |
| `packages/snapback4/test/delivery.test.mjs` | Retains the three due-full-park versus held-attempt witnesses, moving them out of the deleted bound file; removes the obsolete replay flag from startup fixtures. |
| `packages/snapback4/test/delivery-clients.test.mjs` | Six regressions through actual local/online adapters: why, denied and headless envelopes, session wakes, callback and new-ID success on restart. |
| `crates/snapback4-device/src/device/delivery.rs` | Equivalent explicit interval decoding loop and borrowed leave-scope slices reduce wasm bytes; no collection, eviction, persistence, schema or codec contract change. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Deletes the E_BOUND outcome row; records ordinary refusal semantics and rationale, exact session suppression and Revised metadata. Preserves round-3 acceptance, other outcome rules and fingerprint tombstones. |
| `../llp/3000.025-expiring-mutation-read-prefix.rfc.md` | Queue sentence refers to ordinary non-retryable start-only handling; Revised metadata and current scope agree. Historical review records remain historical. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `crates/snapback4-lang/src/guide/receipts.rs` | Callback, park, next-start ID and no-op/backlog rationale match both LLPs. |
| `../issues/20260927-snapback4-dev-adoption-poll-timing.md` | Tracks the full-run baseline timing failure, its unchanged direct-server path, isolated passing reproduction and unconfirmed scheduling cause. |
| `JOURNAL.md`, `reports/20260927-dc-delivery-client/ROUND10.md` | Append-only round entry and this report. |

Manifest-only adoption, ready-retry startup barriers, held-attempt priority,
fingerprint-scoped tombstones, synchronous acceptance and conditional host
commits remain intact. Consumer TypeScript retains explicit narrowing and is
qualified by the routes target. No new syntax, API, wire field, dependency,
version, budget, compiler profile, authorization or meter change.

## Forms and test discrimination

Existing accepted manifests still consume:

```json
{"delivery":[{"fingerprint":"fixture:messages","table":"messages","mutation":"delivered","args":["conversation","from","through"],"rows":[["c",41]]}]}
```

The first direct report remains:

```json
{"id":"report-1","args":{"conversation":"c","from":41,"through":41},"store_id":"S","delivery":{"fingerprint":"fixture:messages"}}
```

Either `{"state":"failed","why":{"code":"E_BOUND"},"head":10,"store_id":"S"}`
or `{"denied":{"code":"E_BOUND"}}` parks it and produces one
`onDeliveryRefused` event. No ID is reserved or dispatched again that session.
After restart the same interval sends as `report-2`; success retires it.
A receipt already committed on report-1 makes the repeated report a no-op
under LLP 3000.022 §6. No new Quarry form was added; the whole guide still
qualifies the existing forms.

All 21 refusal tests and all six adapter regressions fail by assertion
against the merged pre-change queue loaded in memory, and pass on the change. A mutation removing ordinary
session suppression fails all eight eviction tests, including E_INPUT and
actual wasm publication. Each required policy case therefore discriminates
the change. The pressure tests fill the real 256-run limit, confirm the park
is gone, drain new coverage successfully, recollect 41 beside clean 42, and
assert only 42 sends before restart. Whole-group cases exercise the real TS
collector with a one-group fixture cap. The callback remains one; no terminal
refused interval is added. Old bound-specific tests were deliberately removed
because they asserted the superseded policy; unrelated witnesses remain.

## Wasm and qualification

Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127; existing
worktree-local Node/Bun links, no wasm-opt, eight Cargo jobs, incremental and
dev/test debug info disabled, fd limit 65,536. Frozen Bun install changes no
lockfile. No tools installed. Logs are under `target/lane-dc-round10/`.

| Artifact | Raw B | Gzip B |
|---|---:|---:|
| Round 8 | 2,022,205 | 585,167 |
| Merged round-10 baseline | 2,020,508 | 585,534 |
| Final round 10 | 2,019,906 | 585,123 |
| Accepted remainder | — | 585,362 |

Final is 602 B raw / 411 B gzip smaller than the merged baseline, 44 B gzip
smaller than round 8, and 239 B below the accepted remainder. SHA-256:
`7462c466f2b4cebfd8001f392daad293d411cdebe30b3e4f6498eff24bd76fab`.
The checked-in 572,841 B gate remains unchanged and reports 12,282 B over.
The queue removal is TypeScript-only; the device reduction pays for merged
main's extra gzip bytes with unchanged interval/scope behavior.

Preflight iterator/direct-coverage/inline/string-key alternatives were larger
or insufficient and discarded. The retained borrowed-slice version initially
hit the codec helper's Sized bound; passing a reference to the slice fixes it
without changing the codec funnel. The initial pressure-test assertion
mistakenly expected low coverage to remain in the capped reported history;
it now checks successful dispatch/retirement while respecting that existing
256-run cap. Those preflight errors were ours, corrected before the full run.

- Delivery tests: 128 passed, zero failed.
- Affected delivery/source-census/Chromium checks: 163 passed, zero failed.
- Artifact serde-family and server-only/Unicode absence checks: pass.
- Package build/typecheck, whitespace: pass.
- Reference audit: 521 LLP docs, 9,691 refs, zero errors/unchecked.
- Complete device: 1,367 passed, zero failed, three existing ignores.
- Whole guide: 89 passed, zero failed.
- Consumer TypeScript routes: 9 passed, zero failed.
- Full-suite Rust phase: 4,107 passed, zero failed, 29 existing ignores,
  including all 1,367 device passes on the final source.

Ran `scripts/test.sh` **exactly once**, exit **1**. Exact summary:

```text
== 2 failure(s) in 1554 s
   wasm build
   client tests
```

Every failure:

| Failure | Attribution | Evidence and disposition |
|---|---|---|
| `wasm build` | **Baseline** | 585,123 B gzip exceeds the unchanged 572,841 B gate by 12,282 B, while remaining 239 B below the accepted remainder. Reproduce with `bash scripts/build-wasm.sh`. No budget raised. |
| `client tests`: `durable-only dev adoption answers a held legacy poll with the new generation within 500 ms` | **Baseline timing failure** | `ephemeral-adoption.test.mjs:28` measures 1312.982974 ms against 500 ms; generation 2 was correct. This direct HTTP/schema-watch test constructs no delivery queue or device and has no delivery binding. Its test/helper/fetch/server/compiler paths are unchanged from `59c730083`. The unchanged isolated test passes; a second run printing only the measured elapsed time before the assertion passes at 368.604649 ms. Shared-run scheduling is plausible but unconfirmed. Tracked in `issues/20260927-snapback4-dev-adoption-poll-timing.md`; no threshold or behavior weakened. |

No lane-owned or environmental full-suite failures are identified. This
classification does not claim a proven cause for the timing outlier, and its
isolated passes do not erase the full-run red. Main clients: **2,775 passed,
one failed, ten skipped**; seven additional shards **56/56**; fixture wrappers
**9/9**; seeded models **78/78**. All other phases pass, including both app
typechecks, package build/typecheck, docs budget and release guard. The inherited
60-second total target remains exceeded and unchanged. No second full run.
All qualified product/documentation source hashes and the wasm hash remained
unchanged throughout this run. Only this final report, the journal and the
baseline timing ticket were added afterward.


## Decisions, reproductions and limits

No design deviation. The generic start-only path needed exact session
suppression because both collectors can evict its ordinary parked debt. This
memory applies to every ordinary non-retryable refusal, keys by fingerprint
and group, and clears on start or store reset. It contains no attempt IDs,
retry counters or late transport observer; it creates no terminal refusal.
A headless refusal may park debt, but never proves coverage or restore.
Stale/aborted outcomes keep their existing fences. Store-identity failures
must win even when an adapter adds denied alongside the original why.

Scoped llp-orient used the initialized lane-a5 skill because this worktree's
link is broken. Governing context: LLP 3000 §§3–4 (fence and budgets), LLP
3000.019 §4 / 3000.021 §3.2 as amended (SDK ownership), LLP 3000.022 §§3–6
(collection, outcome rules, acceptance and no-op reports), LLP 3000.025 §3
(expired backlog), and LLP 3000.002's device-codec constraints. These are in
`llp/current/`; Snapback 1 foundation gates are outside the fence. The scoped
doc audit updates both governing rules and both public explanations together.
Hand-off: none.

From `snapback4/`:

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

The separate complete-device inventory uses the prior worktree-local copy of
the canonical Rust driver narrowed to the device package, preserving tests,
shards and doctests. Its compilation began before the equivalent byte trims;
the full run requalifies the final source and uses the original driver.

The timing issue above remains open; its isolated reproduction command is
`node --test --test-name-pattern='durable-only dev adoption' packages/snapback4/test/ephemeral-adoption.test.mjs`.
It currently passes alone; use the full concurrent client phase to attempt the
observed shared-run failure.

Open baseline: `bash scripts/build-wasm.sh` reproduces the unchanged checked-in
gate overrun; the supervisor owns the accepted integration ratchet. Existing
conditional-host limitation remains: accept a fallback manifest on a custom,
process or Expo handle without `deliveryCommit`, then read delivery state;
the answer resolves but supplementary debt is omitted. Ordinary publication
is still transactional. This round makes no new server/comparative, complete
wasm parity, native process-kill or browser-crash qualification claim.
