---
title: Promote a generated data operation into your function profile
id: data.promotion
order: 50
audience: agent-first
capabilities: [data.resources-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0254-tiny-ordinary-data-surface.rfc.md, packages/snapback-cli/index.mjs, packages/snapback-cli/data-promotion.test.mjs]
examples: [packages/snapback-cli/data-promotion.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
---

# Promote a generated data operation into your function profile

A generated data resource's create/update/delete operations are enough
until a requirement outgrows the ordinary data path — a multi-row
invariant, a conditional write, a custom conflict policy. **Promotion**
converts one generated standard operation into ordinary custom source in
your application's one selected function profile, keeping the
operation's stable public identity and data where the contracts stay
compatible.

```sh
snapback data promote todos.update --format explicit
```

The command previews a deterministic patch and requires approval before
writing. It emits ordinary source with the generated arguments, result,
authority, reach, refusal, and capability facts frozen; the generated
member is replaced, not duplicated. Because source custody changes, the
executable, bundle, and generation identities rotate; the semantic
identity survives only if the canonical semantic operation is
byte-equal, and any semantic change follows ordinary activation and
migration rules.

Rules that keep promotion safe:

- `--format` must equal your application's selected profile
  (`explicit` for `snapback-explicit-v1`; `familiar` for
  `snapback-familiar-ts-v1`). Promotion never mixes profiles.
- `--format familiar` refuses for owner mutations in v1: their generated
  exact prediction derives from plan-backed IR, which the familiar
  handler grammar cannot preserve. The refusal names the explicit
  alternative.
- Public-read operations, query members, stale generations, dirty
  destinations, and existing exports refuse before anything is written
  (`SNAPBACK_DATA_PROMOTION_REFUSED` names the exact remediation).
- Promotion is one-way in v1: tooling never deletes custom source or
  demotes an operation back to a generated pattern based on inference.
- Already accepted queued intents keep their original generation and
  generated executable through terminal settlement; promotion never
  rewrites them.

Escapes that are not promotions — authority or membership changes,
external effects, jobs, schedules, cross-resource invariants — are
authored directly in your function profile from the start; the
diagnostic on an outgrown data operation points at the smallest valid
scaffold.
