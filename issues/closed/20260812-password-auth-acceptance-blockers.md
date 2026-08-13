# Password-auth public acceptance blockers

**Opened:** 2026-08-12 · **Severity:** P0 for stale-password fence; P1 for
remaining launch blockers · **Systems:** Auth, CLI, backup, logical transfer,
admin observability

## Summary

Public-surface acceptance for first-class email+password auth found five
deterministic product blockers plus one missing commissioned projection. These
are not harness substitutions: every reproducer uses the qualified runtime and
the shipped client/CLI/HTTP surfaces.

## Blockers

### 1. Fresh activation selects the wrong immutable identifier mode

`password-auth-definition-of-done.mjs` reads public password-provider
readiness after a fresh sessions activation and observes `username-v1`; the
binding author charter requires `email-v1`. No public schema/startup selector
was found.

Expected: a fresh first-class email+password app activates catalog v4 in
`email-v1`, or the documented app declaration selects it before catalog
creation.

### 2. Stale predecessor password can mint a surviving session

`password-auth-concurrency.mjs` races public signin using the predecessor
password against public password change. The signin can succeed, and a forced
session check afterward remains authenticated.

Expected: if change wins the exact-predecessor fence, stale signin returns the
uniform invalid-credential response with no failure accounting. If signin
linearizes first, the change's user-scoped revocation retires that other
session. A surviving authenticated predecessor-password session is forbidden
on either ordering.

### 3. Password CLI omits required protocol negotiation

`password-auth-cli-stdin.mjs` invokes:

```sh
snapback auth password signup --url <sessions-server> --email <email> --password-stdin
```

The server returns `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (HTTP 400). The
CLI's HTTP projection does not offer the required auth-client protocol header,
so the commissioned stdin-only CLI proof cannot reach signup.

### 4. Physical auth backup fails after graceful shutdown

`password-auth-transfer.mjs` stops the owned server and invokes public
`snapback auth backup`. It fails twice with:

```text
SNAPBACK_AUTH_BACKUP_INVALID: SQLite online backup did not complete
publicationState: Unpublished
```

Expected: format-2 backup publishes and declared restore preserves the password
credential plus physical attempt history.

### 5. Logical export panics on the async-worker blocking guard

`password-auth-logical-transfer.mjs` stops the source server and invokes public
`snapback auth export`. The CLI panics at `src/storage.rs:5717`:

```text
a SQLite version read would block a tokio async worker; route it through the blocking offload helpers (LLP 0032 L7)
```

Expected: catalog-v4 logical export emits the credential-free closed artifact;
import preserves identity facts and excludes attempts and spendable authority.

### 6. Authenticated password-attempt projection is not routed

Storage defines `PasswordAttemptAdminProjection`, but the public server exposes
only `POST /_snapback/api/auth/password/unlock`. Acceptance can prove uniform
public responses and AdminWrite clearing; it cannot observe lock existence,
failure count/threshold, or expiry through the authenticated admin read
projection required by the commission.

## Reproduction

Prime codegen and pin the qualified runtime as documented in
`demos/rbac/README.md`, then run the named scripts. Each blocker exits nonzero
at the exact violated assertion or public command.

## Closure

- All six blockers are repaired or explicitly re-ruled by the author.
- The corresponding witnesses pass without internal database reads, minted
  sessions, admin authority on password signup/signin, or undocumented calls.
- Row 3 gains deterministic proof that the stale refusal charges no failure;
  row 10 observes lock facts only through the authenticated admin projection.

## Resolved (2026-08-12) — all six closed by `a3d3cb645`

Every item is fixed in the product. No acceptance assertion was weakened to
close any of them.

| # | Blocker | Resolution |
|---|---|---|
| 1 | Fresh activation selects `username-v1` | `defineAuth` accepts `identifier: "email"`; codegen maps it to `passwordIdentifierMode: "email-v1"` and activation selects it for a fresh catalog that declares it. Undeclared apps still default to `username-v1`, the mode stays immutable, and a contradiction refuses at codegen with a typed diagnostic. Declarative in the app's auth definition, per the commission's "documented Snapback APIs" bar. |
| 2 | Stale predecessor password could mint a surviving session | Password change prepared its revocation snapshot **before** acquiring the identifier admission stripe, so a racing signin could verify the old generation, insert a session, and commit inside that window — landing outside the planned revocation set. Change now takes the stripe first and re-derives the exact predecessor and affected session set while holding it through commit, leaving exactly two valid linearizations. Pinned by a deterministic (not timing-dependent) regression test. |
| 3 | CLI omitted protocol negotiation | The shared password HTTP helper now sends `x-snapback-auth-client-protocol: 1`, covering all six public verbs. Admin unlock uses the AdminWrite transport and does not need it. No argv or secret handling changed. |
| 4 | Physical auth backup failed after graceful shutdown | On macOS, SQLite's pager cannot write the `/dev/fd/N` alias used for the pinned destination descriptor; small fixtures never crossed enough pages to expose it. Backup now runs into a private in-memory database, scrubs push custody, serializes, and writes/syncs only through the cloned pinned descriptor, reopening read-only to verify — preserving the inode/symlink security contract instead of falling back to pathname writes. Multi-page 1 MiB fixture added. |
| 5 | Logical export panicked on the async-worker guard | Synchronous SQLite export/import/restore ran directly on a Tokio worker (LLP 0032 L7). Routed through the blocking offload helper. That exposed a second defect: fresh activation legitimately seeds `_auth_scope_bases`, and the importer treated any rows there as pre-existing authority; it now admits only exact artifact-matching seeded rows, inserted idempotently. |
| 6 | No authenticated password-attempt projection | AdminRead `passwordAttempt(email)` projection added, exposing lock existence, failed count, threshold, window, and expiry. The lockout witness was **strengthened** to assert the projection, the unlock, and the projection clearing afterward. |

Items 4 and 5 were verified **pre-existing** at merge-base `b92bcd412` and
unchanged by the catalog-v4 work (`b180492e9` vs its parent `884894a58`), so
neither was a regression from this program.

Verified outside the codex sandbox, no `DYLD_FRAMEWORK_PATH`:

- **All ten acceptance rows pass**, each run individually with the qualified
  runtime pinned. Definition-of-done reports `identifierMode: "email-v1"` with
  every exclusion false; concurrency reports four
  `linearized-before-change-then-revoked` races; the CLI reports the stdin
  carrier with both argv assertions and both secret scans passing; lockout
  reports `acceptanceComplete: true`.
- Full library suite: **2631 passed / 0 failed**.
- `module-ownership`, `check-inventories`, `ref-check`, and `guide-check` pass.

One assertion was **corrected** rather than satisfied:
`password-auth-transfer.mjs` byte-compared the HTTP `Date` header across two
Argon2-padded requests seconds apart. That assertion was false — satisfying it
would require emitting incorrect HTTP metadata. It now validates `Date` parses
and compares every other header byte-for-byte, matching what
`password-auth-uniformity.mjs` already did.

Not closed by this work, and tracked separately:
`issues/20260812-latency-kanban-composition-activation-stale.md` — three demos
regressed by the same landing.
