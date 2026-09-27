# Lane KG — kept answers through replacement authority

Branch: `sb4-intent/kg-kept-through-authority`, based on `9473e0a34`.
No push or package publication.

The facade keeps its last authorized answer while a replacement awaits
`authorized()`, with `fresh: false` and the original `since`. It shows the
replacement only after authority, refuses immediately when the check refuses,
and withdraws the held answer at its own deadline. Non-kept observations keep
their immediate replacement withdrawal.

## Implementation, file by file

All package paths below are relative to `snapback4/packages/snapback4/`.

| File | Change |
| --- | --- |
| `src/app-client.ts` | Attach shared approvals to kept observations, reuse them for peeks and opening remounts, gate replacement publication, reject held answers on opening or replacement authority failure, and release them on facade fencing. A refresh revision prevents an older check from publishing after a newer raw event. |
| `src/read-approval.ts` | New internal helper: one approved snapshot per facade/live raw watch. Carries stale metadata, listens for raw changes, owns one expiry registration, and shares notifications with remounts. Raw reset/close removes the registration; there is no separate retention window. |
| `src/read-observation.ts` | Weakly associate snapshots with their owning watch, preserve identity through freshness copies, expose the original freshness time, and notify internal followers about answers, scope resets and expiry. |
| `src/read-expiry.ts` | Attach held deadlines to the raw watch and include them in its existing timer/clock-correction sweep. Withdraw all due holds before any subscriber runs. Local reobservation wakeups do not expire remembered server data. |
| `src/client.ts` | Distinguish expiry of an online raw answer from a scope-ending reset. |
| `src/local.ts` | Make the same distinction for local reads, preserving immediate denial and existing remembered-answer expiry fencing. |
| `test/keep-observation.test.mjs` | Replace the old kept-answer withdrawal expectation; retain the non-kept control and reset/identity checks. |
| `test/keep-authority.test.mjs` | Add deterministic authority, deadline, remount, rollback, reset and opening-storage-error regressions. |
| `test/keep-app-expiry.test.mjs` | Exercise held expiry on a real wasm client, fence a late HTTP memory write across rollback, and recover newer B through the public client. |
| `test/keep-app-model.test.mjs` | Add six generated action sequences on the real server with online/wasm clients and delayed authority. |
| `test/keep-authority-react.test.mjs` | Add a real Chromium/React regression for both kept hooks and local input state through 20 replacements. |
| `CLIENT-AND-OPERATIONS.md` | Document held replacement authority, original deadlines, remount peeks and unchanged non-kept behavior. |
| `llp/3000.019-what-the-builder-still-wrote.rfc.md` (repository root) | Update §3.3 and the Revised header with the implemented contract. |

The journal entry and this report record qualification. `app.ts` and
`observe-watch.ts` need no edit: the existing authorization checks and raw
30-second linger lifecycle are reused.

## Forms that compile and run

No new public API or Quarry spelling:

```ts
const watch = app.client.observe(api.thread, { conversationId }, { keep: true });
const query = useQuery(api.inbox, {}, { keep: true });
const page = usePage(api.thread, { conversationId }, { keep: true });
const immediateWithdrawal = app.client.observe(api.inbox, {});
```

The first three preserve an approved answer during replacement authority.
The fourth retains the existing immediate withdrawal behavior.

## Tests and measurements

- `keep-observation.test.mjs`: 32 passing cases, including both `keep` settings
  for A → B with B's authority blocked; A stays stale only with keep, expires
  on a clock sample at its own deadline, and B appears after authority.
- `keep-authority.test.mjs`: 13 passing cases. Device and server deadlines
  each use timers and clock samples; opening remounts receive expiry even
  before their initial check completes; rollback cannot resurrect A;
  device wakeups do not expire remembered server data; B's earlier deadline
  cannot expire A; all held answers withdraw before callback-driven rollback;
  resets, denial, failed authority, fencing and linger close release holds;
  an opening storage error denies all subscribers instead of preserving data.
- `keep-app-expiry.test.mjs`: 1 passing wasm/createApp regression. Held A
  expires while raw B awaits authority; callback-driven clock rollback and a
  late higher-cut memory write cannot resurrect A, and public offline recovery
  still returns B. A process-local module-loader negative control that removes
  only the held-memory callback fails: the cache contains A instead of B.
- `keep-app-model.test.mjs`: 6 passing sequences, seeds 23, 44 and 445 on
  both online and real wasm clients. There are 108 generated actions total:
  remote changes, bursts, local writes, remounts and, on wasm, offline
  predictions and settlements. Every session-store read during those actions
  waits 50 ms. Assertions inspect every published snapshot after initial data,
  confirm actual sync pages/predictions/settlements, and require close to
  withdraw the answer.
- `keep-authority-react.test.mjs`: Chromium renders a kept `useQuery` editor
  and kept `usePage` editor, types distinct drafts, then delivers 20 server
  replacements under delayed authority. Both inputs preserve their text,
  each editor mounts once, stale data renders, and no loading commit occurs.
  Negative control: replacing only `app-client.ts` with the source at
  `9473e0a34` fails on replacement 1: empty text instead of `query draft`.
  The modified source was restored before qualification.
- Existing keep/clock/device/expiry/reset/adoption/incarnation/ephemeral
  regressions: 100 passing tests, including wasm and process-device coverage.
- Whole guide: 86 passed, 0 failed. Package typecheck/build pass. No diagnostic
  code or guide card was added. Source files changed here remain under 1,500
  lines (largest: `local.ts`, 1,477).
- Wasm, by `scripts/build-wasm.sh`: 1,980,253 B raw / 571,810 B gzip, unchanged
  from this lane's initial build, 1,031 B below the unchanged 572,841 B cap.
  SHA-256: `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
  There are no Rust or engine changes and no change to meters.

Ran `scripts/test.sh` exactly once. Exact summary: **`== 0 failure(s) in 1382 s`**,
exit **0**. No introduced, baseline or environmental suite failure. Rust tests
and doctests: **3,809 passed / 0 failed / 24 ignored**, 906 s. Client main:
**2,503 passed / 0 failed / 10 skipped**; seven additional shards: **56/56**,
client phase 197 s. Final seeded models: **78/78**, 260 s. Fixture wrappers:
**9/9**. Builds, typechecks, docs/wasm budgets and the release guard all pass.
The complete guide test runs both independently and in the full suite.
Reference audit: `./ref-check --verbose` passes with zero errors/unchecked.
Evidence logs are under `snapback4/target/lane-kg/` (ignored build output).

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled and file limit 65,536. Frozen Bun installation passed.
The opening-refusal and fallback-memory hardening landed while the full suite
was in its Rust phase. The final package was typechecked and rebuilt before
the client phase; that phase ran every final runtime and test change.

## Decisions, deviations and remaining work

Chose to keep the superseded answer's deadline attached to the raw live watch,
rather than add a separate facade clock subscription. This preserves the
existing two-phase expiry sweep: every due answer is withdrawn at one captured
clock sample before any notification can roll the estimated server clock back.
The facade holds at most one approved answer per live watch, shares it across
remounts, and releases it when the raw watch resets/closes or the facade fences.

The internal `read-approval.ts` module and the online/local expiry distinction
are engineering choices within the brief. A replacement expiring earlier is
not a scope reset and must not expire a still-valid held answer. No public
contract, engine authorization, disclosure, durability, meter, version or
budget change was needed. There is no design deviation or stopped design part.
No open problem or reproduction remains after qualification. Both intentional
negative controls fail as expected; the full suite has no failures to classify.

The first generated-test draft incorrectly treated `/changes` as a POST,
and the first browser draft tried a mutation without browser durable
admission. These were test-harness defects. The initial browser harness also needed a
Vite alias for React’s JSX development runtime, and typechecking caught two
new internal type declarations that needed correction. All were corrected
before the full suite’s client phase; the final tests use the real change-feed
GET and browser server notifications. These are resolved lane-authored
development failures, not baseline or environmental failures.

## Orientation and scope audit

Applied the repository's `llp-orient` skill after initializing the missing
`vendor/llp` submodule. Governing constraints: LLP 3000 (Snapback 4 fence),
LLP 3000.019 §3.3 (keep, expiry, remount and reset), LLP 3000.018 §3.2
(background refresh and remembered expiry), and LLP 3000.013 §6 (facade
lifetime/authority). 3000, 3000.013 and 3000.019 are in `llp/current`; none is
in `foundation`. The lane brief supplies the accepted amendment to keep
through authority. Documentation updates are confined to §3.3, the client
manual, append-only journal and this evidence report. No further LLP hand-off.

## Commits

- `c1d5ff653` — keep approved app answers through replacement authority.
- `5b4e63249` — generated createApp and React editor regressions.
- `f1bfec08e` — opening authority errors withdraw shared held answers.
- `4b97bf06b` — held expiry fences fallback memory before clock rollback.
- Final evidence commit — this report and the single append-only journal entry.

Every commit includes the required GPT-6 Astra co-author trailer. No push,
publication, version bump, budget increase, full comparative, or Apple UI run.
The supervisor's independent reviews and integration remain external to this lane.
