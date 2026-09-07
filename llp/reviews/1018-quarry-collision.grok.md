# LLP 1018 move three — Quarry binding-hygiene lane review (Grok 4.6, xhigh, blind)

**Change:** `s2/clique-quarry-collision` — generated table bindings `<name>$table`, one printing helper, helper-name refusals at the Quarry site. Round 1 reviewed the lane's first commit (cd4cc1d45 pre-rebase; 37731e373 on main); round 2 the effect-name fix (07a18712e pre-rebase; c392dd5a6 on main).
**Implementer:** codex `gpt-5.6-sol` at xhigh (lane), effect-name fix by the orchestrator.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Provenance:** every review below was actually received from the named model; verbatim text per round; the two reviewers never saw each other's reviews.

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | the slice | VERDICT: READY (its minor 1 is the effect-name gap, fixed in round 2; minor 3's `@ref` anchor fixed) |

## Round 1 (verbatim)

## MATERIAL

None.

## MINOR

**1. Effect names that match a generated helper still become opaque TypeScript** — `snapback2/packages/compiler/src/quarry/program.ts:95`

`refuseGeneratedImportCollisions` only walks `programs`. An `effect emit from delivery` (or `range` / `query` / `orderedPair`) still emits:

```ts
import { …, emit, … } from "snapback2";
import { emit } from "./delivery";
```

That is the same duplicate-binding class this commit refuses for operations. Chat ships `effect notify`, so templates are fine; `emit` is a plausible effect name. Same family/site/rewrite treatment as operations would close it.

**2. Helper-collision test never hits `orderedPair`** — `snapback2/packages/compiler/src/quarry-program-checks.ts:106`

The new test covers `query range` and `query notify` against an effect import. `orderedPair` is a third module-scope binding with its own branch (`program.ts:105`) and is untested. The code path is there; the pin is not.

**3. `@ref` points at the Quarry-only amendment, not the hygiene note just added** — `snapback2/packages/compiler/src/quarry/program.ts:122`

The gloss is about TypeScript’s binding namespace. LLP 1004’s 2026-09-07 paragraph is the decision; `#amendment-author-2026-09-02-quarry-only` is the “delete the TS surface” ruling. Valid target, wrong section.

## REFUTED-RISK

**Raw table prints in generated program TypeScript.** Every `db.get` / `scan` / `exists` / `insert` / `update` / `upsert` / `delete` site in `program.ts` goes through `tableBinding`, including walk/recurse (`:363`), member and shape deref (`:517`, `:520`, `:805`, `:808`), point and index reads (`:673`–`:710`, `:975`), merge lanes (they call `emitRead`, `:775`), aggregate `#table` (same `emitRead`), and writes (`:900`, `:916`, `:925`, `:933`, `:958`, `:980`, `:993`, `:1016`). Operation args pass `typeCode(..., tableBinding)` (`:129`), so `t.ref(messages$table)` is the program-module form.

Schema `typeCode` defaulting to identity (`schema.ts:257`, `:276`) is required: schema exports `export var messages = table(...)` and must spell `t.ref(messages)`. Channel args and column refs live in that module (`:42`, `:110`). `rule.exists(messages, …)` (`:169`) is the same local binding. `JSON.stringify(read.table)` on `finalExistsOnInsert` (`:96`) and maintain `source`/`into` strings are engine names, not JS identifiers.

**Downstream identifier-keyed analysis.** `project.ts:651`–`:654` already keys the local alias (`item.name.text`) and looks up by export (`propertyName ?? name`). `lower/expr.ts:720`–`:726`, `type-analysis.ts:681`–`:687`, and `project-api-types.ts:728`–`:735` split only on `.`, so `users$table.byMessage` resolves to owner `users$table` and index `byMessage`; IR uses `TableInfo.name` (`users`), not the alias. The words check map key was updated to `docs$table` (`quarry-words-checks.ts:53`). Provenance `// q:file:line:col` is unchanged (`schema.ts:282`). Cap-sites parse Quarry AST table names (`cap-sites.ts:8`). Where-repair rewrites Quarry text with public `read.table` (`where-repair.ts:69`).

**Helper-name refusal: family, site, rewrite, reachable.** `refuse()` at `program.ts:98`–`:117` throws `E_QUARRY_UNKNOWN` with `program.site` and a rename rewrite. `frontend()` (`quarry/index.ts:223`) sets family `quarry` and guide `quarry/names`. `compileQuarry` emits per program inside try/catch (`index.ts:70`–`:76`), so the throw is collected at the declaration. The new test compiles `query range()` and `effect notify` + `query notify()` and asserts family, `snapback/ops.q:` site, message text, and `rename the` (`quarry-program-checks.ts:106`–`:121`). Parser `RESERVED_BINDINGS` (`parser.ts:29`) is JS keywords only; this list is the snapback2/module-helper set, which is the right split (a local named `range` must remain legal).

**`$` leaking into user-visible names.** Quarry identifiers are `[A-Za-z_][A-Za-z0-9_]*` (`lexer.ts:96`), so authors cannot write `$table`. `api.d.ts` row types use `TableInfo.name` (`project-api-types.ts:117`); operations use `exportName` (`:61`), still `export const ${program.name}`. `t.ref` becomes `"string"` (`:191`). The collision test asserts both `type ReactionsRow` and `readonly reactions: Op<…>` (`quarry-program-checks.ts:62`). Quarry diagnostics interpolate public `expr.table`. Remapped generated-TS errors replace the rewrite with authored Quarry source (`index.ts:109`–`:113`), not the alias.

**Certificate byte-identity.** Plausible from the diff: schema emit is unchanged (identity `typeCode`); program IR table fields come from `TableInfo.name` after alias lookup; merge sites are Quarry `file:line:col`; `q:` markers did not change shape. Chat/todos do not share table/operation names, so only the import spelling of generated TS changes, which is not in the certificate. The diff does not pin frozen certificate bytes; the claim is structural, not independently checked here.

VERDICT: READY
