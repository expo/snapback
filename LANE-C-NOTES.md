# Lane C notes

Date: 2026-08-10

No commit was created. The forbidden guide-manifest generator was not run, and
`guide/guide-manifest.generated.json` plus every `guide-flat*.md` file were
left untouched.

## 1. Replication guide surface

**Status:** Complete for the ticket's documentation ask.

**Files changed:**

- `guide/operating/replication.md` (new)
- `guide/index.md`
- `guide/capabilities.md`

**Satisfied:** Added an operator-oriented page grounded in LLP 0188,
`src/replication.rs`, `src/cli.rs`, the G2 drill, and its retained receipt. It
documents the complete `SNAPBACK_REPLICATION_*` environment surface, exact
32-byte key-file custody, segment/keyring posture, restorable-frontier and lag
semantics, `status`, offline `checkpoint`, quarantined `restore`, restored
keyring/declaration use, and the MinIO G2 drill. Added Guide index routing and
an Experimental capability-index row that explicitly makes no capability
manifest, hosted, succession, or G3 claim.

**Left open:** The unshipped LLP 0188 hosted custody, succession, retention,
G3/checkpoint-substitution, and non-MinIO provider qualification remain open
and deliberately unclaimed. I verified the page against code and the retained
G2 receipt, but did not execute the G2 drill: this lane forbids Rust builds and
the drill requires a prepared binary plus MinIO/SQLite tools.

## 2. Same-profile cross-tab presence

**Status:** Complete for the docs half.

**File changed:** `guide/realtime/ephemeral-state.md`.

**Satisfied:** The presence page now says same-profile tabs share the
leader-owned connection, can receive the same connection-owned `selfKey`, and
therefore are not an honest two-device/independent-presence proof. It recommends
isolated browser profiles/contexts, separate browser instances, or real
devices.

**Left open:** A per-tab identity option or clearer product refusal remains an
open product choice; no per-tab identity implementation was attempted. The
boundary was verified against the shared-leader/client semantics and ticket
evidence, not re-run in a browser in this lane.

## 3. Offline image bytes

**Status:** Complete for the docs half.

**File changed:** `guide/sync/offline-and-retention.md`.

**Satisfied:** The offline page now distinguishes retained row text/asset
references from non-retained rendition bytes and explains the cold-offline
placeholder/retry behavior. It gives the only honest workaround: an
application-owned bounded byte cache when policy permits, with app-owned
expiry, quota, logout wipe, and revocation behavior.

**Left open:** First-party opt-in rendition retention remains product work.
Snapback still makes no privacy- or revocation-aware image-byte-cache claim. I
verified the boundary in `packages/snapback-client/assets.mjs`; I did not run a
native/browser cold-start image proof.

## 4. Retention flush and production-export pruning

**Status:** Already satisfied in the current worktree; preserved and verified.

**File reviewed (also changed for items 3, 6, and 7):**
`guide/sync/offline-and-retention.md`.

**Satisfied:** Before this lane's edit, the page already documented the exact
trailing 1-second persist debounce, 10-second maximum delay, absence of a
public flush-now call, hide/pagehide forced flush, and Node wait workaround. It
also already documented `NODE_ENV === 'production'` pruning the supervised
Expo origin lane, the resulting `SNAPBACK_APP_BINDING_UNAVAILABLE`, and the
development-condition/explicit-binding proof alternatives. I verified these
claims against `packages/snapback-client/index.mjs` and
`packages/snapback-expo/supervised-environment.mjs`; no duplicative paragraph
was added.

**Left open:** A public `flush()` affordance and a non-HMR static dev-export
proof lane remain open product work.

## 5. Tunnelled loopback profile

**Status:** Direction 1 complete.

**File changed:** `guide/auth/targets.md`.

**Satisfied:** The serving/profile posture page now says a tunnelled loopback
server remains bind-derived development, names ngrok/Cloudflare
Tunnel/Tailscale Funnel/SSH, labels public exposure unsupported, and states
that `SNAPBACK_PROFILE=prod` is not a repair and may fail closed by refusing
needed local operations.

**Left open:** Direction 2 (an explicit exposure declaration) and direction 3
(narrowing loopback's default authority) remain open. The bind/profile claim
was verified against `src/admin.rs` and LLP 0060 D1. As the ticket itself
notes, I did not retain an end-to-end live-tunnel receipt.

## 6. Clique review minors

**Status:** Five requested fix-forwards complete; the timed compatibility
alias item intentionally skipped.

**Files changed:**

- `llp/0208-clique-pilot-gap-closure.plan.md`
- `packages/snapback-client/index.mjs`
- `packages/snapback-client/package.test.mjs`
- `llp/0131-structured-argument-contracts.spec.md`
- `guide/backend/text-search.md`
- `packages/snapback-react/index.mjs`
- `packages/snapback-react/offline.test.mjs`
- `guide/clients/react.md`
- `guide/sync/offline-and-retention.md`
- regenerated `guide/reference/diagnostics-registry.json`,
  `guide/reference/diagnostics.md`, `guide/reference/registry.json`, and the
  affected `guide/reference/*.md` API projections

**Satisfied:**

1. Corrected the three LLP 0208 ticket links to `issues/closed/`.
2. A pre-witness generated search reference now refuses with the explicit
   “predates the request witness; regenerate the app references” migration
   hint, with a package regression proving refusal before I/O.
3. Documented in LLP 0131 and the text-search guide that a `resourceArg` named
   `userId` owns that option slot and cannot also carry dev per-call auth; use
   session/coordinator custody or rename and regenerate. The LLP also records
   the corresponding reserved-slot behavior for `readSet` and
   `authorityCapture`.
4. Reworded the React queue warning so bounded diagnostic eviction plus other
   pending work cannot falsely claim that the named mutation is still the
   blocking head. The regression uses a different remaining pending record and
   asserts the false wording is absent.
5. Clarified on the React guide page that every rejected mutation attempt,
   including `SNAPBACK_REACT_MUTATION_QUEUED`, removes its built-in optimistic
   layer even though app-owned pending presentation should remain.

**Intentionally skipped/open:** The inaccurate
`expectedArgsContractHash`/`carriedArgsContractHash` compatibility-alias rename
has the ticket's “after one release” timing caveat and was explicitly excluded
by `LANE-PROMPT.md`. I also assessed the related pre-existing
`useSnapbackQueries` follow-up: it still memoizes descriptors on the `entries`
object identity (`[provider, entries]`), unlike `useSnapbackQuery`'s canonical
content key. Content-key treatment for group entries remains an outside-scope
follow-up; no unrequested behavior change was made.

## 7. Session mint HTTP shape and persisted receipt

**Status:** Mint-docs half complete; scaffold env auto-write untouched.

**Files changed:**

- `guide/auth/sessions-and-principals.md`
- `guide/sync/offline-and-retention.md`

**Satisfied:** Documented the paved
`snapback session mint --email ... --ready-file ...` command and the exact
`POST /_snapback/api/host-ops` request for `auth.mintSession`, including both
required authority headers, request body, host-ops envelope/data fields,
settled-sessions/non-production boundary, and trusted-server custody. Added the
offline cold-boot branch where a byte-identical generated manifest plus a
transport-provenance connectivity failure yields a ready binding with
`binding.source === 'persisted-receipt'`; the guide now tells apps to render
their offline presentation rather than manufacture or reject that state.

**Left open:** Scaffold/client-environment auto-write belongs to the other lane
and was not touched. The request/response shapes were verified against
`src/cli.rs`, `src/host_ops.rs`, and auth wire serialization; the persisted
branch was verified against `packages/snapback-client/react-binding.mjs`. I did
not issue a live mint because this lane had no already-running settled sessions
server and forbids building one.

## Verification

Passed:

- `volta run --node 24.18.0 node packages/snapback-client/package.test.mjs`
- `volta run --node 24.18.0 node packages/snapback-react/offline.test.mjs`
- `volta run --node 24.18.0 node scripts/generate-diagnostics-registry.mjs`
- `volta run --node 24.18.0 node scripts/generate-symbol-registry.mjs`
- `./ref-check --verbose` — 225 LLP docs, 4,724 refs, zero errors/unchecked
- `git diff --check`

`volta run --node 24.18.0 node scripts/check-guide.mjs` validates the changed
page metadata/snippets/routes and the capability page is within its byte
budget. The complete command remains red only because this worktree lacks the
pre-existing generated demo sources named by
`guide/backend/trusted-runtime-values.md` and
`guide/clients/contract-adapter.md`, and because the guide manifest/flat files
are stale after these edits. Per `LANE-PROMPT.md`, I did not materialize the
demo artifacts, run `scripts/generate-guide-manifest.mjs`, or touch the
manifest/flats; the orchestrator owns that regeneration at landing.
