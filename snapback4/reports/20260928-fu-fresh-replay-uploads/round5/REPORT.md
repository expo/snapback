# FU round 5 — truthful overload, refresh custody deferred

Removed the session-rotation claim, retained-outcome fence and startup suppression.
Refresh dispatch, persistence and scheduling now match `origin/main`, with only
independent refusal improvements retained. The supplied-replacement reproduction
passes on both tiers. Overload handling, pacing and once-view protections remain.
The ambiguous-refresh problem is explicitly unresolved, as on main, and belongs
to [its separate issue](../../../../issues/20260928-snapback4-ambiguous-session-refresh.md)
and a future lane with its own LLP.

Read the five prior prompts, reports and lane journal entries, Astra's full
round-3/4 reviews and the completed round-2 reviews. Applied `llp-orient` under
the Snapback 4 fence. Fetched origin: `origin/main` is still `9ef49d43c`, as in
round 4, so no merge. Revision base is `b22998869` on
`sb4-intent/fu-fresh-replay-uploads`. No push, publication, tool installation,
shared-machine change or other-worktree edit.

## Scope and retained refresh changes

Deleted `session-rotation.ts` and `session-transaction.ts`, including the token
claim, connection-establishment proof bookkeeping and rotation warning hook.
Removed the online `sessionStore` option added solely for that mechanism.
Restored `keepSession`, app persistence/notification behavior, both schedulers,
constructor/deferred startup, and original session-model I1–I13 tests from main.
Removed I14 and its associated custody tests and documentation promises.
The original app lifecycle and session-security tests are byte-for-byte main.

Each refresh change retained relative to main is independent of custody:

1. `readResponse()` validates/preserves server refusals and reports malformed
   HTTP bodies with status. It makes one request per auth helper call.
2. `transportRefusal(error)` preserves the actual fetch/body error cause; absent
   cause uses neutral wording instead of claiming the server is unreachable.
3. A success without a valid session, including HTTP 200 `{}` or an incomplete
   session, returns `invalidResponse(status, "session refresh")`, not fabricated
   terminal `E_AUTH`. It does not itself clear the account.
4. A retryable `E_AUTH` remains a retryable refusal through constructor and
   running-client handling. Only a terminal `E_AUTH` ends credentials. The same
   distinction in ordinary stale-credential handling preserves overload refusals.

There is **no** unknown-outcome dispatch prohibition or new storage protocol.
Startup, explicit calls, timers and clock corrections may refresh again, as on
main. A lost successful rotation can therefore still produce a later 401. The
new ticket records that limitation, not a solved custody guarantee.

## Retained overload behavior and evidence

No round-5 change touches server admission/reporting/accounting/CORS, workers,
assets, ephemeral decoding, schema loading or the common request transport.
Existing online/local/sync refusal handling and mutation jitter remain. All
three server overload tests pass, including actual thread-spawn failure with an
unfinished upload and full-worker refusal accounting.

Online probes now use the shared response decoder and an abortable jittered
pause after unsuccessful replies, preserving their `Retry-After` minimum.
Malformed and transport failures back off too. Local probe pacing from round 4
remains. Public tests advertise three seconds; discarding only online probe
headers fails all three modes (retryable, nonretryable, malformed sequence).
Nonretryable changes refusals still surface in observed reads and stop polling;
four tests cover omitted/false retryability on both tiers.

The 109-case overload suite passes. This includes every reproduction confirmed
by Astra round 2 and Grok's round-2 controls:

| Reproduction | Round-5 result |
| --- | --- |
| Once-view download, credential rotation, `ECONNRESET` | One GET, original cause retained; malformed/successful obsolete replies also never consume a second view. |
| Ephemeral JSON 503 | Exact `E_RATE_LIMIT`, online link, queued distinct call retained, no replay. Malformed text/null/envelopes retain HTTP status too. |
| Fresh local schema overload | Four bounded attempts, typed exhausted `E_RATE_LIMIT`; recovery on attempt three and transport/status controls pass. |
| Offline probe/sync receives overload, then upload | Reachability restored without adopting identity; upload reaches server and returns its refusal. |
| Concurrent retry jitter | Uploads, downloads, queries and same-ID mutations produce distinct 1000/1062.5/1125/1187.5 ms first waits for `Retry-After: 1`. |
| Sign-in failures | Guest/signup/login/refresh/logout-all retain reset causes and malformed HTTP status, one request each. |
| Nonretryable changes / failed probes | Denials visible; changes stop; probes take a delay with advertised minimum. |

An isolated SDK compiled from main runs the 42 selected confirmed-reproduction
cases: 36 fail and 6 controls pass. The final SDK passes all of them as part of
the overload suite. This is expected negative evidence, not a green-main claim.

## Refresh parity and regression controls

Astra round-4 #3 is now a public constructor regression: persist A, supply B's
valid near-expiry bearer, observe exactly one refresh of B with real HTTP 200,
then query as B. Neither tier deletes A as rejected authentication. Local
persists B's successor; raw online leaves persistence with its caller, as on
main. Both tests pass against the isolated main SDK and the final SDK; both
fail against the isolated round-4 SDK before any refresh dispatch.

Nine non-dispatch controls cover explicit, scheduled and peer renewal through
online app, wasm app and direct local construction. All nine pass on main and
this revision. Six diagnostic tests cover empty/invalid-session HTTP 200 and
retryable E_AUTH on both app tiers: all fail on main and pass here, with account
and session bytes preserved until successful later renewal. No claim metadata
is written. These substantiate the retained independent improvements.

`main-refresh-source-parity.json` records twelve source/test comparisons. Mainline
scheduler/rotation, local constructor and both startup paths match after only
normalizing comments/whitespace and the documented retryable-auth condition.
App code, session persistence and five original test/model files match main.
Comparison SDKs are complete main/round-4 source transpilations in ignored
`target/fu-r5-controls/`; they use the same current wasm and real server to isolate
SDK behavior. No external worktree or source package is mutated.

## Qualification

- Overload/recovery initial selection: **118/118** (109 overload + 9 renewal).
- Refresh and delivery matrix: **334/334** (17 refresh + 317 fault/census cases).
- Adjacent account/session/publication/schema/ephemeral selection: **124/124**.
  These selections clear **567 distinct client cases**.
- Server overload tests: **3/3**.
- Whole guide: initial **97/98**, then corrected **98/98**. The only failure was
  ours: a published package page linked to a repository-only issue. Removed the
  unshipped link while preserving the limitation text.
- Package build/typecheck pass. Ref-check: **522 LLP docs, 9,848 refs, zero errors
  or unchecked**. All 158 delivery-await classifications and fault recipes stay
  identical; only the broader await fingerprint reflects removed custody work.
- `scripts/test.sh` ran **exactly once**, with command-local `ulimit -n 4096`,
  exit **1**. Exact summary: **`== 1 failure(s) in 1281 s`**, category `cargo test`.
  Rust: **4,295 pass / 1 fail / 33 ignored**. Full client shards: **4,561 pass /
  0 fail / 0 cancelled / 10 skipped**. Full client models: **79/79**, including
  5,000 session sequences per tier. Fixtures: **9/9**. The sole full-run failure
  is **ours**: `snapback4-lang::guide::client::published::published_file_references_resolve_against_package_contents`,
  from the unshipped issue link. The later 98/98 whole-guide rerun qualifies the
  correction. No baseline or environmental full-run failures. No second full
  run and no all-green full-suite claim. Product code stayed unchanged during
  the full run; subsequent edits only corrected docs and removed unused test
  declarations/whitespace.

All expected controls and incidental failures are attributed in `FAILURES.md`;
raw logs are retained. No unresolved affected-test failure remains.

Wasm from the full run is **2,040,545 B raw / 593,008 B GNU file-input gzip-9**,
unchanged; budget **593,719 B**, headroom **711 B**. SHA-256
`f6e97419cd2dd84e358add161caafcc7e2948953cee507b7d25927b487d4f409`.
Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127; no wasm-opt or budget change.

## LLP orientation and maintenance

Scope: SDK auth/startup, transport probes, app session persistence and public
reference. Governing constraints: LLP 3000 §7 / `http-overload-diagnostics`
(current), LLP 2000.000 §§6/11/12 (current), LLP 3000.017 §2.4 (current),
LLP 3000.011.003.000 §2 (implemented). Preserve bounded admission, ephemeral
no-replay, same-ID mutation custody, sign-out and late-successor revocation.
Read the paved client/session reference before changing it. Updated LLP 3000
and that reference together with code, withdrawing custody guarantees and
keeping the independent overload claims. No foundation change, new gate,
contract shape, capacity or dependency. The refresh issue is the explicit
handoff to a separate design/LLP; it is not another patch in FU. Historical
round reports/journal entries remain unchanged. `local.ts`: 1,492 lines.
