# Lane E review round 2 — four Grok findings

Date: 2026-09-24. Review base: `0445cced7`; branch `sb4-intent/e-client`.
Implementation commit: `3bbb80328`. No push or publication.

## Changes, file by file

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app-storage.ts` | Injective store-key encoding and a shared transaction lock for session/journal persistence; structured storage warnings. |
| `packages/snapback4/src/auth.ts` | Session keys use the safe encoding before reaching any store. |
| `packages/snapback4/src/app-journal.ts` | Backend/owner/intent/receipt shape validation and preservation of damaged or foreign bytes under a separate key. |
| `packages/snapback4/src/app-online.ts` | Safe journal keys, recorded backend and per-intent owner, recovery checks, validated reads and shared locking. |
| `packages/snapback4/src/app.ts` | Lock session replacement/deletion, compare the stored bearer before automatic clearing, revoke dropped tokens, clean up failed opens before publishing signed-out, and retain journal warnings in auth state. |
| `crates/snapback4/src/verbs/init/expo-client.ts` | Generated SecureStore adapter passes already-safe keys through unchanged. |
| `packages/snapback4/README.md` | Same corrected SecureStore adapter. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Corrected adapter, owner checks, quarantine behavior, session locking and format-compatibility limits. |
| `packages/snapback4/test/app-storage.test.mjs` | Generated-adapter collision tests, foreign-owner recovery refusal, malformed-record preservation, and quarantine-failure tests. |
| `packages/snapback4/test/app.test.mjs` | Real-server failed-open cleanup and competing online/local refresh tests; storage-fault selectors follow the new keys. |
| `packages/snapback4/test/readme-examples.test.mjs` | The documented adapter preserves the library's encoded key exactly. |
| `packages/snapback4/test/react.test.mjs` | Shared-app fixture persists via keepSession instead of spelling an internal key. |
| `witness/starter.mjs` | Browser fixture uses the public sessionKey helper rather than the old literal namespace. |
| `JOURNAL.md` | One dated append-only review entry. |
| `reports/20260924-lane-e-review2.md` | This report. |
| `reports/20260924-lane-e-client.md`, `reports/20260924-lane-e-review1.md` | Point to this follow-up while retaining earlier results. |

## Disposition and regression evidence

1. **High: collision and cross-account replay — fixed.** Backend and principal
   key segments use fixed-width hexadecimal UTF-16 units, which are injective
   even for unpaired JavaScript surrogates. Dots separate segments; every key
   uses the SecureStore-safe alphabet before the adapter sees it. Journals
   record backend and owner, and every pending intent records its owner.
   Parsing and dispatch both check ownership. Tests execute the actual generated
   Expo Go adapter against a SecureStore-shaped backend for `a!b`/`a~b`,
   `a*b`/`a'b`, `a(b`/`a)b`, and `user:01ABC`/`user_3A01ABC`. B sends only B's
   write; A's pending ID/arguments recover only after A signs back in. Another
   test covers colliding backend URLs. A deliberately misplaced intent with a
   foreign recorded owner is preserved separately and never dispatched.
2. **Failed sign-in retaining a bearer — fixed.** Failed opening invalidates
   its save permissions, starts remote revocation, removes its kept token,
   and only then publishes signed-out. The second-set fault test now uses a
   real server: every signed-out publication observes no stored session;
   restoreSession returns null; a new app stays signed-out; the issued token
   is refused by the server; a later sign-in succeeds after storage recovers.
3. **Stale tab clearing a successor — fixed.** Session replacement and deletion
   use the same Web Lock (and runtime lock). Automatic refusal clears only a
   stored token equal to the refused bearer. Explicit deletion captures and
   revokes any successor it removes. Two real-server tests, online and process
   device, hold B's refresh, let A rotate and persist, then release B to receive
   refusal. B becomes signed-out, A's stored successor remains and still reads.
   A subsequent explicit clearing operation revokes the dropped successor.
4. **Damaged journal blocking sign-in — fixed.** Parse or shape failures
   preserve exact original bytes under a unique `.damaged.` side key and
   replace the active record with an empty owned journal. Restore and login
   succeed with an E_CLIENT warning in auth.why. Tests cover invalid JSON, null,
   missing owner/backend metadata and invalid pending shape. Fresh writes work
   afterward, and another restart succeeds without the warning. If quarantine
   cannot be preserved, auth still opens, original bytes remain, and writes
   stay blocked until preservation succeeds. Naming/entropy failure takes the
   same safe path rather than rejecting sign-in.

## Verification

- Package TypeScript build and `cargo build -p snapback4` passed.
- Final affected app/custody/storage/React/README/starter suite: **73 passed,
  0 failed** (`/tmp/lane-e-r2-final-affected.log`). This includes both generated
  starter typechecks and the real-server README journey. The earlier 72-test
  pass is `/tmp/lane-e-r2-focused2.log`; the final run adds quarantine naming
  failure coverage and verifies its guard after the full-suite snapshot.
- One initial focused failure was **ours, fixed**: the Web Locks callback's
  Lock argument reached the journal reader's boolean parameter. The lock
  adapter now invokes work with no arguments; unavailable quarantine keeps
  auth open and original bytes intact. Both subsequent affected runs pass.
- Chromium starter witness: **passed**, including account isolation, durable
  replay, logout, worker update, active-build navigation and unused lazy assets
  offline (`/tmp/lane-e-r2-starter.log`).
- Chromium cold-offline witness: **passed**, 1,498 ms, including account and
  replica recovery after both servers stopped (`/tmp/lane-e-r2-cold-offline.log`).
- Complete `scripts/test.sh` (exit 1), exactly:

  ```text
  == 1 failure(s) in 145 s
     cargo test
  ```

  `/home/ccheever/sb4-intent/lane-e-review2-test.log`. Client tests: **1,030
  passed, 10 skipped, zero failed**. Every failure is present in the untouched
  host baseline `/home/ccheever/sb4-intent/baseline-test.log`:

  | Test | Classification | Reproduction from `snapback4/` |
  |---|---|---|
  | `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | Baseline | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
  | `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | Baseline | `cargo test -p snapback4-device --test device search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
  | `census::authoring_census` | Baseline | `cargo test -p snapback4-device --test readauth census::authoring_census` |
  | `w9b_why_operation_keeps_residency_and_cost_output` | Baseline | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

  No lane-introduced or environmental full-suite failure remains in this run.

## Compatibility and limits

The earlier lossy names and ownerless app-journal format cannot be safely
imported automatically. Concrete counterexample: the old adapter maps `a!b`
and `a~b` to the same journal key and the old record does not name its owner;
there is no evidence permitting dispatch under either principal. This revision
uses a new key namespace and leaves old bytes untouched. Sign in again after
upgrading; previous ambiguous records require explicit verified recovery.
This is documented and is not a promise to migrate the unpublished lane's
old journals. Local device outboxes and server data are unchanged.

No engine authorization, disclosure, meter, Client vocabulary or ceiling
changed. No native Expo simulator or integrated target-Clique qualification was
added. Shared custom stores in separate non-browser processes still require
one writer; the SessionStore interface has no cross-process atomic operation.
