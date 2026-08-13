# Scoped roles and memberships

This deliberately small sessions app exercises Snapback's public RBAC
authoring path. `appMembers` is the app-singleton form of a membership
declaration: a signed-in non-member may join as themselves, members may read
and post announcements, a member can invite another principal, and that
principal can accept and later leave without learning the private roster row
id. Raw `ctx.db` writes to the roster remain refused.

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

The resource-scoped form uses the same declaration with a required
`resource: "projectId"` field typed as `v.id("projects")`. Query helpers then
take `membershipResource.arg("projectId")` or
`membershipResource.rowField("projectId")`; codegen refuses a different
nominal id target before emitting artifacts.

Not claiming: directly readable roster rows, role hierarchies,
retained/offline membership reads, a password attempt-ledger admin read
projection, deterministic public KDF rendezvous, or hosted/multi-replica RBAC.
