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

The resource-scoped form uses the same declaration with a required
`resource: "projectId"` field typed as `v.id("projects")`. Query helpers then
take `membershipResource.arg("projectId")` or
`membershipResource.rowField("projectId")`; codegen refuses a different
nominal id target before emitting artifacts.
