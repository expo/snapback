# DC round 13 — delivery follows facade approval

2026-09-27, `sb4-intent/dc-delivery-client`. First fetched and merged
`origin/main` in `6db10b223`; no conflicts. Both incoming documentation changes
are retained. Read the binding prompts through round 12, DC reports/journal
entries, and Astra's complete DS/DC integration review. Grok had no verdict at
startup, so this round did not wait for it. It arrived during the full run: its
Medium confirms the same facade defect; its Low is addressed by the additional
RFC regression below. No push or publication.

## Findings and files

Paths are relative to `snapback4/`, except the LLP.

| File | Change |
| --- | --- |
| `packages/snapback4/src/delivery-acceptance.ts` | High: carry deferred collection by answer identity. Identify guarded raw readers by their observe function, which the online custody wrapper preserves; write-only facades need no reader registration. Freshness copies share identity; final current/identity/expiry checks run again at approval and every collection attempt. Consume the callback once; discard refused candidates. Unguarded clients call their existing collector immediately. |
| `packages/snapback4/src/app-client.ts` | Mark the underlying reader guarded before use. One-shot queries perform a final authority check and accept delivery synchronously when returning the approved answer. A stale returned candidate yields loading. |
| `packages/snapback4/src/read-approval.ts` | The existing shared approval publishes the identity and releases its collection once, before notifying peers. A refusal discards that candidate's unaccepted collection. No independent approval state machine. |
| `packages/snapback4/src/client.ts` | Foreground, background and one-shot paths offer their exact published/returned identity and manifest. Guarded acceptance checks the original raw fences again; unguarded acceptance keeps the existing queue path. |
| `packages/snapback4/src/local-publication.ts` | Defer guarded fallback collection while preserving the synchronous raw publication helper and its CAS predicate. Supplementary persistence still cannot delay or reject acceptance. |
| `packages/snapback4/src/local.ts` | Pass the actual watch identity through both foreground and background publication; one-shot collection uses its returned read. All existing device-publication hooks remain unchanged. File remains 1,500 lines. |
| `packages/snapback4/test/delivery-approval.test.mjs` | 24 createApp regressions across online and real wasm-local fallback clients, described below. |
| `packages/snapback4/test/helpers/delivery-app-fixture.mjs` | Real createApp/session authority, raw SDK clients, server-compiled fallback schema, and wasm persistence. A test-only module hook delays the result of an actual facade authority check without occupying the app's serialized session store. No publication, approval or queue implementation is replaced. Storage-failure reproduction uses the actual sessionStore.get failure. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Late Grok Low: independently read LLP 3000.025 sections 5, 6 and 7; require start-only recovery in each and reject obsolete replay/fresh-id-without-restart text. |
| `packages/snapback4/test/presence-refresh.test.mjs` | Low: initially empty unguarded answer, held changes feed, then a new coordinate arriving only through background refresh and reporting after acceptance. |
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Section 4 states guarded versus raw acceptance, exact identity, refused/superseded/expired exclusion, and unchanged CAS/device publication behavior; Revised entry records the ruling. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md`, `crates/snapback4-lang/src/guide/receipts.rs` | Explain guarded acceptance and shared approval, while retaining ordinary raw/device publication and under-reporting rules. |
| This report, `round13/`, `JOURNAL.md` | Qualification, negative controls and append-only round record. |
| `../issues/20260927-snapback4-ordinary-history-sync-join-race.md` | Track the baseline raw-sync interleaving discovered by the full suite, with the same controlled counterexample on both pre-round and final code. |

## Forms and regression evidence

No new Quarry form, wire field or public API. Existing `createApp` observation
and query calls keep their signatures:

```ts
const watch = app.client.observe(api.fallback, {});
const answer = await app.client.query(api.fallback, {});
```

For either form, an approved manifest with `rows: [["c",41],["c",43]]`
produces separate reports with `args: {conversation:"c",from:41,through:41}`
and `args: {conversation:"c",from:43,through:43}`. It never fills position 42.
Every request retains its binding fingerprint and store identity. If authority
refuses, no manifest is collected, no debt is persisted, and no report sends.

Each tier has twelve createApp cases:

- Authority returns false or throws: the facade stays loading while pending,
  then refuses E_AUTH or E_CLIENT; neither period collects or reports.
- A background successor replaces unapproved 41 with 43: completing the old
  check does nothing; approving 43 collects and reports only 43, once.
- Episode or row deadline expires before authority completes: no collection,
  durable debt, report or exposed data. The episode case starts the actual raw
  observation's retention episode and preserves its identity.
- Two observing facades share one raw answer: the later peer approves first,
  both see the identical approved snapshot, and collection runs exactly once
  for the full `[41,43]` manifest before interval deduplication.
- Astra's reproduction: fail actual session-store reads when the raw answer
  publishes, observe E_CLIENT with no data, restore storage before the 250 ms
  delivery debounce, and still observe no collection/debt/report.
- Four one-shot cases: final authority approves, returns false, throws, or
  completes after row expiry. The query stays pending until authority resolves;
  only the approved, still-current answer is returned with collection.
- Initially empty answer, held changes stream, then background-only 47: no
  collection while facade authority is pending; approved 47 reports exactly.

The separate unguarded background regression uses the real online client and
held changes stream. Existing unguarded fallback, queue, refusal, CAS, activation,
wasm publication/crash, outbox and browser tests remain in the passing scope.
The local tests use an online-only table with no published rows, so device
publication cannot accidentally satisfy a fallback-manifest assertion.

Negative controls load modified JavaScript in memory, never changing source or
built files. The driver is `round13/mutate.mjs`:

| Mutation | Result |
| --- | --- |
| Bypass guarded deferral and collect at raw acceptance | All 24/24 createApp cases fail their no-collection assertion. |
| Remove only online background acceptance (Astra's surviving mutation) | Both new online witnesses fail: raw background reporting and guarded background reporting. The local background case remains green. |
| Omit final facade-query acceptance | Both approved-query cases fail because their report never arrives. |
| Revert each LLP 3000.025 section 5/6/7 separately to round-11 text | All three fail at the named section. |
| Append obsolete fresh-id-without-restart advice to each otherwise-correct section | All three fail the negative assertion. |

The missing-acceptance JavaScript controls fail their bounded eventual-report assertions, not import
or loader errors. They reproduce under-reporting; the first control proves the
High repair rather than merely exercising interval deduplication. The RFC
controls run after the full suite has finished its guide target; a finally block
restores the RFC byte-for-byte. The subsequent whole-guide run qualifies the
restored text. The interrupted full suite compiled its original 91-test guide
before the late Grok test was added; the separate final 92-test runs qualify
that addition, which is also present in the recovery suite.

## Context and scope

Scoped `llp-orient` used the initialized skill at
`/home/ccheever/sb4-intent/lane-a5/vendor/llp/skills/llp-orient/SKILL.md`
because this worktree's skill link is uninitialized. Governing constraints:
LLP 3000 section 4 (fence and caps), 3000.022 sections 3–5 (collection,
acceptance, identity and CAS), 3000.023 sections 3.1/3.4/3.6 (episode/row
deadlines and shared approval), and 3000.018 section 3.2 (background answers).
The delivery and approval RFCs are in the Snapback 4 current working set.
The explicit supervisor ruling supplies the acceptance decision; no new LLP,
gate, dependency, version, meter or budget was introduced. Hand-off: none.

No design deviation. The existing limitation remains: hosts without
`deliveryCommit` omit supplementary fallback-manifest persistence. Reproduce
with the existing `delivery-cas.test.mjs` case matching
`without conditional commit`: the answer succeeds while that debt stays absent.
Ordinary device publication still writes debt with its row transaction. No new
native/IndexedDB crash or comparative-performance claim is made.

The round-12 queue-fixture timing race is not changed by this round. Its
controlled extra-pump reproduction remains
`round12/baseline-queue-race.mjs`; the affected queue source and fixture are
unchanged. The recovery full run passes the ordinary exhausted-attempt case,
which does not claim the fixture race is resolved. The inherited 60-second
full-suite target remains exceeded; running `bash scripts/test.sh` reproduces
that timing gap. Neither is hidden by a changed test threshold or budget.

## Qualification

Node 24.13.1 / Bun 1.3.14 through existing worktree-local tool links; Rust
1.97.0 / wasm-bindgen 0.2.127, eight Cargo jobs, incremental and dev/test debug
information disabled, fd limit 65,536, no wasm-opt. Frozen Bun install passed
without lockfile changes. No tool was installed anywhere.

| Focused check | Result |
| --- | --- |
| Delivery/queue/refusal/CAS/activation, wasm, browser, prediction routing, presence and source census | 399 passed, zero failed/skipped |
| Approval lifecycle/model/oracle, 240 seeds | 874 passed, zero failed/skipped |
| React and keep-authority React | 51 passed, zero failed/skipped |
| Whole guide | 92 passed, zero failed (including late Grok regression) |
| Reference audit | 521 LLPs, 9,744 references, zero errors/unchecked |
| Package build/typecheck, source line caps and whitespace | Pass |
| Post-recovery outcome file plus new facade cases | 32 passed, zero failed |

Before the full suite, the wasm remeasured **2,019,815 B raw / 585,193 B gzip**,
SHA-256 `fcb6e9a265f5c317efc6592eadd81cc439b9cf3a0d7310b2ebf6ef7de9286dd1`,
identical to rounds 11–12. Gzip uses build-wasm.sh's named-file `gzip -9 -c`
convention. The unchanged 586,193 B budget leaves 1,000 B; runtime ceilings are
unchanged. Both full-suite builds and the final post-suite measurement agree
with those bytes and hash.

Preflight failures, all **ours and corrected**: the initial fixture did not
answer session restoration with its fixture session, so seven online cases
timed out before the intended checks and that run was stopped. After fixing
restoration, 23/24 cases passed; the online storage case raced the initial
changes request, causing link withdrawal instead of the intended E_CLIENT.
Holding the query reply until changes was dispatched fixes its ordering. Both
storage cases and the subsequent complete 399-test affected scope pass. The
negative-control failures above are intentional. No product assertion was
weakened to repair these fixture errors.

The seven initial failures were the online false-refusal, throwing-refusal,
superseded-answer, episode-expiry, row-expiry, peer-approval and temporary
session-store-failure cases. Stopping that incomplete run also terminates its
file-level harness. The second preflight's sole failure was the online
temporary session-store-failure case. Both complete preflight logs are retained
beside the final passing logs.

The interrupted full run also exposed five **ours, corrected** failures in
`app-outcomes.test.mjs`: the mutate, act, upload, refreshSession and write
facade-fence cases provide a write-only raw fixture without `observe`. The new
registration tried to add undefined to a WeakSet. An isolated probe after disk
recovery reproduced all five; registering only actual observe functions fixes
them without modifying their assertions. The complete eight-case outcome file
plus all 24 new delivery cases now pass, 32/32. Build and typecheck pass again.
This TypeScript correction was rebuilt during the recovery run's Rust phase,
before any recovery client tests started.

## Disk interruption and recovery

The supervisor reported a full host disk and freed about 440 GB. The first
`scripts/test.sh` invocation was interrupted without an exit code or final
summary; its log must not be represented as a completed suite. Its Rust stage
reported `-- FAIL: cargo test (1009 s)`: eleven lifecycle tests failed while
the disk was full (explicit StorageFull/E_STORE evidence, plus two child
startup failures in that same window), and workspace doctest compilation
failed. The original client log was interrupted too: 134 distinct failure
labels survive, including one truncated name. Five are the write-only fixture
defect above; the remaining 129 occurred during the disk-full run. Every
recoverable name and classification is in
[`round13/interrupted-failures.md`](./round13/interrupted-failures.md) and its
JSON companion; raw logs are retained. The doctest's preceding compiler
diagnostic was lost when the disk filled; the compile failure itself survives.

Rechecked every evidence file written after 21:15Z. All pre-existing gzip
files matched their source logs except `guide-restored.log.gz`, which was
zero-length. Regenerated all evidence gzip files, parsed every JSON file,
syntax-checked both mutation drivers, checked the report tail and source diff,
and verified LLP 3000.025 is byte-identical to HEAD. The interrupted final
evidence step was redone, including source hashes and wasm measurement.
`round13/disk-recovery.json` records these checks. No source or documentation
file was truncated. No tool installation was needed.

Verification deviation: following the user's explicit recovery instruction,
restarted the interrupted full suite once to obtain its required exact final
summary. This is a second invocation after an incomplete, environmentally
interrupted attempt, not an undisclosed retry of a completed result. The
completed recovery result and remaining classification follow.

## Completed full-suite result

Recovery invocation exit **1**. Exact summary:

```text
== 1 failure(s) in 1707 s
   client tests
```

Its sole failure is **baseline**:
`process: receipts screen and history after leave, remount and offline/online reopen`
at `packages/snapback4/test/ordinary-history.test.mjs:226`. The immediate
post-leave inbox still contains `chat` instead of `[]`. An ordinary isolated
run passes on both final code and the merged pre-round baseline `6db10b223`.
A controlled interleaving fails the same assertion on both: start sync, hold
its already-rendered response, commit leave through the separate HTTP client,
call sync again, then release the first response. The existing `syncOnce`
joins its in-flight promise, so this await need not fetch the post-leave page.
The original assertion is unchanged. The test and receipts Quarry are
byte-identical to that baseline; the baseline loader transpiles all five
changed existing client modules from Git in memory. Reproduction drivers and
both passing ordinary runs / failing controls are retained under `round13/`.
The follow-up issue above records the open contract/fixture question. This
round changes neither raw sync nor the fixture and does not erase the full-run
failure with an isolated pass.

Everything else in the completed suite passes: **4,145 Rust tests**, 30
existing ignores; **4,184 main client passes**, one baseline failure and ten
existing skips; **56/56 additional client shards**; **9/9 fixture wrapper
tests**; **79/79 final client models**. All 24 new createApp delivery tests,
five write-only facade cases and the existing queue timing case pass in the
full run. All 20 lifecycle cases, including the dev-adoption timing assertion,
and workspace doctests pass after disk recovery. The whole guide includes all
92 tests in this invocation. No remaining failure is attributable to this
round's implementation, and no environmental failure remains in the completed
recovery invocation. Original environmental and corrected failures remain
fully disclosed above and in the preserved logs.

Final runtime hashes match the recovery build, with the same wasm bytes.
`round13/verification.json`, `static-checks.json`, `disk-recovery.json` and the
compressed full log preserve the qualification. No further full-suite run,
tool installation, push or publication.
