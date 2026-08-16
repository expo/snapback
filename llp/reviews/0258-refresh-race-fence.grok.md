# Review: refresh-race fence fix + three-engine Phase 1.4 closure — grok-4.6 (xhigh)

Reviewer: grok-4.6, xhigh, web search disabled; mutually blind from codex.
Round 1 target: 0638a4838 + ccba8a937. Round 2 target: 672060ceb.

## Round 1 (READY with findings adopted)

I'll review the two commits against LLP 0059/0227/0258 and the closed ticket, starting with the governing docs and the full diff.The review skill is an orchestrator for a different workflow. I'll review these two commits myself against the governing LLPs and the closed ticket.The fence is the high-stakes part. I'll read the publication path, LLP 0059's operation-specific rules, and the surrounding admission code together.The fence looks conservative so far. Next I’ll check the refresh predicate, wire-delta snapshot, fixture backend, and WebDriver changes for contract mismatches.The witness records `gitCommit` as the pre-fix base with a dirty tree. I’ll compare its file hashes to HEAD and check the mock coverage claim.The specialized fence admits only the committed rotation past same-generation exact-predecessor sibling `TokenSupersede` tickets. I did not find an interleaving that publishes a stale or revoked credential the generic fence would have refused.

## Fence (priority 1)

`prepare_rotation_response_publication` (`src/auth/session_projection.rs:1414`) runs under the same topology lock as `finalize_token_rotation`. It admits only `TokenSupersede` tickets whose `expected_generation` and `predecessor` match the winner, and it excludes the winner’s own ticket. Ticket IDs are monotonic `startup_id + NonZeroU64` and are not reused (`allocate_ticket` at `:2915`).

At publish time (`try_publish_with_permitted_pending_tickets`, `:953`) the cut still requires:

| Check | Still enforced |
| --- | --- |
| Stream incarnation + stream `pending` empty | `StreamFence::admits_locked` |
| Session generation | yes |
| Terminal absent | yes |
| Deadline live | yes |
| Leaf `pending_tickets ⊆ permitted` | yes — only the doomed sibling IDs |

Logout/revocation uses `PendingMutationKind::Revoke`, so those tickets are never in the permitted set (`coordinator.rs:562`). Expiry uses `Expire`. A later refresh against the successor gets a new ticket and is refused while pending. After a completed logout, `terminal` / generation refuse. Stream reset fails incarnation or stream-pending.

The generic path is unchanged: `FencedPublication::try_publish` now delegates with an empty permitted set (`:928`), which is `pending_tickets.is_empty()`. The **only** extra admission versus the generic fence is those already-doomed same-predecessor sibling IDs.

`CommittedAuthOutcome::try_publish` (`coordinator.rs:229`) `take()`s the mutex state, checks `response_class`, and is `Clone` only to cross `http::Extensions`. A second consume is `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`. The outcome lives on the response, not on `AppState`.

`/auth/refresh` is `RouteClass::AppData`, so it always takes managed admission (`server.rs:11363`) and `finish_registered_response` (`:11408`) consumes the outcome before the body is sent. `Ok(None)` replaces the credential response with a stale-authority error.

**Logout-after-commit-cut / revocation racing finalize.** Prepare+finalize share the topology lock, so a revocation cannot sneak between the sibling snapshot and finalize. A pending `Revoke` ticket is not permitted (coordinator test). A completed logout sets `terminal` (HTTP revocation-boundary test).

**Second refresh generation.** While a later `TokenSupersede` is pending, `is_subset` fails. After it has finalized and no unexpected tickets remain, **both** this fence and the generic fence would admit — refresh does not bump generation or set terminal. That is not a new hole. Publishing the first successor before anyone else has its plaintext is what makes a completed second generation unreachable on the HTTP path. Speculation: an in-process test could finish a second rotation from `issue` and then publish the first outcome; the generic fence would admit that too.

**Claim wording.** The Resolution’s “later refreshes not present at the commit cut” is implemented as “any non-permitted **pending** ticket,” not “`current_token` is still the committed successor.” Pending later refreshes are blocked; completed ones are not distinguished. Same as the generic fence.

## Findings

### 1. MINOR — WebDriver mock poll detector not updated; evidence claims it passed

- **File:** `tests/acceptance/browser-auth-bootstrap-v1.mjs:1204` and `tests/acceptance/browser-auth-bootstrap-v1.evidence.md:136`
- **Defect:** Production poll script now reads `window.__snapbackWebDriverOperationsV1` (`:709`). The mock still matches `globalThis.__snapbackWebDriverOperationsV1` (`:1204`), falls through to `value = true`, and the client waits for `result.done === true`. I ran `node tests/acceptance/browser-auth-bootstrap-v1.mjs --webdriver-mock-check`; it failed after 60.5s with `SNAPBACK_BROWSER_AUTH_WEBDRIVER_SCRIPT_TIMEOUT` on `mockRight`.
- **Why it matters:** The window-pin and empty-body POST changes are not covered by the adapter mock. The evidence Verification bullet (“WebDriver adapter mock-lifecycle test mode … PASS”) does not match the committed code. The recorded Safari/Firefox arms are still green; this is mock/evidence drift, not a product-fence hole.

### 2. MINOR — HTTP race regression is not barrier-gated

- **File:** `src/server/tests.rs:16227`
- **Defect:** `concurrent_auth_refresh_has_exactly_one_http_winner` is a `tokio::join!` of two full-stack `oneshot`s with no premark barrier. No sleeps.
- **Why it matters:** On the expected schedule (both yield at `admit` / `plan` / `premark` / `spawn_owned_auth_transaction` before either publishes) pre-fix code returns 401+409 and this assertion fails. A fully serial schedule — A completes including unmark before B premarks — would be 200+409 on **pre-fix** code too, so a single green run does not by itself prove the specialized fence was exercised. The harness `gatedRace` is the exact overlap proof. Speculation: I did not execute this test against `9025306da`.

### 3. MINOR — LLP 0059 still says publication requires `pending_tickets` empty

- **File:** `llp/0059-session-projection-and-client-barrier.spec.md:554` vs `src/auth/session_projection.rs:953`
- **Defect:** The landing adds an operation-specific exception (admit while named doomed sibling tickets remain) and does not update `#tickets-and-leaf-fences` or `#operation-specific-publication`.
- **Why it matters:** The next reader of 0059 will think any nonempty pending set refuses the act. The closed ticket is precise; the governing spec is not. Not a runtime hole.

### 4. NIT — Loser predicate still accepts a typed rejection

- **File:** `tests/acceptance/browser-auth-bootstrap-v1.mjs:2049`
- **Defect:** `supersededRefreshes` accepts either `{ refreshOutcome: 'superseded-converged' }` or `!ok && code === 'SNAPBACK_AUTH_REFRESH_SUPERSEDED'`. The Resolution’s composed contract is the resolved `{ superseded: true }` path.
- **Why it matters:** A future regression back to “throw SUPERSEDED, no `{ superseded: true }`” could still pass if the wire is 200+409 and custody converges. The committed witness is the stricter shape on all three engines (`rotated` + `superseded-converged`).

### 5. NIT — Debug request-body redaction is password-field-only

- **File:** `tests/acceptance/browser-auth-bootstrap-v1.mjs:367`
- **Defect:** New `AUTH-DEBUG` logs the proxied `/auth/*` request body after only replacing `"password":"..."`. Authorization/cookie/token headers are redacted; `AUTH-DEBUG-RESPONSE` logs only `userId`; `AUTH-DEBUG-P2-REFRESH` logs `{ ok, code }`.
- **Why it matters:** `newPassword`, `code`, or recovery material would be printed if those routes were exercised with the flag on. This harness’s auth POSTs are signup/signin (password field), refresh, and logout. `AUTH-DEBUG-READY` is ungated but only on the ready-failure path and serializes the public page snapshot.

### 6. NIT — Closed ticket header still says Open

- **File:** `issues/closed/20260816-refresh-race-zero-winner.md:3`
- **Defect:** File is under `issues/closed/` with a Resolution, but `**Status:** Open`. Mixed in this repo; some closed tickets flip the header, some do not.

## Priority checklist

**Rust regressions.** The revocation-boundary test binds the right cut: handler returns the committed body + outcome, logout of the successor runs, then `finish_registered_response` must be 401 `SNAPBACK_AUTH_SESSION_EXPIRED` with neither token in the error JSON (`src/server/tests.rs:18820`). The coordinator test pins “sibling `TokenSupersede` admitted, pending `Revoke` refused, ordinary publication still blocked until the loser exact-unmarks.”

**Harness contract.** `refreshWireBefore` is snapshotted immediately before `gatedRace` (`:2031`); delta is `after − before` (`:2058`). `counts()` recounts the append-only `requestFacts` array — not a resettable counter. The predicate requires exactly one `rotated`, exactly one superseded outcome, `sameSettledAuthority` (epoch, key, user, session, `sessionGeneration` via `samePrincipal`), winner revision `start+1`, both tabs converged on that record, and wire `total=2 / 200=1 / 409=1`. Two rotations, zero rotations, wrong authority, epoch advance, non-converged loser, or extra/missing wire counts fail.

**Fixture / capabilities.** `schema.mjs` / `functions.mjs` are a password-only, guest-disabled, owner-scoped `notes` table plus authenticated seed/list. Generated visibility is `{ kind: "owner", field: "ownerId" }`. Governance omit (`:1561`) requires `required === false` and empty closures, otherwise throws; the witness has `governanceCarrierOmitted: false` (fixture emits no carrier). The page offers `auth.application-bootstrap.v1` and `auth.passwords` (`browser-auth-bootstrap-v1-page.mjs:197`) — exactly what `app-client.mjs:452` and `:464` require, nothing else.

**WebDriver / Safari.** `window` expandos persist in Firefox; `window === globalThis` in Safari. Body-less POSTs now send `{}` (`:643`); safaridriver accepts that. Recorded WebKit 26.6 is green. Chromium still uses CDP `globalThis[PAGE_GLOBAL]` and is unaffected.

**Evidence vs witness.** Receipt `ok: true`, 18/18 PASS, refresh arms are `rotated` + `superseded-converged` with POST `/auth/refresh` `200` then `409` on Chrome 151.0.7922.138, Safari 26.6, Firefox 152.0.1. `secretScan` PASS; no `sbs_`, `"token"`, `"password"`, `"recoveryCodes"`, or bearer strings in the witness. Source and fixture hashes match HEAD. `gitCommit` is `9025306da` + `gitDirty: true` with `identityVerdict: unpinned-binary` — honest for a pre-commit dirty run of these bytes. Resolution text matches that witness. The mock PASS line does not (finding 1).

`VERDICT: READY`

## Round 2 — delta (READY)

I'll review only `672060ceb` against the eight accepted findings, starting with the commit itself and the security-critical fence-cut fix.The commit touches coordinator, projection, tests, LLP 0059, and harness files. Next I’ll read the fence-cut and admission paths in full.The source diffs were truncated. I’ll read the fence admission path and LLP 0059 amendment in full next.The deadline test uses `AuthenticatedUse::Unchanged` — I need to confirm that actually replaces the live pair rather than taking a no-op shortcut.I have the admission path, both regressions, the pause hook, and the remaining seven items. Checking one last comparison detail on generation vs the live leaf, then I’ll write verdicts.Delta re-review of `672060ceb` against the eight accepted findings. No files were modified.

---

### 1. Fence bound only generation + sibling allowlist — **FIXED**
`src/auth/session_projection.rs:933–937`, `:1000–1024`, `:2671–2675`; `src/auth/coordinator.rs:252–259`, `:2687–2818`

The committed-refresh outcome now carries the full cut and admission compares it against the live leaf under the stream-then-session guards.

| Cut field | Captured | Live comparison |
|---|---|---|
| generation | `FinalizedRotationPublicationCut.generation` + `SessionPublicationFence.expected_generation` | `session_state.generation == expected_generation` and `cut.generation == expected_generation` |
| successor `TokenDigest` | `cut.successor_digest` at finalize (`:2673`) | `session_state.current_token == Some(cut.successor_digest)` |
| `DeadlinePair` (epoch + monotonic) | `cut.authenticated_use_deadline = fence_state.deadline` (`:2674`) | `session_state.deadline != cut…` (`DeadlinePair: Eq`) **and** `live_at` |
| stream incarnation | `FencedPublication.expected_incarnation` | `StreamFence::admits_locked` exact match + empty stream pending |
| sibling allowlist | exact-predecessor, same-generation `TokenSupersede` ids, winner excluded (`:1491–1506`) | live `pending_tickets.is_subset(allowlist)` |

Sibling comparison is **subset**, not set equality. That is the right predicate: settled siblings may disappear; a newly premarked ticket is not in the captured set and refuses. Exact allowlist equality would be a false refuse after the loser unmarks.

**No TOCTOU.** `try_publish_with_session_cut` holds the stream lock, then the session fence lock, then runs `publish()` before either guard drops (`:1001–1024`). Mutations that change token, deadline, generation, terminal, or pending take that same session fence (topology-then-session for deadline replacement). One-shot `take()` still happens before the fence check (`coordinator.rs:239–244`); a refused outcome cannot be retried.

**Regressions construct the real states, not stubs.**

- Successor₂ (`coordinator.rs:2687–2760`): first rotation commits/finalizes and the outcome is held unpublished; second rotation plans against `successor_one_digest`, `finish_rotation` returns `Committed` (finalize ran), `resolve_required_bearer(successor_two)` proves generation `1` with the new current token; then successor₁ `try_publish` is `None`. That is the ticket-free, same-generation later rotation. Pre-fix this would admit (empty pending ⊆ allowlist, gen unchanged).
- Deadline (`:2763–2818`): after the rotation outcome is captured, `finalize_authenticated_use(Unchanged { expires_at_ms: 1_000 }, 300, start+100)` is the production no-write path. `AUTH_SESSION_SLIDING_WINDOW_MS` is 30 days, so `publish_authenticated_use_deadline` computes `desired = 300 + window > 1000` and **writes** a new `DeadlinePair` onto both the projection and the fence (`session_projection.rs:2029–2053`). Same pattern as `no_write_authenticated_use_replaces_stale_deadline_and_extends_memory_only`. If the pair had not moved, `try_publish` at `350` / `start+150` would still succeed and the test would fail.

**New-admit hunt.** The extra conjuncts are only added when `finalized_rotation_cut` is `Some`. Ordinary `try_publish` still passes `None` and an empty permit set. Authenticated-use only extends (`desired <= expires` is a no-op), so the pair cannot be replaced forward and then restored to the captured values. `current_token` is cleared on revoke/expire/uncertain and rewritten on rotate; a `None` leaf cannot equal `Some(cut.successor)`. I did not find a newly admissible leaf the widened capture opens.

---

### 2. Predicate accepted a typed-rejection loser — **FIXED**
`tests/acceptance/browser-auth-bootstrap-v1.mjs:2075–2136`; page mapping still `value?.superseded === true → 'superseded-converged'` in `browser-auth-bootstrap-v1-page.mjs:688`

Loser must be `ok && refreshOutcome === 'superseded-converged'`. `SNAPBACK_AUTH_REFRESH_SUPERSEDED` is tracked only to emit *“the non-winning caller rejected instead of resolving the documented superseded convergence”*. Wire delta is still exactly one 200 and one 409.

---

### 3. HTTP race test lacked an overlap barrier — **FIXED**
`src/server/tests.rs:16227–16277`; hook at `src/server.rs:16926–16965`

Two `AfterRefreshPremark` pauses, both requests spawned, rendezvous on both `wait_until_reached`, **then** only A is released. A’s `oneshot` includes `finish_registered_response` → `outcome.try_publish`, so admission runs while B is still sitting after `premark_rotation` with its sibling ticket live. A is asserted `200` before B is released; B is asserted `409`. That ordering fails against the pre-fix generic empty-pending fence.

---

### 4. AfterRefreshPremark hook — **FIXED** (test-only; rendezvous holds both tickets)

- Enum, registry, `pause_test_finite_authority_request`, header extract, and the call site are all `#[cfg(test)]` (`server.rs:11829–11837`, `:12006–12013`, `:16926–16965`). Production `auth_refresh` does not contain the seam.
- `pause_id: None` (header unset) returns immediately (`:12011–12013`). Unset cannot change behavior even under `cfg(test)`.
- Rendezvous is after `premark_rotation` and before commit/finalize/publish. Both tickets are pending when A reaches admission.

---

### 5. WebDriver mock poll detector — **FIXED**
`tests/acceptance/browser-auth-bootstrap-v1.mjs:704–736`, `:1231`

Production poll script is `window.__snapbackWebDriverOperationsV1`. The mock now matches that string. Evidence records the window-pinned registry.

---

### 6. LLP 0059 amendment — **FIXED**
`llp/0059-session-projection-and-client-barrier.spec.md:8–13`, `:551–558`, `:566–586`; `@ref` at `session_projection.rs:929–931`, `:972–974`

Dated 2026-08-16 amendment matches the code: ordinary empty-pending rule; sole exception is the one-shot finalized rotation; allowlist is same-generation exact-predecessor `TokenSupersede` captured before finalize; admission fields are incarnation, generation, successor digest, and the full `DeadlinePair`; refuse list covers revoke/expire, later/non-captured/wrong-pred rotations, stream pending or incarnation change, generation/terminal change, ticket-free later successor, deadline replacement, and a dead deadline; one-shot and response-class binding retained.

`@ref LLP 0059#operation-specific-publication` is a valid heading slug (`### Operation-specific publication` at `:659`). The amendment body sits next to the empty-pending rule it changes (`### Tickets and leaf fences`), which is the right place.

---

### 7. AUTH-DEBUG body redaction — **FIXED**
`tests/acceptance/browser-auth-bootstrap-v1.mjs:286–309`, `:391–394`

Recursive walk over objects/arrays; field names matching `password|passcode|code|token|bearer|secret|credential`; top-level JSON string → `<redacted-scalar-body>`; unparseable → length-only. Header scrub `authorization|cookie|token` is unchanged.

---

### 8. Closed ticket Status header — **FIXED**
`issues/closed/20260816-refresh-race-zero-winner.md:3` is `**Status:** Closed`. Resolution text now names successor digest, `DeadlinePair`, and the refusing states.

---

### Evidence wording — **FIXED**
`tests/acceptance/browser-auth-bootstrap-v1.evidence.md:64–81`, `:141–145` now states successor-digest + deadline binding, the 0059 amendment, barrier-gated HTTP race, `superseded-converged` only (typed rejection fails), and the window-pinned mock registry.

---

### First-round items, not regressed

- **One-shot:** `CommittedAuthOutcome::try_publish` still `take()`s the mutex slot (`coordinator.rs:239–244`).
- **Revocation boundary:** `refresh_credential_response_is_fenced_by_prepublication_revocation` is untouched; a `Revoke` ticket is still outside the allowlist (`coordinator.rs:2849–2860`).
- **Wire-delta snapshotting:** `refreshWireBefore` / `refreshWireAfter` unchanged (`browser-auth-bootstrap-v1.mjs:2058–2093`).
- **Capability offers:** mock still returns `capabilities`; evidence still records Firefox capability/port-retry/profile lifecycle.
- **Header redaction:** same header regex.

---

### NEW findings

1. **SUGGESTION** — `llp/0059-session-projection-and-client-barrier.spec.md:683–691`. The `@ref` target section’s **Bearer rotation** bullet still describes only begin/commit/finalize and never mentions the pending-ticket exception or cut binding. The amendment is accurate; a reader who follows the `@ref` lands on a paragraph that understates it. Not a semantic mismatch in the amendment itself.

2. **SUGGESTION** — `src/auth/coordinator.rs:2790–2805`. The deadline regression only asserts `is_some()` on `finalize_authenticated_use`, not the new expiry (`300 + AUTH_SESSION_SLIDING_WINDOW_MS`). Given current constants the pair does move, and a no-op would fail the later `try_publish` assert. Pinning the returned expiry would make the construction obvious.

Neither is MATERIAL. No new admissible leaf from the widened capture.

---

**VERDICT: READY**
