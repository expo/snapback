# OA — createApp owns online access

Round-1 correction: review found that the no-device arm did not retain its
dispatch fence inside the shared client. The original verification below missed
those races. [Round 1](round-1/REPORT.md) records the reproduced defect, fix and
expanded verification; its custody findings supersede the original universal
fencing claim below.

Date: 2026-10-07. Baseline: `2a5fc454aacb2e936c4045eaf6eef5249e486a80`
(LLP 3000.033's landed revision). Branch: `sb4-intent/oa-owned-online-arm`.
Work stayed in `/home/ccheever/sb4-intent/lane-oa` on eb1000 (hostname
`expose-builder-pixel`); no other worktree, machine or process was used.
No push or publication.

## Inventory and governing context

The commission reports calibration #31's client-integration score of 86/100
(cal30: 92), and the builder borrowing the account owner's bearer for Insights
and Trending. This report treats those scores and essay as supplied evidence;
it does not claim a new calibration.

| Consumer / existing facility | Existing path and friction | Decision |
| --- | --- | --- |
| Typing and other ephemeral signals | The installed `useOnlineArm.ts` called createClient with the app's token, compared owner/token identity, collected mutation promises and delayed close through effect cleanup. The complete original is retained in [the baseline social card](guide-social-before.txt). [useTyping](../../crates/snapback4/src/verbs/init/social/useTyping.ts) separately owns renewals, observation, idle/blur/unmount cleanup and reconnect behavior. | Delete bearer borrowing. Pass useOnline() to the unchanged typing lifecycle. |
| Device app's existing online facilities | [local.ts](../../packages/snapback4/src/local.ts) already sends actions to the server and routes ephemeral mutations through its ordered signal lane. Its query evaluator can use server fallback/composition while preserving device/prediction constraints. [app-client.ts](../../packages/snapback4/src/app-client.ts) adds authority and publication fences. | Keep these facilities. The owned arm is an explicit server path alongside them. |
| Trending / Insights snapshots | [local query settlement](../../packages/snapback4/src/local.ts) withholds external answers while admitted unpredictable writes remain unresolved; [query-settlement.ts](../../packages/snapback4/src/query-settlement.ts) bounds attempts to four rounds/30s, then refuses E_QUERY_RETRY. Even a replica with a horizon is not an independent server snapshot. | app.online.query evaluates at the server, without device acquisition/predictions. Server cuts, continuation and completeness remain visible. |
| One-shot online reads | [client.ts](../../packages/snapback4/src/client.ts) already offers query with the settled Read contract and observe with normal read retention. A separate createClient otherwise creates another lifetime to manage. | Reuse this evaluator under app authority; no new Read state or settlement algorithm. |
| Actions | [local.ts](../../packages/snapback4/src/local.ts) and [client.ts](../../packages/snapback4/src/client.ts) already use [actions.ts](../../packages/snapback4/src/actions.ts), preserving an ID and pending when execution is uncertain. | online.act exposes the same behavior without borrowing credentials. |
| Existing online createApp | [app-online.ts](../../packages/snapback4/src/app-online.ts) owns the no-device app's durable write journal. It is not an auxiliary server arm for a device. | The new auxiliary arm does not get a journal; durable mutations stay on app.mutate. No-device apps reuse their existing online client. |
| Shared session custody | [LLP 3000.013 §6](../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client) governs atomic session/epoch ownership; [LLP 3000.033 §1.4](../../../llp/3000.033-read-only-client-mode.rfc.md#14-the-sdk) adds the shared principal sign-out ruling and watermarks. [app.ts](../../packages/snapback4/src/app.ts) implements scoped transport, provisional open, rollback, retirement and shared storage authority. | Extend the existing exposed scope and its transport checks. Do not add custody records or alter shared logout. |
| Read-only app | [LLP 3000.033 §1.3](../../../llp/3000.033-read-only-client-mode.rfc.md#13-read-sessions-storage-minting-refresh-and-logout) fixes SDK read sessions at expiresAt with no refresh, even explicitly; §1.4 requires exact-credential verification and no write machinery/device. | Restrict the app's existing verified online client; no second verifier, device, journal or rotation. |

Orientation used the Snapback 4 fence, root LLP 3000, design brief LLP 2000.000,
NOT-DOING, RULES, the recent journal, the client/social guide cards and the
published client reference. LLP 3000.013 (current) governs createApp; implemented
LLP 3000.033 supplies shared custody constraints; LLP 3000.028 §8 (current)
governs the typing recipe. No applicable 3000-series foundation entry exists.
The relevant @refs still apply. The decision extends 3000.033 §1.8; no new LLP
number, core contract change, persistent format, runtime ceiling or gate is added.

## API and custody

`app.online` / `useOnline()` parallel `app.client` / `useClient()`. Explicit
selection suits a screen that wants a server snapshot while preserving the
existing meaning of useQuery. The `Online` projection exposes query, observe,
ephemeral mutate, act, link/onLink, viewer, now and readOnly. It exports no
Session, bearer, headers, assetSource, refresh, close or sign-out method in
either TypeScript or runtime enumeration. Existing lower-level Client APIs
remain available; this change makes borrowing them unnecessary for the arm.

[app-online-arm.ts](../../packages/snapback4/src/app-online-arm.ts) projects the
surface, uses the existing guarded read approvals and tracks calls through
retirement. A device app creates its private client on first access to the arm;
unused arms add no client/probe. No-device apps share the existing raw online
client. [app.ts](../../packages/snapback4/src/app.ts) binds each exposed arm to
its exact scope facade and credential, with a second synchronous check after
shared authority's asynchronous read and before fetch. Retired handles cannot
send with an old account, including calls already queued in the signal lane.

Rotation replaces and announces the arm through app.onOnlineChange; useOnline
subscribes automatically. Sign-out/account change/close withdraw reads and
permanently fence exposed handles. A failed account opener can expose a new
arm for the rollback owner; it cannot revive the retired handle. Dispatched
signals/actions drain before the private client closes. An unresponsive action
gets at most the existing 30-second one-shot lifetime after retirement, then
raw close returns pending with its original ID. Retirement never invokes
signOut. A result from a dispatched write is not rewritten as an auth failure;
a late protected query result is withheld.

Signed-out operations refuse E_AUTH. Offline one-shots/signals/actions refuse
E_OFFLINE; an action with a lost response can instead return pending. Signals
never queue durably or replay. Observations use the existing online retention
and reconnect behavior; ephemeral hints retain no offline rows. One-shots
retry explicitly. Read-only mode retains E_READ_ONLY writes/actions and
E_READ_ONLY_REFRESH on the owner's refresh API, plus fixed expiry. The arm
cannot access that refresh API. Full-session reads keep normal delivery and
presence effects; read-only reads keep their no-trace behavior.

No persisted state changed, so no new published-downgrade experiment applies.
The existing published-binary downgrade control is explicitly skipped because
SNAPBACK4_PREVIOUS_PUBLISHED_BIN is unset; it is not counted as a pass.

## Starter and guide changes

Removed useOnlineArm.ts and its template/guide inclusions. Conversation's only
change is its import and call to useOnline (two changed lines), to minimize the
merge overlap with QJ. useTyping only narrows its parameter type to Online;
its renewal, idle, cleanup and generation algorithm is unchanged.

[TrendingSnapshot.tsx](../../crates/snapback4/src/verbs/init/social/TrendingSnapshot.tsx)
uses the generated feed as a Trending-style server snapshot, renders all five
read states with matchRead, labels incomplete coverage and offers Refresh. Its result belongs to the exact
online arm; rotation/account replacement cannot retain a previous owner's
snapshot. This is an installed, typechecked recipe, not a new ranking query or
navigation destination. guide social includes that actual file.

Updated client/social cards, CLIENT-AND-OPERATIONS and the starter README.
Client remains 112 lines / 1,200 words within its existing limits. The social
card removes the borrowed arm listing to make room for the snapshot. No guide
budget was raised. The complete affected guide and generated-starter typechecks
cover their published forms.

The typing starter test files are unchanged. The browser helper now instruments
the actual app-owned arm instead of intercepting createClient in application
code. It supplies the new app interface to its controlled-query facade. Its
account-switch helper performs real app logout; cleanup cannot send through the
retired bearer, so it waits for the declared four-second expiry. This is needed
because the pinned Playwright 1.55.1 `waitForFunction` checks the Promise returned
by an async predicate as truthy, instead of repolling a resolved false. The
original post-switch assertion exposed the difference; the helper now provides
the actual expiry barrier. No typing assertion was removed or weakened.
The screen-lifetime fixture's file-copy list also removes the deleted hook;
its 16 existing tests pass unchanged after that fixture correction.

## Verification

Focused verification completed:

- Owned-arm lifecycle tests: 12 cases, including snapshot/horizon, runtime
  credential surface, signal/action rotation with held responses, queued-call
  fencing, account/logout/close observations and late reads, offline/reconnect,
  shared peer logout in both modes, storage-await fencing, failed opener rollback
  and bounded unresponsive-action retirement.
- Client/starter/browser run: 48 passed; the two additional authority/rollback
  cases and bounded-action case also pass their complete owned-arm rerun.
- Guide suite: 113 passed.
- Final CLI rebuild and snapshot recipe: guide suite 113/113 and generated
  social starter 15/15 passed again after adding the incomplete-coverage notice.
- Published examples plus ephemeral/owned-arm TypeScript surface: 9 passed.
- Package typecheck/build passed. Final ref-check: 531 LLPs, 10,507 refs, zero errors.
- Delivery await census: one new zero-await module; no prior hash, delivery site
  or recipe changed. Its classification is recorded in the existing instrument.

Full suite command (all default model counts; no user-facing proof counts reduced):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
CARGO_INCREMENTAL=0 bash snapback4/scripts/test.sh
```

The [complete full-suite log](full-suite.log.gz) records 2,153 seconds at full
default counts:

- Rust: all 308 test binaries / 1,021 scheduled executions and workspace
  doctests passed.
- Client pool: 339 files; 6,594 passed, 16 failed, 55 labelled skips.
  The sole failing file was screen-lifetimes-react.test.mjs: its helper still
  copied the deleted useOnlineArm.ts, so all 16 cases failed with ENOENT before
  rendering. Removing that stale copy-list entry fixes the file; the complete
  [affected rerun](screen-lifetimes-rerun.log) passes all 16 unchanged tests.
- Models: all 79 passed, including 5,000 session histories per tier and 3,000
  online-client sequences. No model count was reduced.
- CLI/wasm builds, docs budget, release guard, package typecheck/build, chat
  check/typecheck, Expo typecheck and nine fixture-wrapper tests all passed.

There is no unresolved failure. This is a completed full run plus the corrected
affected rerun, **not a single-green-run qualification receipt**. The full suite
was not repeated solely for a fixture copy-list correction. The final recipe
verification is in [guide-snapshot-final.log](guide-snapshot-final.log) and
[starter-snapshot-final.log](starter-snapshot-final.log).

Logs retain initial failures as well as corrected reruns: initial guide word/
required-phrase failures were fixed without changing tests or budgets; initial
owned-arm tests caught signed-out ephemeral E_OFFLINE (fixed to E_AUTH), and
two test expectation mistakes (action signal optional; read-only act returns
failed/why). The first published-example run used the repository-root cwd and
could not resolve Node types; its correct Snapback 4 workspace rerun passes.
Text logs/cards have trailing whitespace normalized; the compressed full-suite
log preserves the original output bytes.

## Wasm and resources

No engine/device/wasm build input or wasm budget changed. The locked Linux build
matches the baseline measurement already recorded in metrics/wasm-budget.json:
2,135,164 raw bytes / 645,264 gzip bytes, cap 645,564.
SHA-256: `a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
The full suite rebuilt the same bytes. Gzip is measured with the build script's
`gzip -9 -c` command. Rust debug symbols and incremental artifacts were disabled.
The complete worktree measured 13,954,407,056 bytes (about 14 GB) after the full
suite and final recipe checks, below the 30 GB limit. No shared caches or another
lane's files were deleted. No core/device/wasm build input, budget or typing/
screen-lifetime test assertion changed.
