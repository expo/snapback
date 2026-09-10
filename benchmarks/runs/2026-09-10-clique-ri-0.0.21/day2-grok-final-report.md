# Day-2 final report — grok-day2 / snapback2@0.0.21

lane id: grok-day2-snapback2
model: grok-4.6
effort: xhigh
backend: snapback2-0.0.21
phase: day2
host: macOS arm64
start=1789079916

## Per-change status

| CR | request | status | wall s | correction loops | forced env resets | owner restarts | owner reloads | store rollovers / drops |
|---|---|---|---|---|---|---|---|---|
| 1 | nullable `messages.editedAt`, migrate live data | **pass** | 81 | 0 | 0 | 0 | 0 | 0 |
| 2 | pinned messages, members only, per conversation, live two clients | **pass** | 73 | 0 | 0 | 0 | 0 | 0 |
| 3 | rename send-path internal function + doc comment; re-run acceptance | **pass** | 559 | 2 (agent-error) | 0 | 0 | 0 | 0 |

CR3 loops: (1) quarry `//` comment → `E_QUARRY_SYNTAX`; (2) Playwright waited on `sm-convo-bubble` / wrong bob URL. Neither was a platform-forced reset.

m7 suite `count === 6` failed after CR1/CR3 proof sends (`actual=8`). Not a DNF: starter history still renders; count still increments; m1–m6 and m8 acceptance pass; m7 poll assertions pass.

## Migration-step counts and lengths

### CR1 — `editedAt: time ?`

| # | step | t | length | result |
|---|---|---|---|---|
| 1 | `snapback2 check` | 1789080266 | <2s | ok, generation `154dca…`, 71 ops |
| 2 | successor install (owner watch) | 1789080267 | <1s | `addedColumns: [messages.editedAt]` from `366192…` → `154dca…` |
| 3 | `run admin.fillEditedAt --plan` | 1789080274 | ~9s CLI | ceilings; name `admin.fillEditedAt` |
| 4 | `run admin.fillEditedAt --dry-run` | 1789080283 | <2s | `state=done` `chunks=1` `dryRun=true` |
| 5 | `run admin.fillEditedAt --wait` | 1789080284 | <1s | `state=done` `chunks=1` `rowsWritten.messages=3` |

No `--apply-migration`. No `reset`. WAL from day-1 recovered at owner boot (not a drop).

### CR2 — `pins` table

| # | step | t | length | result |
|---|---|---|---|---|
| 1 | `snapback2 check` | 1789080423 | <2s | ok, generation `564cc1…`, 74 ops |
| 2 | successor install | 1789080424 | <1s | `addedTables: [pins]` + 4 indexes; from `154dca…` → `564cc1…` |

No fill job (empty pins is the migrated live state).

### CR3 — rename `fanoutSend` → `dispatchOutbound`

| # | step | t | length | result |
|---|---|---|---|---|
| 1 | `snapback2 check` (with `//` comment) | 1789080586 | <1s | `E_QUARRY_SYNTAX`; live generation unchanged |
| 2 | `snapback2 check` (comment removed, JSDoc on `notify`) | 1789080599 | <1s | ok, generation **unchanged** `564cc1…` (`from=to`) |

Expo web restarted once at 1789080971 (agent-requested; CI mode had disabled Metro reload). Not a Snapback successor/reload.

## Restarts / reloads / rollovers

- Owner pid **57256** started 1789080160 on port **52500** against the existing store; never restarted; never rolled the store.
- Expo pid **88033** (CI) started 1789080675 on **52501**; stopped 1789080940; replaced by pid **8521** at 1789080971.
- `snapback2 test` used an isolated owner and did not replace `.snapback/store.sqlite`.
- Database drops: **0**. Store rollovers: **0**.

## Evidence

| claim | path |
|---|---|
| CR1 pre-migration history | `day2/artifacts/cr1-pre-migration-history.json` |
| CR1 fill job receipt | `day2/artifacts/cr1-fillEditedAt.json` |
| CR1 post-migration + new edit `editedAt` | `day2/artifacts/cr1-post-migration-proof.json` |
| CR2 member/non-member/live/per-convo | `day2/artifacts/cr2-pins-proof.json` |
| CR3 starter history + count increment | `day2/artifacts/cr3-count-and-history.json` |
| Acceptance m1–m8 logs | `day2/artifacts/acceptance-mN.log` |
| Acceptance receipts | `day2/artifacts/suite-mN.json` |
| `snapback2 test` | `day2/artifacts/snapback2-test.json` |
| UI two-client (desktop+mobile) | `day2/artifacts/ui-proof.json`, `ui-alice-thread.png`, `ui-bob-thread-mobile.png`, `ui-bob-pinned-live.png`, `ui-alice-after-pin.png` |
| Owner log | `day2/artifacts/owner-52500.log` |
| Expo log | `day2/artifacts/expo-52501.log` |
| Diary | `day2/diary.md` |
| Run log | `day2/run-log.md` |

## Servers (PIDs this session)

| role | pid | url | notes |
|---|---|---|---|
| snapback2 owner | 57256 | http://127.0.0.1:52500 | started 1789080160; killed at end |
| expo-web (first) | 88033 | http://127.0.0.1:52501 | stopped 1789080940 |
| expo-web (second) | 8521 | http://127.0.0.1:52501 | killed at end |

Kill policy: only these PIDs (and their recorded launchers). No `pkill` / `killall`.

## Generations

| when | generation |
|---|---|
| day-1 store / owner boot | `366192bade301fea5c2b672180e102a2948c03226f3b9d986a4c556cd09e30e4` |
| after CR1 `editedAt` | `154dcafaaa38065b537d83308aa34b6ad74540344f496a369610aa7e7301893e` |
| after CR2 `pins` (and CR3 rename) | `564cc132f9c2b373074224da3105ce9c4c496b8bc599987b72ff92302657afca` |

seq at boot 802 → 1334 at close (proofs + acceptance on the live owner).

end=1789081219
