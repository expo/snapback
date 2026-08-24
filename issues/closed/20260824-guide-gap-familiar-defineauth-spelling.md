# guide-gap: no documented Familiar auth spelling; defineAuth unreachable from the generated entrypoint

**Status:** Resolved
**Opened:** 2026-08-24
**Resolved:** 2026-08-24
**Systems:** Familiar TypeScript codegen, Auth, Guide
**Related:** LLP 0253 (function-module grammar disposition 4; schema
`authProgram` disposition 1), LLP 0306 (F3 item 2, chip-away C15),
`issues/20260821-authoring-profile-vertical-contract-fixtures.md`

## Problem

A Familiar application that wants to declare its auth program cannot import
`defineAuth` from its generated server module, and the guide never shows the
supported spelling. The published-0.1.25 Clique Familiar lane logged this as
a Snapback defect and worked around it by source inspection.

Verified on main at `9a782983d` (2026-08-24):

- `renderFamiliarServerModule()` emits a closed export list without
  `defineAuth` (`packages/snapback-codegen/index.mjs:18374-18379`, `.d.ts`
  twin at `:18386`); `@expo/snapback-codegen/familiar` (`familiar.mjs:23-31`)
  and `@expo/snapback/server` omit it too.
- This is deliberate: LLP 0253 places `defineAuth` at disposition 4 in the
  Familiar function-module grammar while the schema-level `authProgram`
  option is disposition 1 (shared verbatim). The *program* is authorable but
  its *constructor* is unreachable from the profile entrypoint.
- First-party fixtures use the workaround the lane had to discover:
  `import { defineAuth } from '@expo/snapback-codegen/define'` beside the
  generated-server imports
  (`tests/fixtures/application-auth/browser-familiar/application/snapback/schema.ts:1-2`).
- `guide/backend/familiar-profile.md` contains zero occurrences of
  `defineAuth` or `authProgram`.
- The open vertical-fixtures ticket's export-authority list deliberately
  excludes `defineAuth`, so entrypoint parity tracking does not cover this
  symbol.

## Wanted

1. **Guide:** document the paved Familiar auth spelling (whatever LLP 0253
   rules it to be) on the Familiar profile page, with retrieval-eval cases
   using the plausible wrong vocabulary ("familiar defineAuth", "auth in
   generated server").
2. **LLP 0253 dated amendment (ruled by LLP 0307 question 4, r2):**
   `defineAuth` is added to the Familiar entrypoint/export authority
   (updating the vertical-fixtures ticket's list), with a vertical
   fixture covering the exported spelling. The export ships from that
   amendment, not from this ticket — this ticket owns only the guide
   documentation half. (The `v.json<T>()` question was split off and
   deferred to the canonical validator owners; it is not part of this
   ticket.)

## Acceptance

- A cold guide retrieval for the wrong spellings above lands on the
  documented recipe.
- A Familiar app declaring an auth program typechecks against the documented
  spelling with no source inspection.
- The vertical-fixtures ticket's export-authority list and LLP 0253's
  disposition table agree with whatever was ruled.

## Resolution

LLP 0253's 2026-08-24 amendment moves `defineAuth` to the shared
schema-module surface at constructor disposition 1 without changing the
Familiar function-module grammar. The codegen adapter, umbrella server, and
generated server runtime/type twins now expose the same canonical constructor.
VCF-F-AUTH1 generates and typechecks an auth program imported from
`./generated/server`, and the Familiar Guide plus retrieval cases 93–94 teach
the paved spelling.
