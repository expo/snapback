# LLP 0321: Split the generated directory

**Type:** RFC
**Status:** Withdrawn
**Systems:** Code generation, Developer experience, Custody, Repository
hygiene, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 3 MATERIAL / grok 4 MATERIAL) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0010, LLP 0012, LLP 0253, LLP 0173, LLP 0259, LLP 0304,
LLP 0318, LLP 0323

## Withdrawal (2026-08-27)

The architecture this RFC proposes already exists.
`demos/todo/snapback/generated/artifacts.json` classifies every artifact
by `custody` and `consumer` — `consumerCommitted: 9`,
`regenerableCache: 41`, `reviewManifest: 1`, total 51 — already binds a
sha256 per artifact, and `guide/getting-started/generated-artifacts.md`
documents the model. "One custody digest" is a file move, not a design.

The inventory was also wrong: "22 files / 260 KB" was `ls` entries and
`du` block allocation; the materialized tree is 38 files / 150,032
logical bytes, and the backend has six operations, not five.

Most seriously, the placement rules would break current consumers. §2
puts `functions.manifest.json` and `schema.manifest.json` in a
gitignored `build/` tier, but both are `consumer-committed`
`snapback-runtime` inputs that `demos/todo/surfaces/contract/main.ts`
imports directly, that `crates/snapback/examples/embedded_todo.rs`
`include_bytes!`s at compile time, and that `scripts/pack-hosted-release.mjs`
requires. Deterministic derivability does not imply a compile-time
consumer can omit the artifact.

Any successor is a materialization-location change over the existing
custody model, not a new custody design.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

`guide/start/mental-model.md` tells an agent "You write three files."
The canonical demo backend, for a five-function todo app, is:

```
snapback/
  schema.mjs  functions.mjs  handlers.mjs  seed.json
  codegen.policy.json  visibility-override-owners.json
  generated/     22 files, 260 KB
```

Most of `generated/` is governance and proof output that the application
never imports. It sits in the author's working directory, in their diffs,
and in their mental model, because it shares a directory with the three
files they do import.

This RFC proposes splitting the generated graph by *consumer*: a small
`snapback/generated/` holding only what application code imports, and a
separate ledger location for the proof, baseline, and review artifacts —
with the digest custody rule binding one manifest rather than twenty-two
files.

Confidence is **0.8**. The split is straightforward; the contested part
is whether the ledger artifacts should stay committed (§4 OQ1).

## 1. The inventory

`demos/todo/snapback/generated/`, for a schema with one table and five
functions:

| File | Bytes | Who consumes it |
|---|---|---|
| `artifacts.json` | 29,843 | codegen custody / `check-inventories` |
| `functions.manifest.json` | 23,706 | server load, contract surface |
| `authorization-review.json` | 18,539 | LLP 0173 review projection |
| `api.d.ts` | 12,240 | **application** |
| `provider-introspection.json` | 13,937 | Contract/Exact provider |
| `contract-data.manifest.json` | 10,717 | Contract surface |
| `capability.manifest.json` | 10,617 | conformance |
| `api.mjs` | 6,438 | **application** |
| `api-envelope.members.json` | 4,538 | codegen |
| `provider-bindings.json` / `.d.ts` | 3,357 / 1,562 | provider wiring |
| `schema.manifest.json` | 2,169 | server load |
| `table-visibility-policy-transition-ledger.json` | 1,653 | governance |
| `table-visibility-policy-baseline.json` | 1,140 | governance |
| `package.json` | 523 | module resolution |
| `visibility-override-owner-baseline.json` | 212 | governance |
| `visibility-governance-quarantine-ledger.json` | 205 | governance |
| `visibility-override-baseline.json` | 178 | governance |
| `elevated-read-site-baseline.json` | 177 | governance |
| `contract/` (12 files) | — | Contract surface |
| `operations/` (6 files) | — | control catalog |

Two files — `api.mjs` and `api.d.ts`, 18.7 KB combined — are what an
application imports. Seven files are visibility/elevation governance
baselines and ledgers, totaling under 4 KB but contributing seven entries
to every `ls` and every review diff.

## 2. Proposal

Three tiers, by consumer:

```
snapback/
  generated/            # application-facing. Small. Committed. Imported.
    api.mjs  api.d.ts  package.json
    contract/runtime-links.*        (when the Contract surface is used)
  .snapback/ledger/     # governance + proof. Committed. Never imported.
    authorization-review.json
    *-baseline.json  *-ledger.json
    capability.manifest.json
  .snapback/build/      # derivable. Gitignored. Regenerated.
    functions.manifest.json  schema.manifest.json
    provider-*.json  contract-data.manifest.json
    api-envelope.members.json
```

Rules:

1. **`generated/` holds only what application source imports.** If no
   `import` in the app resolves it, it is not in `generated/`.
2. **One custody digest.** `artifacts.json` becomes a single manifest in
   `.snapback/ledger/` that binds the content hash of every tier. The
   CLAUDE.md landing rule ("commit `generated/artifacts.json`") becomes
   "commit one digest," and `check-inventories` verifies the chain from
   it. This is the substantive change — the rest is directory movement.
3. **`.snapback/build/` is gitignored** if and only if it is
   deterministically derivable from committed inputs plus a pinned
   toolchain. Anything whose regeneration is not reproducible stays in
   `ledger/`. §4 OQ2 decides the membership.
4. **The three-file claim becomes true.** After the split, a todo backend
   is `schema`, `functions`, `seed.json`, plus a `generated/` an author
   never opens.

`.snapback/` already exists in the demo tree (it holds
`codegen-cache/`), so this reuses a directory authors already ignore
rather than inventing one.

## 3. What this does not do

- **It does not delete governance artifacts.** LLP 0173's authorization
  review, the visibility baselines, and the LLP 0304 agent-safe schema
  posture all depend on those files being present and diffable. They move;
  they do not go away. A reviewer looking for "did visibility change?"
  gets a *better* signal from a dedicated ledger directory than from
  seven files interleaved with build output.
- **It does not change codegen semantics.** Same generator, same content,
  different destinations.
- **It does not relax digest custody.** One digest that binds three tiers
  is not weaker than twenty-two committed files; it is the same guarantee
  with one thing to check. It is stronger against the failure CLAUDE.md
  already warns about — "the generated artifacts chain," where
  regenerating one leaves the next stale — because the chain becomes
  explicit in the manifest rather than implicit across files.
- **It does not address the `_generated/` refusal.** LLP 0253's
  "`_generated/` is a refused alias, not a compatibility alias" stands.

## 4. Open questions

- **OQ1 — Should the ledger tier be committed at all?** Committing it
  makes governance changes reviewable in a PR diff, which is most of its
  value. Not committing it makes the working tree cleaner. Committing is
  the safer default and the one this RFC assumes.
- **OQ2 — Which artifacts are actually deterministically derivable?**
  Decides `build/` membership. Needs a regeneration-determinism check per
  artifact, not an assumption. Any artifact that embeds a timestamp,
  absolute path, or toolchain version is not a `build/` candidate as-is.
- **OQ3 — Does the server load path care where manifests live?**
  `functions.manifest.json` and `schema.manifest.json` are server-load
  inputs. Moving them to a gitignored directory is safe for local dev
  (they are regenerated by `bun run generate`) but must not break a
  deployment path that ships a checkout without running codegen.
- **OQ4 — Migration.** Every demo, template, and fixture has a
  `generated/` tree, and `.gitignore` files and `check-inventories`
  expectations reference the current layout. Mechanical but wide.
- **OQ5 — Interaction with LLP 0318.** Familiar-profile backends have the
  same `generated/` graph. Doing the split before profile convergence
  means doing it twice; doing it after means the convergence migration
  carries a second layout change. Probably: do this one after 0318, or
  fold it into 0318's migration.

## 5. Cost

Low. Directory moves, `.gitignore` updates, one manifest consolidation in
codegen, and a wide-but-mechanical fixture migration. The manifest
consolidation is the only design work.

## 6. Why it matters

The gap between "you write three files" and what an author actually sees
is the first impression of the product, and it is currently a
twenty-two-file directory of JSON they did not ask for and cannot
evaluate. Directory layout is not cosmetic here: it is the mechanism by
which a cold agent under the LLP 0259 read budget decides what is *theirs*
to understand. Everything in `snapback/` reads as theirs.
