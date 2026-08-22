---
title: "Recipe: split a sensitive field into its own table"
id: recipes.split-sensitive-fields
order: 16
audience: agent-first
capabilities: [auth.table-visibility]
authorities: [llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0235-field-masking-class-m.spec.md, issues/20260821-0235-field-masking-productization.md, packages/snapback-codegen/define.mjs]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-22
reviewed-authorities-digest: sha256:63d23e482aea60de8c68499c0859b310ae1b231463e358958c6118307eed5e84
---

# Recipe: split a sensitive field into its own table

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this workaround only when most of a row may be visible to a wider audience
but row-level absence of its private half is acceptable to unauthorized
readers. Snapback does not currently provide field masking: it cannot keep one
row visible while conditionally returning one stored field as `null`. If the
public row must remain present with one cell replaced by `null`, as with votes
or tallies, there is no shipped answer. [LLP
0235](repo:llp/0235-field-masking-class-m.spec.md) is the Accepted governing
design, scheduled for implementation after LLP 0294 W6 closes. When row-level
absence is acceptable, the honest supported pattern is to move the sensitive
value to a second table and give that table its own row visibility.

Find this page by: `maskField`, "mask a field", "hide one field",
"mask phone number", "private column", "field level security", or
"column visibility".

## Apply the Messtimate phone-number split

Messtimate needed a consumer-visible record while its phone number stayed
private. Model that record here as a profile split across two tables rather
than as one partially visible record:

| Table | Fields | Visibility |
| --- | --- | --- |
| `profiles` | a stable `profileKey` plus consumer-visible name and status fields | the audience that may see the profile, such as `public-read` or a membership policy |
| `profilePhoneNumbers` | `ownerId`, the same `profileKey`, and `phoneNumber` | `owner` on `ownerId`, or the narrower membership policy that should see the phone row |

Declare a unique index on `profiles.profileKey`. On the private table, declare
an index led by the visibility field, such as
`by_owner_profile: [ownerId, profileKey]`, and make it unique when one phone
record per profile is the product rule. Set `ownerId` from the server-derived
principal; never accept the owner as trusted client input. See
[Protecting data](../auth/protecting-data.md#declare-who-can-read-each-table) for the
supported `public-read`, `owner`, membership, and `anyOf` table policies.

If profile creation requires both records, write them in one mutation so the
public and private halves commit atomically. Table visibility controls reads;
the mutation must still enforce who may create, replace, or delete each half.

The protection comes from row visibility on the second table. On read surfaces
that compose the table policy, an unauthorized reader receives no phone row at
all; Snapback is not masking a field on the public profile row. Search and
vector indexes carry their own visibility and do not inherit the table's
`.visibility(...)` policy. Do not put a public, or otherwise
broader-than-table, search or vector index on the private table. See
[Protecting data](../auth/protecting-data.md#declare-who-can-read-each-table).

## Read the public and private halves

Choose the read shape from the caller's product view:

- For a consumer profile or profile list, query only `profiles`. Its result
  contract must not contain `phoneNumber` or a value derived from it.
- For the signed-in owner's settings screen, query `profilePhoneNumbers` with
  the ordinary caller-bound `ownerId == authUserId()` filter and its
  owner-leading index, then read the matching public profile. Merge the two
  authorized results in the owner-only screen.
- For one server-produced owner-only result, use a bounded
  [`defineRelationalQuery`](../backend/relational-queries.md): make
  `profilePhoneNumbers` the owner-visible root, `profiles` the public or
  appropriately visible joined table, join on the stable unique `profileKey`,
  and declare the output owner-visible. The private table belongs on the root
  side so root access is bounded by the caller's owner-leading index.

Never make the joined output public. Relational output cannot be broader than
either source, and an invisible joined row is treated as absent. If the base
profile must remain visible when the phone row is absent or unauthorized, use
the two-read pattern: a left join whose only owner evidence is on the
omissible private side is deliberately refused.

## Know what this workaround does not protect

This split is row-level authorization, not field-level security or class-M
field masking. In particular, it does not:

- preserve one result-row shape while changing `phoneNumber` between a value
  and `null`;
- protect a phone number left on `profiles`, even if a query projection, JS
  handler, or UI omits it;
- make filters, ordering, indexes, search, aggregates, joins, or handlers over a
  hidden field noninterfering;
- prevent a unique or other constraint over the sensitive field from leaking it
  through success versus refusal, or hide refusal and error codes, public error
  details, public diagnostics, or log text;
- hide public correlation facts such as `hasPhone`, a phone-derived sort key,
  or a public relationship key that the application chose to store;
- suppress client-visible live wake or delivery events, delivery kind,
  invalidation disposition, or delivery timing that could reveal a hidden-value
  change;
- make query or write execution timing constant-time or otherwise
  noninterfering;
- authorize writes, `ctx.db.elevated`, operator/admin access, exports, logs,
  analytics, actions, or external services that receive the value; or
- implement conditional disclosure such as "show the phone after approval"
  without changing which private rows the caller may read.

Accepted [LLP 0235](repo:llp/0235-field-masking-class-m.spec.md) owns the
stronger field-masking design, including logical and physical noninterference.
Acceptance establishes design authority; it does not ship the capability.
Until an implementation proves that contract, keep sensitive bytes out of the
wider table rather than adding projection-only nulling.

## Anti-patterns

- Using this split when unauthorized readers must still receive the public row
  with one field set to `null`; vote and tally shapes need the unshipped class-M
  answer governed by Accepted LLP 0235, not this recipe.
- Keeping `phoneNumber` on `profiles` and removing it in the client, a result
  projection, or a JS handler.
- Giving a search or vector index on `profilePhoneNumbers` public visibility,
  or any visibility broader than the private table policy.
- Fetching the private table with elevated access and deciding in application
  code which callers receive it.
- Publishing the private row or a public joined projection to make the merge
  convenient.
- Treating a missing private row as proof that no phone number exists.
- Claiming the split-table workaround provides field masking or column-level
  noninterference.
