# Scoped roles and memberships

This deliberately small sessions app exercises Snapback's public RBAC
authoring path. Resource-scoped `appMembers` is both the product roster and
the authority relation for each application. Its `authorityProfile()` drives
the generated roster and role reads, invite/join/leave/change/remove and owner
transfer mutations, ordinary announcement visibility, and the
`search_announcements` membership partition. Raw `ctx.db` writes and private
roster row ids remain refused.

Run the generated, real-server proof:

```sh
node packages/snapback-codegen/index.mjs demos/rbac/snapback
node demos/rbac/tests/acceptance/rbac.mjs
```

The same protected live-query backend now hosts the first-class password-auth
acceptance witnesses. Prime codegen once, pin the qualified runtime, and run
the rows independently so a security failure cannot be hidden by later rows:

```sh
node packages/snapback-codegen/index.mjs demos/rbac/snapback
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-uniformity.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-concurrency.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-change-consequences.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-packaged-client.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-cli-stdin.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-recovery.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-transfer.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-logical-transfer.mjs
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback volta run --node 24.18.0 node demos/rbac/tests/acceptance/password-auth-lockout-wire.mjs
```

`password-auth-definition-of-done.mjs` is deliberately registered as a
failing precondition witness until fresh public sessions activation selects
the chartered `email-v1` identifier mode. The concurrency witness also fails
if the stale-predecessor fence admits an old-password session. The lockout
witness does not claim the missing authenticated lock-state read projection;
it proves the uniform public wire and AdminWrite unlock only.

The acceptance proves member roster/list/search/post behavior, byte-identical
outsider search pages, transition receipts, owner transfer, and revocation
blanking without a mirrored seat table. The resource field is nominally typed
as `v.id('applications')`; handler admission and search both require that exact
scope type before artifacts are emitted.

Not claiming: generic roster reads, dedicated React/Expo profile hooks,
retained/offline membership or search reads, profile-backed asset sharing, a
password attempt-ledger admin read projection, deterministic public KDF
rendezvous, or hosted/multi-replica RBAC.
