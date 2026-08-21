---
title: "Recipe: private membership and a product roster"
id: recipes.membership-roster-projection
order: 14
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0240-application-authority-profiles.rfc.md, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/snapback/functions.mjs]
examples: [demos/messaging-snapback]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:f8cdd66ec5f4c200d5e8b022f14e1d76730f26bca2df453a3b337acf8e44bdfa
---

# Recipe: private membership and a product roster

Generated membership rows are current authorization state. They are private,
profile-owned backing data, not presentation records and not message history.
When an application needs avatars, handles, join dates, or a visible room
roster, keep a separate ordinary product projection keyed by an authored
resource field.

This is the private membership roster plus product-visible roster projection
pattern: the display roster is current product state, while the send-time
recipient set is historical product state.

Search phrase: send-time recipient set.

The Messaging demo uses this split:

- `conversationMemberships` is the membership declaration and authority
  source;
- `conversationMembers` is an ordinary app table with authored
  `conversationId`, `principal`, and presentation fields;
- child tables such as messages bind membership visibility through their
  authored `conversationId`, not through a private membership-row id.

## Update authority and projection in one mutation

Creation bootstraps the resource membership through the generated declaration
command, then inserts the initial product roster rows in the same mutation.
Join/invite adds the membership and inserts the projection if absent. Leave or
removal changes membership and deletes or marks the current roster row. One
mutation may issue one generated membership command and ordinary application
writes; do not attempt a second membership transition in that mutation.

Promotion or demotion changes the generated membership role in the same
mutation that updates any role-dependent product fields. If the visible roster
does not expose role, the ordinary projection need not change; the acceptance
comparison must still confirm the new authority role. An already-present row
on join and an already-absent row on leave/removal are successful idempotent
branches once the generated membership result agrees with the requested end
state.

The projection is deliberately redundant, so acceptance tests must compare it
with the authority profile after create, join, leave, removal, and retry. Make
the product row unique by `(conversationId, principal)` and make retries
idempotent. Include promotion/demotion in the comparison when the product
mirrors role. Authorization always consults the membership declaration even if
a projection row is stale.

## Keep history separate from the current roster

A current roster answers “who is a member now?” Historical delivery answers
“who received this message when it was sent?” If the product needs the latter,
store a principal snapshot or receipt records at send time in an ordinary
history table. Later joins and leaves must not rewrite old receipts.

In Familiar schema, use authored relational keys such as
`conversationId` for child visibility. Do not copy a `resourceField: "_id"`
example into generated Familiar TypeScript today: the system id is not an
authored schema field in that type surface. Admit access to the root resource
through the authority profile/handler declaration, and bind child rows through
their authored resource key.

## Anti-patterns

- Reading private membership backing rows directly to render the roster.
- Treating the product projection as the authorization source.
- Using a private membership-row id as a public recipient or display id.
- Rewriting historical recipient snapshots when current membership changes.
- Adding multiple membership commands to one mutation.
- Using `resourceField: "_id"` in a Familiar schema declaration that cannot
  typecheck that system field.
