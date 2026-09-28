# FU round 4 — session-owned refresh custody

All six requested findings are repaired. A token's refresh claim now belongs to
its saved session, so a peer or fresh runtime cannot resend an unknown
predecessor. Proven non-dispatch permits renewal, and an unknown automatic
outcome reports an actionable `app.auth.why`. Nonretryable change-feed refusals
are visible and stop polling; every failed unverified probe is paced.

Read the four prior prompts, reports and journal entries, Astra's complete
round-3 review and Grok's completed round-2 review. The latter's remaining
changes-refusal finding is included. Fetched origin; `origin/main` remains
`9ef49d43c`, the same tip recorded in round 3. No merge was needed. Base is
`5ff508773`, branch `sb4-intent/fu-fresh-replay-uploads`. This round changes only
SDK code, tests and documentation. No server, contract, dependency, capacity or
wasm change. No push or publication; `scripts/test.sh` was **not run**.

## Fixes and public evidence

1. **Shared store and restart.** Under the existing session lock, persist
   `snapback4Rotation` in the session record before dispatch. It is bound to
   that record's token and adds one bounded field, not a token-history journal.
   A save of the same bearer preserves its claim. Proven refusal clears it;
   successful successor adoption replaces it. A stale peer whose stored bearer
   has already changed is refused locally, without resending the predecessor.
   App transactions use the same persistence queue and session lock as account
   commits, without recursively acquiring that lock. Online adoption now awaits
   its authorized save before notifying `onSession`, as the local tier does.

   Public tests use real guest sessions and real server rotation. The server
   answers **200**, then the injected transport discards the reply; opening a
   peer sends nothing further. The same persisted store and saved wasm device
   are serialized into a **fresh Node process**, which also sends no refresh.
   Test doors are `createApp` online, `createApp`/wasm, and direct
   `createLocalClient`. Cases include reset, malformed HTTP 200 `{}`, body
   failure, and an unknown explicit refresh outside the automatic refresh
   window. Another test holds the first request before its response: a
   concurrent peer cannot dispatch. The new session-model I14 checks that a
   consumed bearer is never dispatched again.
2. **Non-dispatch versus unknown.** Only connection-establishment causes
   (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`,
   `UND_ERR_CONNECT_TIMEOUT`; all members for an aggregate failure) prove
   non-dispatch. Reset, opaque errors and body loss do not. A body exception
   named `ECONNREFUSED` is still unknown. Proven non-dispatch clears the claim
   and allows explicit, scheduled and peer-client renewal; nine public cases
   exercise those three paths across the three doors. Six more hold an owner
   in flight while a peer sees its claim, then prove non-dispatch: the peer can
   renew explicitly or by a scheduled store recheck, and clears its warning.
   A remaining claim never permits dispatch, even if its owner crashed.

   Automatic unknown results publish `app.auth.why` with a sign-in instruction,
   retaining the signed-in state until an actual terminal auth refusal occurs.
   Restoration also reports the warning outside the refresh window, before an
   explicit call. Failure to save the detailed outcome cannot erase the
   pre-dispatch fence or hide the app warning; both app tiers test that fault.
3. **Probe pacing.** Validated refusals are paced regardless of code or
   `retryable`. Malformed bodies use the shared HTTP decoder and back off;
   invalid successes/transport failures enter the existing offline delay.
   Neither refusal nor reachability verifies store identity or acquisition.
   Public recovery tests lose the change feed, receive one retryable overload,
   then retryable, nonretryable or malformed replies. Each failed unverified
   probe waits; there is no `E_RATE_LIMIT` code exemption.
4. **Changes refusal.** `pauseRefusal` retries only explicitly retryable
   envelopes. A validated nonretryable `/changes` refusal is published to
   observed reads, including subsequent observations, and stops the follower
   until reopen. The link stays online. Four public cases cover both tiers and
   both `retryable: false` and omitted `retryable`, with `E_STORE` visible and
   exactly one poll after the denial is released.
5. **Malformed refresh success.** HTTP 200 `{}` returns
   `invalidResponse(response.status, "session refresh")`, not fabricated
   `E_AUTH`. Its status and unknown outcome survive both tiers, peer opening
   and restart; it does not itself clear the session.
6. **Probe Retry-After.** The probe fixture advertises **three seconds**, pins
   randomness and records actual requested timer delays. It requires at least
   3,000 ms for validated replies, including nonretryable overload, and at
   least 1,000 ms for malformed replies. Dropping only the probe headers fails
   all three cases; a one-second fallback cannot pass this assertion.

Seven isolated mutations under ignored `target/fu-r4-controls/` fail **29 named
public cases** (3 shared claims, 9 non-dispatch renewals, 6 stale peer claims,
3 malformed successes, 1 nonretryable probe, 3 probe-header cases, 4 changes refusals). See
`negative-controls.mjs`, `negative-controls.json`, and the compressed logs. No
mutant edits the working SDK source or dist. Existing round-3 jitter,
ephemeral, overload and startup controls remain in the affected selection.

## Refresh audit

| Entry or lifecycle | Shared custody and outcome |
| --- | --- |
| Direct local constructor | Near-expiry rotation claims the stored token under lock before dispatch. The constructor retains the result; its later same-token save cannot erase the claim. Saved-state startup can complete without rearming an unknown token. |
| Online constructor | Establishes its refresh-in-flight barrier synchronously before a protected read can start. Rotation uses a supplied `sessionStore`, or a private memory store for a raw client. `createApp` supplies its scoped store. |
| Deferred app startup, both tiers | Prepare/commit still precedes automatic refresh. Startup enters the shared owner; final scheduling cannot override its unknown outcome. App warnings use the existing auth snapshot. |
| Restoration / restart | Reads the persisted claim even outside the refresh window. Another store wrapper or a fresh process cannot recover permission to resend that token. A crash after claim but before dispatch is conservatively unknown. |
| Peer / overlapping refresh | Same-instance calls coalesce. Other clients use the same session lock and consult its claim before dispatch. A peer holding an old token after successful adoption cannot send it; conditional session cleanup preserves the stored successor. |
| Scheduled and clock-driven refresh | The retained outcome gates every scheduling boundary. Proven non-dispatch or retryable refusal can arm the 60-second retry. Completed unknown outcomes cannot be rearmed by a clock update. Pending claims permit a paced store recheck only; a claim never permits network replay. |
| Explicit `client.refreshSession()` / app facade | Every call consults the durable claim, including an instance that previously saw it pending. A completed unknown claim returns its retained failure. Closed/revoked facades keep their existing lifecycle refusal. Proven non-dispatch permits another request. |
| Successful response / adoption failure | Both tiers own the returned successor, then save it through the authorized session store before `onSession`. A failed successor save leaves the predecessor claimed; close/revocation custody retains existing ownership of the known successor. No duplicate online notification save. |
| Lost body or malformed success | Leaves the pre-dispatch claim. Detailed diagnostic persistence is supplementary; failure there preserves the original unknown result and warning. |
| On 401 / auth refusal | No independent refresh-on-401 path. Existing ordinary-request credential retry may wait for an already-owned rotation. Current terminal auth refusal still ends the session; it never issues another refresh. |
| Account switch / sign-in | Obtains a new bearer, commits the scoped session/epoch and retires old clients. No replay of an unknown rotation. Old-scope conditional writes and cleanup cannot overwrite the newly committed session. |
| Close / sign-out / logout-all | Starts no fresh rotation. Existing waiting, tombstone and late-successor retirement rules remain. Ordinary close preserves the session record, including its claim; explicit sign-out retires the credential itself. |
| Stateless `auth.refreshSession(url, token)` | One request per caller invocation, with validated refusal/status/cause. It has no session-store or retry owner; callers choosing this lower-level helper own custody. |

Search covered `rotateSession`, `refreshSession`, `/auth/refresh`, schedulers,
restoration, `client-start`, `app`, and revocation paths. Web worker, Expo and
native-process clients share `local.ts`. This round executes wasm and existing
native-process app tests; it does not claim a new browser/Expo platform witness.
Atomic store writes and cooperating session-lock users remain the existing
protocol assumptions. Browser cross-tab exclusion uses its existing Web Locks;
no new cross-host transaction primitive is introduced. A lost successor cannot
be recovered from a claim: safe recovery is a new sign-in, not replay.

## Validation and attribution

Final affected scope: **596 cases cleared** across ten files (including
**120 overload**, **35 custody**, **317 delivery fault/census** and **78 app**
cases). The combined run finished **595 pass / 1 fail / zero cancelled or
skipped**. Its one failure was our diagnostic-persistence fixture: after
deliberately preventing a detailed error save, a subsequent explicit call now
reads the durable generic unknown claim. The corrected fixture separately
asserts the original automatic `E_OFFLINE` warning, the later `E_HTTP_RESPONSE`
claim, and one server rotation. Both tiers pass the final **2/2** rerun; no
product change followed the combined run. See `affected-qualified.log.gz` and
`outcome-persistence-qualified.log.gz`. The preceding combined selection passed
590/590 before the six peer-proof cases were added. The scoped session model passes **54/54**, including
its fixed regressions, two new I14 cases, and **100 seeds per tier** with three
runtimes per sequence. This is not the default 5,000-seed sweep.

Whole guide: **98/98**. Build/typecheck, docs budget, reference validation and
whitespace checks pass. The delivery await census retains every existing
classification/fault case; the two probe await identities are updated for the
shared decoder and unconditional refusal pacing. `local.ts` remains below the
1,500-line source limit (1,499 lines).

The final peer-refusal refinement also covers the case where a peer cached an
in-flight claim before its owner proved non-dispatch; it cannot retain a private
permanent fence after the shared claim clears.

Every observed red is in [FAILURES.md](FAILURES.md) and `failures.json`.
All are **ours**: an intermediate online startup-barrier regression (fixed),
old fixture assumptions changed by session-owned custody, test-development
mistakes, and intentional negative controls. The first expanded app run was
interrupted on a fixture's nested lock; its own recorded PIDs were stopped,
and the repaired complete app file passes. No unresolved failure and no
baseline/environmental failure is reported for this round. No full-suite claim.

Wasm is unchanged: **2,040,545 B raw / 593,008 B GNU file-input gzip-9**,
budget **593,719 B**, headroom **711 B**. SHA-256
`f6e97419cd2dd84e358add161caafcc7e2948953cee507b7d25927b487d4f409`.
Measured the existing round-2 artifact; SDK-only work needs no wasm rebuild.
Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127. No tool installation or
shared-machine configuration change. See `wasm.json` and `inputs.json`.

## Scoped LLP context and maintenance

Applied `llp-orient` read-only within the Snapback 4 fence. Governing context:
LLP 3000 §7 / `http-overload-diagnostics` (current), LLP 2000.000 §§6/11/12,
and LLP 3000.011.003.000 §2. Keep credential ownership, late-successor cleanup,
local sign-out, durable mutation custody, bounded retries and ephemeral
no-replay. The paved client/session reference was read before changing the
surface. LLP 3000 and that reference are updated together with code; I2 now
expressly permits only rotation-claim metadata on failure, and I14 states the
no-repeated-consumed-bearer invariant. No new LLP or gate. Hand-off: none.
