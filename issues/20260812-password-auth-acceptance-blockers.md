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
