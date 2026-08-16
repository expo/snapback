# Review: LLP 0258 Phase 1.4 browser proofs + cross-tab fix — grok-4.6 (xhigh)

Reviewer: grok-4.6, reasoning-effort xhigh, web search disabled.
Orchestrated 2026-08-16; mutually blind from the codex review.
Round 1 target: 146cd6ade + b7528195c. Round 2 target: 820eff6b2. Round 3 target: 7800b3aa2.

## Round 1 (NOT READY)

I'll review the two commits against the governing LLPs and tickets, starting with the review skill, the design docs, and the full diff.The review skill wants artifacts on disk; you asked for no file changes, so I’ll inspect the commits and governing docs here and report findings only.I have the file list. Next I’ll read the app-client fix, the governing LLP sections, and both tickets in full.The app-client delta is small; I’ll trace coordinator defaults, abort/dispose, and the harness proofs next.The Node test uses `memory` platform, so it doesn’t pin browser-kind SSR. I’ll read LLP 0059 winner/blanking next and start the harness.Custody keying looks load-bearing for every snapshot check — I’ll verify the page’s IndexedDB reads match the adapter’s owner-key scheme.The refresh witness may not match the ticket’s “rotated successor” story. I’ll read both tabs’ automatic snapshots next.The app-client wiring itself is sound. Browser and `expo-web` omit the coordinator keys unless the caller injects them (`Object.hasOwn`, so `null` still disables); every other Phase 1 kind stays mechanism-free; construction-abort still `await`s `coordinator.close()`; the two-context unit test would time out on the pre-fix hard `null`s. The problems are in what proof 2 will accept as a refresh win, and in how the landed evidence describes the recorded witness.

1. **MATERIAL** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1511-1514`  
   **Defect:** `concurrent-refresh` treats “exactly one `ok: true` plus both tabs sharing *some* principal whose local capture matches IndexedDB” as LLP 0059 success. Unlike logout (must be anonymous) and sign-in (must be authenticated), refresh never requires an authenticated successor, the pre-race user/session, a revision-only bearer rotation, or a typed `SNAPBACK_AUTH_REFRESH_SUPERSEDED` loser.  
   **Why it matters:** LLP 0059 says a refresh rotates the bearer for the *same* authority (revision++, epoch unchanged). The ticket exit criterion is “exactly one caller succeeds … both tabs converge automatically on the rotated record.” As written, a future “fix” that makes one caller succeed after both tabs have blanked to anonymous — which is what this witness already settles at — would green proof 2 without a refresh winner. That is a weaker outcome than the documents require.

2. **MATERIAL** — `tests/acceptance/browser-auth-bootstrap-v1.evidence.md:65-74` and `issues/20260816-refresh-race-zero-winner.md:29-34`  
   **Defect:** Both texts claim the durable record “ends on the rotated successor (next epoch)” because “server-side rotation committed,” that one tab “remains on the stale pre-rotation principal” through the automatic window, and that `synchronize()` then converges both onto “the rotated authenticated record.” The committed witness does not show that. Chromium `proofs[id=2].details.refresh` (WebKit is the same shape): both `/auth/refresh` responses are 401/409 (zero 200s); at call return one tab is still session epoch 7 / rev 15 and the other is already anonymous epoch 8 / rev 17; after `observePages` **both** tabs are anonymous epoch 8; `manualRecovery` is still anonymous epoch 8; authenticated epoch 9 only appears later as `logoutPreparation.entry` — a new `signIn`, not a recovered refresh. Epoch 7→8 with `authorityKind: "anonymous"` is a session→anonymous transition, not a bearer rotation (LLP 0059: refresh must not advance epoch).  
   **Why it matters:** The receipt’s honest fact is “zero caller successes, then fail-closed blank.” The prose invents a committed rotation and a stale-until-`synchronize()` observation failure the automatic snapshots contradict. That will send the refresh-fix implementer at the wrong bug.

3. **MINOR** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1518-1520`  
   **Defect:** The failing `concurrent-refresh` note is hardcoded to “left a tab on a stale principal/custody revision” whenever `refreshConverged` is false. In the recorded run the failing conjunct is `refreshSuccesses === 0`; `refresh.automatic` already has matching anonymous principals and matching captures.  
   **Why it matters:** The check output, not just the markdown, mislabels a zero-winner / blanking outcome as a stale-projection failure.

4. **MINOR** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1636-1643`  
   **Defect:** `concurrent-user-switch` requires `protectedEmpty(snapshot)`, but proof 2 never calls `seedProtected`. After proof 4 and the refresh/logout/sign-in arms, both tabs’ probe rows are already empty (witness `protected.rows` / `optimistic` are 0 going into the switch).  
   **Why it matters:** The pass note says “both tabs exposed only its successor.” Predecessor-materialization blanking on the two-tab user-switch arm is not actually tested; only principal/userId convergence is. Single-tab blanking stays in proof 4.

5. **MINOR** — `packages/snapback-client/app-client.test.mjs:558-576` (via `optionsFor` at 292-297)  
   **Defect:** “Node construction without BroadcastChannel or localStorage stays mechanism-free” builds `platform: { kind: 'memory', … }`. Memory already forces `broadcastChannelFactory` / `hintStorage` to `null`, so deleting the globals cannot fail and would also pass on the pre-fix hard `null`s. There is no test that (a) omitted keys on `kind: 'browser'` use coordinator defaults, (b) explicit `null` disables wakeups, or (c) browser-kind construction is safe when the globals are missing. The two-context test *does* pin injection and **would** fail on pre-fix code; the production omitted-key path is exercised only by the harness page.  
   **Why it matters:** A later change that honors injected factories but hard-`null`s omitted browser keys would keep the unit suite green and reintroduce the shipped defect.

6. **MINOR** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:495-509`  
   **Defect:** `reserveLoopbackPort` binds `:0`, closes the socket, then starts `safaridriver --port` on that number.  
   **Why it matters:** Speculative under load: another process can grab the port in the gap, producing `SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_EXITED` / start-timeout rather than a clean bind error. Cleanup on the failure path is otherwise fine (`ownership.stop()` in the launch `catch`, session then driver in the engine `finally`, command queue serializes the two window handles).

7. **NIT** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:57`  
   **Defect:** `DEFAULT_SERVER_BINARY` is the parent-checkout path `/Users/ccheever/projects/snapback/target/debug/snapback`. The recorded witness used the worktree binary (`server.binary.path` under this worktree).  
   **Why it matters:** A default run without `SNAPBACK_RUNTIME_BINARY` can attach a different `snapback` than the JS under test.

8. **NIT** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1154` and `tests/acceptance/browser-auth-bootstrap-v1.evidence.md:4-6`  
   **Defect:** Every witness is stamped “the requested lane intentionally leaves proof artifacts uncommitted,” and the evidence file still says “uncommitted app-client cross-tab fix,” but this landing commits both the witness JSON and the fix (`146cd6ade`).  
   **Why it matters:** The receipt disagrees with its own git state (`source.gitDirty: true` at `b7f01a693` is accurate for the run; the standing “uncommitted artifacts” note is not).

Repo-fit that I checked and am **not** flagging: new `SNAPBACK_BROWSER_AUTH_*` codes live under `tests/`, which `generate-diagnostics-registry.mjs` does not scan; no new `*.test.mjs` files, so the package-test inventory is unchanged; `@ref` slugs (`0059#cross-context-ownership`, `0059#transition-barrier`, `0258#d2-…`, `0258#d3-…`) match live headings; secret scan of the witness is clean (`sbs_` / `sbrv1_` / generated emails and passwords absent). CDP connect has no timeout, but `launchChromeCdp` already waits on `DevToolsActivePort` + `/json/version`, so I am not treating that as a hang.

`VERDICT: NOT READY`

## Round 2 — delta (READY)

I'll review only `820eff6b2` against the ten original findings, then spot-check the rewritten evidence and ticket against the committed witness JSON.The delta is large; next I’ll isolate the test, client, evidence, and ticket changes and check them against the witness.I'll read the helper predicates, Safari/port/binary fixes, unit tests, and the committed witness refresh records next.The helpers and witness refresh records are the load-bearing parts; I'll read those next and then compare them to the evidence and ticket.I'll verify authority-key semantics, `seedProtected`, platform-option handling, and the remaining witness/evidence mismatches.Delta review of `820eff6b2` against the ten accepted findings from `146cd6ade` + `b7528195c`. No files were modified.

Witness spot-check (`tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`): both engines fail **only** `concurrent-refresh`, with the exact note *“refresh race had zero caller successes and fail-closed blanked both tabs automatically”*. Refresh facts are identical on Chromium 151 and Safari 26.6: HTTP **401 + 409**, caller codes **`SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` + `SNAPBACK_AUTH_REFRESH_SUPERSEDED`**, zero `ok: true`, predecessor session **epoch 7 / rev 15**, automatic + `manualRecovery` settled anonymous **epoch 8 / rev 17 / no bearer**, then `logoutPreparation.entry` is a fresh authenticated password sign-in at **epoch 9 / rev 19**. Source-file sha256s in the witness match the bytes at `820eff6b2`. Proofs 1 and 3–6 are PASS on both engines.

## Original findings

**1. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1717–1841`, `browser-auth-bootstrap-v1-page.mjs:377–388`

Logout, sign-in, and user-switch now seed a real participant probe (`protectedRows` + optimistic layer) and require `barrierBlankedAfterSeed` plus `protectedEmpty`. Sign-in/switch winners are the unique successful caller’s snapshot (`successfulSignins[0].snapshot` / `successfulSwitches[0].snapshot`) and both tabs must `sameSettledAuthority` that winner — no longer `settledUser(auto[0])`. Witness: each of those arms is 1-ok / 1-fail, both tabs match the recorded winner, barrier traces show `blank(protectedRows=0)` then `clearMemory(optimisticState=0)` after a 1/1 seed. Refresh correctly does not seed protected state (same-authority rotation must not blank). No new defect.

**2. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1033–1049, 1613–1633`

`refreshConverged` now requires exactly one success, `refreshWinnerRotated` (authenticated session, bearer present, **revision = start+1**, `sameSettledAuthority` so epoch **and** `authorityKey` unchanged — matching LLP 0059’s key, which does not include the bearer), typed loser `SNAPBACK_AUTH_REFRESH_SUPERSEDED`, and both tabs `sameSettledCustody` the winner. Fail-closed anonymous agreement is **not** a pass (only a note). That is the LLP 0059 contract; the recorded 401/409 zero-winner run stays red. No new defect.

**3. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1643–1662`

Notes are derived from the failing conjunct. The recorded run hits the zero-success + fail-closed branch, and that string is what both engines stored. The old hardcoded “stale principal/custody revision” path is gone.

**4. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.evidence.md:58–77`, `issues/20260816-refresh-race-zero-winner.md:19–42`

The original contradiction is gone. Evidence and ticket now state 401/409, zero successes, `CREDENTIAL_RESPONSE_INVALID` + `SUPERSEDED`, automatic fail-closed anonymous convergence, epoch advance as session→anonymous (not a bearer rotation), `manualRecovery` still anonymous, and epoch 9 coming from `logoutPreparation.entry`. That matches the witness on both engines (see spot-check above). Residual non-refresh wording is called out under New findings; it does not revive the accepted refresh-prose bug.

**5. FIXED** — `packages/snapback-client/app-client.d.mts:67–72`, `guide/reference/registry.json:24973`, `guide/reference/expo-snapback-client.md:5676–5681`

`broadcastChannelFactory` and `hintStorage` are on the type, in the registry signature, and in the generated guide projection. Shifted `app-client.d.mts` line numbers were updated with the regen.

**6. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:563–577, 948–960`

After `POST /session`, timeouts/window-handle init is in `try/catch`; failure best-effort `DELETE`s the session before rethrow. The mock arm now fails timeouts after session create and requires `initializationFailureCleaned`.

**7. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:802–827`

`launchSafariWebDriver` retries up to 3 freshly reserved ports on `SAFARIDRIVER_EXITED` or a start-timeout whose message looks like bind/`EADDRINUSE`. The listen(0)→close→spawn TOCTOU remains (unavoidable without a bound fd) but is no longer single-shot.

**8. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:47–57`

`DEFAULT_SERVER_BINARY` is `join(ROOT, 'target', 'debug', 'snapback')`. Parent was the developer-absolute `/Users/ccheever/projects/snapback/target/debug/snapback`.

**9. FIXED** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:1245`, witness `source.note`

Stamp is now “this witness and its proof artifacts are committed with the landing.” Evidence no longer says “uncommitted fix.” `source.gitCommit: b7528195c` + `gitDirty: true` is honest for the pre-commit run; executed file hashes match `820eff6b2`.

**10. FIXED** — `packages/snapback-client/app-client.test.mjs:570–692`

The three requested tests are present (omitted keys use host defaults; `broadcastChannelFactory: null` does not touch `BroadcastChannel` and the peer stays anonymous; browser-kind with `BroadcastChannel`/`localStorage` undefined still constructs and signs in). Re-ran them here: 3/3 pass. No new defect.

## New findings

**N1. Suggestion** — `tests/acceptance/browser-auth-bootstrap-v1.evidence.md:13`

Evidence still says the run used “the **pinned** prebuilt binary.” The committed witness records `server.launch.identityVerdict: "unpinned-binary"` and `identity.gitDirty: true` (the debug binary’s own stamp is dirty). Refresh/ticket numbers match; this leftover pin word does not.

**N2. Suggestion** — `tests/acceptance/browser-auth-bootstrap-v1.mjs:788–817`

If attempt 1 is a retryable `SAFARIDRIVER_EXITED` **and** `ownership.stop()` also throws, the thrown `AggregateError` has no `code`, so `retryableSafariDriverStartup` will not retry. Double-failure only; the happy bind-fail path still retries.

Neither is a product-logic regression of the ten fixes.

`VERDICT: READY`

## Round 3 — final delta (READY)

I'll review only `7800b3aa2` against the six residual items and keep this read-only. First I'll load the review skill and inspect the commit.The review skill is for a different workflow; I’ll inspect this commit myself and keep the worktree untouched.I'll compare the page inspector to the product adapter and read the rest of the commit in full.Next I’ll read the product adapter and the changed tests so I can check addressing, isolation, and redaction line by line.I’ll read the rest of the runner, the product owner-key path, and the witness so I can score each residual item.I’ll pull the witness facts, the prior-round switch/hint/safari code, and the auth request shapes next.I need the page snapshot shape, refresh-request bodies, evidence-vs-witness details, and a count of the app-client tests.I’m checking refresh evidence, auth request bodies, source hashes, and a few remaining edge cases.I have enough to score every residual. Checking one last addressing detail: whether the default-partition comparison can diverge without `normalizeAuthCustodyOwnerKey`.# Final delta review — `7800b3aa2`

Reviewed only this commit against the four residual items, the inspector/isolation follow-up, AUTH-DEBUG redaction, prior-round regressions, and witness-true evidence.

---

### 1. Residual items

**a. User-switch race — DONE**  
`tests/acceptance/browser-auth-bootstrap-v1.mjs:1474–1494`, `:1842–1878`

Bob is seeded on `partition=seed-b`. Seeding now fails unless Alice and Bob have non-null, distinct `userId`s. The race target is the account that is *not* the predecessor; both tabs call `switchUser` with that target; convergence requires `switchWinnerUserId === switchTarget.userId` and `!== switchPredecessorUserId`.

Witness (both engines): one caller success, loser `SNAPBACK_AUTH_SESSION_EXPIRED`, automatic snapshots on the target, predecessor ≠ winner.

| Engine | Predecessor | Target / winner |
| --- | --- | --- |
| Chromium | `usr_66a1nb04e4r7bvcehyrbnm8r20` | `usr_7pzp64v8he66bpsh0d5vavfbsa` |
| WebKit | `usr_311yzmk0ene72pmrzc5kt83twc` | `usr_46ffwnwbe0ed3ps9fe45d2154d` |

**b. Explicit-null `hintStorage` unit test — DONE**  
`packages/snapback-client/app-client.test.mjs:714–771`

`hintStorage: null` is passed through `Object.hasOwn` (`app-client.mjs:481–483`), so `AuthCoordinator` keeps `null` and does not fall back to `globalThis.localStorage`. Host `localStorage` is stubbed with read/write counters; after sign-in the peer converges via BroadcastChannel and both counters stay `0`.

**c. Safari retry codes + init-failure cleanup — DONE**  
`tests/acceptance/browser-auth-bootstrap-v1.mjs:800–810`, `:586–588`, `:961–973`

Cleanup `AggregateError` now copies `error.code`, so `retryableSafariDriverStartup` still sees `SNAPBACK_BROWSER_AUTH_SAFARIDRIVER_EXITED` / `START_TIMEOUT`. The timeout branch still matches address-in-use text inside the wrapped message. Init-failure `DELETE /session` from `820eff6b2` is unchanged; the mock still requires `initializationFailureCleaned`.

**d. Evidence binary-identity wording — DONE**  
`tests/acceptance/browser-auth-bootstrap-v1.evidence.md:12–15`

The “pinned prebuilt binary” claim is gone. The receipt now says the worktree debug binary plus the witness identity verdict. Witness: `identityVerdict: "verified"`, `sourceByteIdentical: true`, `strategy: "qualified-byte-identical-scratch-copy"`, `buildProfile: "debug"`, path `…/sbs0816-w-browser/target/debug/snapback`.

**e. Inspector false positive + isolation test + AUTH-DEBUG — DONE**  
Covered in (2)–(4) below.

---

### 2. Inspector vs product adapter — DONE

`tests/acceptance/browser-auth-bootstrap-v1-page.mjs:32–46`  
`packages/snapback-contract/auth-custody-indexeddb.mjs:181–196`  
`packages/snapback-contract/auth-coordinator.mjs:403–409`

| | Product `ownerAddress` | Page `CUSTODY_ADDRESS` |
| --- | --- | --- |
| Default branch | `storageKey = ownerKey.appId`, lock `snapback-auth-custody:${appId}` | same with `app.identity.app` |
| Partitioned branch | `authCustodyOwnerKeyHash(ownerKey)` | same function with `{ appId: app.identity.app, storagePartition: DEFAULT_PARTITION }` |
| Hash payload | `snapback.auth-owner.v1\n` + `JSON.stringify({ appId, storagePartition })` after `normalizeAuthCustodyOwnerKey` | identical (hash always normalizes) |
| IDB key | `['snapback-auth-custody-partition-v1', hash]` | same marker + hash |
| Lock | `snapback-auth-custody-partition:${hash}` | same |

The page and the client both pass `app.identity.app` and the URL `partition` (`seed-b` or omitted → `'default'`). `canonicalAppId` / `canonicalStoragePartition` do not rewrite valid values, so hash inputs match.

The page branches on the raw URL param *before* normalize; the adapter branches after. For this harness (`default`, `seed-b`) that is the same decision. An invalid partition would throw inside `authCustodyOwnerKeyHash`, not silently read the legacy row.

---

### 3. Isolation test vs dropped partition — DONE

`packages/snapback-client/app-client.test.mjs:465–512`  
Owner construction: `app-client.mjs:652–654`

If `createSnapbackAppClient` omitted `storagePartition` on `AuthCoordinator`, both clients would share the default row. Then:

- `partitioned` would restore `USER`, not stay `'anonymous'` (`:469`)
- after peer signup both principals would be `PEER_USER` (`:471–472`)
- `withOwnership({ appId, storagePartition: 'secondary-profile' })` would have no record (`:493–497`)
- forced `/auth/session` would not send both bearers (`:506–513`)

The test would fail.

---

### 4. AUTH-DEBUG cannot leak credentials/bearers — DONE

`tests/acceptance/browser-auth-bootstrap-v1.mjs:333–350`

Env-gated (`SNAPBACK_BROWSER_AUTH_DEBUG_HEADERS === '1'`). On the paths this harness actually proxies:

| Path | Secret on the wire | Hook |
| --- | --- | --- |
| `POST /auth/password/signup\|signin` | JSON `{ email, password }` | `"password":"[^"]*"` redacted; `JSON.stringify` has no spaces, so the regex matches |
| `POST /auth/logout\|refresh\|family-alarm` | empty `{}`; bearer in `authorization` | body has no secret; header name matches `/authorization\|cookie\|token/i` → `<redacted-present>` |
| `GET /auth/session` | `authorization: Bearer …` | same header redaction |
| Responses (signup token + recovery codes) | in body | only `"userId":"…"` is logged |

Protocol headers (`x-snapback-auth-client-protocol`, etc.) carry versions only. Emails are logged; they are not credentials or bearers.

---

### 5. Prior-round regressions — DONE (no regression)

Still present and not weakened: omitted-default wakeups, explicit-null BroadcastChannel, absent host mechanisms, predecessor seeding, winner-tying, LLP 0059 refresh predicate (401/409, zero winners, fail-closed blank), Safari init-failure `DELETE`, worktree-relative default binary, `Object.hasOwn` wakeup injection.

---

### 6. Evidence is witness-true — DONE

Checked against `tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`:

- Proof table: 1/3/4/5/6 PASS, proof 2 FAIL on `concurrent-refresh` only, both engines
- Refresh: HTTP 401 + 409; `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` + `SNAPBACK_AUTH_REFRESH_SUPERSEDED`; automatic snapshots anonymous, epoch 8 / revision 17, `bearerPresent: false`
- User-switch: two distinct users per engine; winner = target
- Chrome `151.0.7922.138`; Safari `26.6` / macOS `26.6.1`
- `secretScan.outcome: PASS`; witness `ok: false` as claimed
- Source file SHA-256s match the tree at this commit
- `23/23` matches 16 top-level + 7 nested `t.test` cases (22 + the new hintStorage test)

---

### NEW findings

None that affect landing.

Nit (not blocking): the page still copies `ownerAddress` instead of calling a shared helper (`PARTITIONED_KEY_MARKER` is not exported). Today the hash inputs match; a later adapter-only change could reintroduce the false positive. Exporting `ownerAddress` would pin that.

---

**VERDICT: READY**
