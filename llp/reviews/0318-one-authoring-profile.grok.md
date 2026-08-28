**Reviewer family:** Grok (xAI)
**Provider / runtime:** grok CLI 1.0.5, `grok-4.6` at xhigh reasoning effort, headless single-turn (`--prompt-file`), full terminal ban carried in the prompt and enforced with `--disallowed-tools bash,shell,terminal,execute`; built-in file reads only.
**Date:** 2026-08-27
**Redacted:** no
**Method:** cli-runner (detached background dispatch, orchestrator polled)

# Snapback simplification batch — Cluster A review artifact — Grok (xAI) family

Lockstep cluster: LLP 0318 (primary) + 0319 + 0320 + 0321 + 0323. This file is the single verbatim
preservation for the cluster in this family; per-target verdicts are
inside the review body. The non-primary targets carry
`.cluster-pointer.md` files pointing here.

## Round 1

- Revision under review: working tree at repository HEAD
  `d49ae32b50fcc1506fe79aee3680cae76eb5c12d`; per-target sha256 recorded
  in [`0318-one-authoring-profile.run.md`](./0318-one-authoring-profile.run.md).
- Capsule: live checkout, read in place. **Structural blindness** with
  respect to this batch — no review artifact for any of the eight targets
  existed anywhere in the tree at launch or during the run. The
  instruction ban on reading `llp/reviews/` is additionally
  **SELF-ATTESTED**, since both runners can read the whole checkout.
- Instruction brief sha256 (common body)
  `1848df190861b08b1d8a041b7131888fe706042de89f0aed861539a11e9e1a82`,
  plus the cluster target list and a runner-specific constraints block.
- Independence: separate process, fresh session, different model family
  from the second reviewer, and different from the orchestrating reviser
  (Claude) which authored the targets and cast no verdict.
- Runtime: dispatched concurrently with the other three round-1 runs; returned at the orchestrator's poll tick.
- Result: **0318 NOT READY (3 MATERIAL), 0319 READY, 0320 NOT READY (4), 0321 NOT READY (4), 0323 NOT READY (2), SET NOT READY.**

### Verbatim review body

I'll review the five Cluster A RFCs as decision-quality sketches, verifying the quantitative and LLP claims against the repo without using the terminal. First I'll load the RFCs and the cited source surfaces.The five RFCs are loaded. Next I’ll verify the constructor/export counts, generated-tree inventory, and the LLP quotes they rest on.Counts on `define.mjs` look close; next I’ll check generated-tree sizes, React exports, published-symbol totals, and the LLP passages the RFCs quote.`artifacts.json` already classifies custody and byte sizes; I’ll use that against 0321’s inventory, then check the LLP quotes and remaining counts.The custody split is already in the generator and gitignore. Next I’ll check the cited LLP passages and whether 0318/0320 actually agree on mutation plans.# Independent review — Cluster A (LLPs 0318, 0319, 0320, 0321, 0323)

Verified against this checkout with file reads only. Constructor/export counts from `packages/snapback-codegen/define.mjs`; generated-tree facts from `demos/todo/snapback/generated/artifacts.json` and `.gitignore`; symbol counts from `guide/reference/published-symbols.json` and `guide/reference/index.md`; LLP quotations from the cited documents.

Counts that **do** check out: `define.mjs` has 140 `export` bindings, 31 `define*` constructors, 13 query flavors as listed; `published-symbols.json` identities are 4,248 (lines 22–4269); registry index reports 1,461 symbols; I counted 56 registry modules; `removedSymbols` is 120. Guide quotations in 0318 §1.2 are exact. Clique table in 0318 §1.1 matches LLP 0310. 0173’s `effectiveTablePolicies` sentence is quoted correctly. 0067 F2a does say delta candidacy admits any HostPlan single-table query with changes.

---

## LLP 0318 — One authoring profile

### MATERIAL — §1.4. The “sharpest ergonomic difference” is the unpaved lane, not the explicit profile.

The RFC presents `source`/`exportName` + `handlers.mjs` + `globalThis.__snapbackHandlers` as what explicit *is*, and says this is “independent of the benchmark.”

That split is documented as **legacy compatibility**. `guide/getting-started/your-first-backend.md:420-485`:

> Before inline handlers landed, the JS style split every definition from its logic… This form remains fully supported — `demos/todo` still uses it — but it is the compatibility lane, not the paved path for new work.
>
> Do not start new JS functions on the bundled `handlers.mjs` split. Inline `handler:` is the paved form.

`JS_QUERY_SPEC_FIELDS` / `JS_MUTATION_SPEC_FIELDS` already admit `handler` (`define.mjs:128-134, 190-195`). The paved explicit form is colocated `defineJsMutation({ handler })`, which is the same shape as familiar `mutation({ handler })` minus names, module namespace, and the profile pin.

§1.3’s two-worlds table still stands. §1.4 does not. A maintainer will throw out the primary ergonomic exhibit as a demo convention the getting-started guide already retired.

**Fix:** Rewrite §1.4 against the paved explicit form. The remaining differences are `query`/`mutation` vs `defineJs*`, `api.<module>.*` vs a `functions.mjs` bag, `useQuery` vs `useSnapback*`, `schema.ts` vs `schema.mjs`, and the `authoringProfile` closed world. If those are not enough, the RFC is weaker than it claims and should say so.

### MATERIAL — §5. Default flip is gated by Accepted LLP 0252 D7 / 0253 S9, not by a second Clique N=1.

0253 S9 (Adopted per LLP 0295): “No default-profile change is made or implied; that decision remains gated on the N≥3 wave (LLP 0252 D7, LLP 0295 R3).”

0252 D7 Promote requires complete rounds across three workload families, semantic-quality noninferiority, **and** “paired familiar/explicit evidence at N≥3 from at least one second model family.” Merge (the closer disposition to “one canonical profile”) requires component-level ablation, not another Clique cell.

0318 Related lists 0252. §5 step 2 is “rerun the Clique matrix” — still one workload, no second family, no 0252 disposition. The RFC’s own §1.1 correctly refuses to let N=1 license “familiar is better,” then sequences a default flip on a second N=1 of the same matrix.

**Fix:** Name 0252 D7 as a standing constraint. Either this RFC amends that gate, or §5 cannot include “flip the default.” Convergence-as-Merge (move measured wins into one profile, keep explicit as compatibility without flipping default) is the disposition 0252 already defined for this move.

### MATERIAL — §3 vs LLP 0320. Mutation plans cannot both be preserved capability and a retired authored dialect.

0318 §3: “Mutation plans, `defineRoutes`, `defineCron`, search/vector queries, and the analyzable HostPlan subset are capability, not profile. They must survive the convergence with a familiar-profile spelling. If they cannot, this RFC is wrong and should be withdrawn.”

OQ1 repeats that as load-bearing. Related does **not** list 0320.

0320 §3: authors write JavaScript only; IR constructors leave `define.mjs`. `packages/snapback-codegen/familiar.mjs` currently exports none of `mutationPlan` / `defineRoutes` / `defineCron` / `defineSearchQuery`.

If 0320 is adopted, 0318’s withdrawal condition on mutation-plan spelling is tripped unless 0318 means “the engine still runs HostPlan,” which is not what “familiar-profile spelling” says. These were written as a set. They do not agree on whether mutation plans remain an authored surface.

**Fix:** 0318 must take a position on 0320: (a) 0320 is out of scope and mutation-plan spelling is still required, (b) 0320 wins and OQ1’s mutation-plan clause is struck, or (c) the 0320 OQ4 fallback (keep `table`/`filter`/`order`/`index` sugar, retire the expression constructors) is the 0318 spelling. Silence is a contradiction.

### minor — OQ4. Not every fixture is explicit-profile.

`tests/fixtures/familiar-todo`, `familiar-vdoc-vertical`, `tests/acceptance/fixtures/familiar-video-asset`, and others pin `authoringProfile: "snapback-familiar-ts-v1"`. Demos and shipped templates I checked are explicit. The migration is still wide; the “all explicit” sentence is false and hides the familiar fixtures that would be the conversion goldens.

---

## LLP 0319 — One query constructor

Inventory holds. 13 query flavors, 18 remaining `define*` names, 31 total. `QUERY_SPEC_FIELDS` / `JS_QUERY_SPEC_FIELDS` / `MUTATION_SPEC_FIELDS` / `JS_MUTATION_SPEC_FIELDS` / `ACTION_SPEC_FIELDS` exist as claimed.

The axis table is a useful reading, not a literal cross product (`defineLiveSearchQuery` exists; there is no live-vector constructor). OQ2/OQ3 already own the live-flag and snapshot-batch problems. `defineSearchQuery`’s `table` is a `defineTable(...)` object (`define.mjs:2681-2682`); `defineQuery`’s `table` is a string. `index` means btree vs search vs vector. That is exactly OQ1. For a sketch that tags the merge as `[inferred]` and refuses to cost it until the field sets are checked, it is not a defective decision.

`defineSnapshotBatchQuery` takes 2–8 already-built `defineBoundedChildrenQuery` / `defineRelationalQuery` **results** (`define.mjs:3519-3542`). A `via` member cannot be a flat access-shape tag without a composition story. OQ3 flags the misfit. Keep it there; do not pretend the sketched `via` object covers it.

### minor — §3 rule 4. `defineWriteWithActivity` is not a mutation implementation-axis variant.

Its required fields are `scope` / `primary` / `relations` / `source` / `activity` / `idempotency` (`define.mjs:5065-5073`), a closed LLP 0110 pattern. The RFC’s own §4 escape hatch (“genuine second concept keeps its constructor”) applies. Rule 4 should use that hatch instead of “becoming an option.”

### minor — §4. “Most of the 140 are the expression IR … and the `is*Def` predicates.”

Expression constructors in 0320’s list are ~46. Mutation-plan constructors ~19. `is*Def` predicates are 13, not “~20.” Together ~78/140. Not “most” unless the mutation-plan dialect is counted as IR, in which case say that.

No unresolved MATERIAL.

---

## LLP 0320 — Plan IR as compiler output

### MATERIAL — §2. LLP 0035 is misread. DK-4 did not retire the performance reason for HostPlan.

The RFC: M1 “drove docket DK-4 to the conclusion that fan-out cost was VM-bound”; “DK-3 deliberately chose whole-document replace *because* the cost was VM-bound rather than delta-shaped”; “The performance gap the IR was partly justified by is the gap DK-4 closed by other means.”

LLP 0035 after warm VM (`llp/0035-local-target-benchmarks.research.md:203-208`):

> **Fan-out is no longer VM-bound; it is row-bound.** At ~2 ms per affected subscriber the remaining cost is re-running the query against a growing result set and re-serializing all rows — exactly the whole-document `replace` shape DK-3 pinned for v1. This is the measured hand-off from DK-4 to the DK-3 revisit trigger (op-log deltas), not a residual VM problem.

M3 then says the revisit trigger is **armed**. `live_delta` is HostPlan-only, no re-query, no VM (`llp/0008-local-first-sync-and-realtime.rfc.md:306-316`; `llp/0209-live-graph-profile.spec.md:2729-2731`). JS handlers, warm VM or not, stay on re-query + `live_replace`. 0173 reports HostPlan predicates as structured and JavaScript as `opaque` (`llp/0173-authorization-review-projection.rfc.md:139-142`).

DK-4 closed fresh-VM-per-invoke. It did not close the reason HostPlan exists. OQ2 proposing to “re-run the LLP 0035 M1 fan-out measurement” asks for a measurement 0035 M3 already published.

**Fix:** Strike the “DK-4 closed the gap” paragraph. State: native HostPlan is still the `live_delta` / IVM / 0173-static path; lifting is load-bearing for those, not an authoring convenience on top of a solved VM problem. OQ2 should start from M3, not from pre-DK-4 M1.

### MATERIAL — §7. LLP 0127 is cited for the opposite aesthetic.

0127: every Convex advantage is “convenience made invisible — **inferred types**, silent retries, ambient reactivity”; Snapback’s answer is “a **declared contract instead of an inferred one**.”

0320’s mechanism is a conservative analyzer that **infers** HostPlan from JavaScript. Generate-time receipts address “visible convenience.” They do not make the contract declared. Using 0127’s “declared not inferred” sentence to bless a lifting compiler is the same class of prior-art misuse this brief flags.

**Fix:** Cite 0127 for receipts/visibility only. Do not claim this RFC “keeps the declaration.” If the RFC wants declared analyzability, the 0320 OQ4 fallback (keep the `table`/`filter`/`order`/`index` form) is the 0127-compatible slice.

### MATERIAL — §5 OQ1. Lift-rate on `defineJs*` is a biased test of the RFC’s success criterion.

`defineJsQuery` / `defineJsMutation` are the functions authors already did **not** write as HostPlan. `define.mjs:4913-4915` still says HostPlan “stays available for deterministic fixture coverage.” Measuring lift rate on that population cannot tell you whether retiring authored HostPlan preserves today’s HostPlan population (`defineQuery({ table, filter, … })`, `mutationPlan(...)`, `editTitle` in `demos/todo/snapback/functions.mjs:62-66`).

If those do not round-trip through JS→lift, you lose `live_delta` candidacy and 0173 static predicates on the queries that have them today. “False negative costs a VM invocation, which is the status quo” is true of current JS handlers and **false** of current HostPlan functions.

**Fix:** OQ1’s corpus is every authored HostPlan in `demos/` and `tests/fixtures/` rewritten as JS, plus the JS handlers. If the HostPlan corpus does not lift, 0320 as written is dead and only the OQ4 fallback remains.

### MATERIAL — Cross-document. Same mutation-plan contradiction as 0318.

0320 OQ5 says neither RFC blocks the other. 0318 §3 says the RFC is withdrawn if mutation plans have no familiar spelling. Those cannot both be true. 0320 Related lists 0318; 0318 Related does not list 0320.

---

## LLP 0321 — Split the generated directory

### MATERIAL — §1. The inventory is not the generated graph, and “two files an application imports” is false.

`demos/todo/snapback/generated/artifacts.json` `summary.counts.custody.total` is **51**, not 22. Custody split already recorded: `consumerCommitted: 9`, `regenerableCache: 41`, `reviewManifest: 1`.

Byte fields that match the RFC exactly are the **consumer-committed governance files** (authorization-review 18,539; functions.manifest 23,706; schema.manifest 2,169; the seven baseline/ledger files). Regenerable bytes do not match:

| File | RFC | `artifacts.json` |
|---|---:|---:|
| `api.d.ts` | 12,240 | 22,886 |
| `api.mjs` | 6,438 | 1,403 |
| `capability.manifest.json` | 10,617 | 16,319 |
| `api-envelope.members.json` | 4,538 | 9,217 |
| `package.json` | 523 | 849 |
| `contract-data.manifest.json` | 10,717 | 11,092 |
| `provider-introspection.json` | 13,937 | 14,382 |

RFC “api.mjs + api.d.ts = 18.7 KB, what an application imports.” Actual those two: 24.3 KB. Also `consumer: client-bundler`: `api.d.mts` (22,886), `app.mjs`, `app.d.ts`, `app.d.mts`, `app.binding.mjs`. Omitted from the table: `normalized-definition.v1.json`, both client-lifecycle files, both handler-profile files, hashed `app.descriptor` / `app.binding` copies.

The canonical todo **does** import more than `api.mjs`/`api.d.ts`:

```7:15:demos/todo/surfaces/contract/main.ts
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
// ...
} from '../../snapback/generated/contract/runtime-links';
```

`packages/snapback-cli/templates/expo-chat/acceptance.mjs` imports `generated/api.mjs` **and** `generated/artifacts.json`. `crates/snapback/examples/embedded_todo.rs` and `crates/snapback/tests/embeddable_library_v0.rs` `include_bytes!` `demos/todo/snapback/generated/functions.manifest.json`.

Rule 1 (“if no `import` in the app resolves it, it is not in `generated/`”) puts `functions.manifest.json`, `schema.manifest.json`, `contract-data.manifest.json`, and `artifacts.json` **in** `generated/`. The tier sketch puts all four in ledger/ or gitignored build/. The rule and the sketch contradict. The “application-facing is two files” claim is what decides membership. It is wrong.

**Fix:** Rebuild §1 from `artifacts.json` `files[]` (`path`, `bytes`, `consumer`, `custody`). Define “application” as every in-repo importer (React, Contract, acceptance, `include_bytes`, server load), not the React todo UI.

### MATERIAL — §2. The three-tier split already exists. The sketch puts runtime-load inputs on the wrong side of gitignore.

`.gitignore` already ignores `demos/*/snapback/generated/*` and un-ignores the consumer-committed set (artifacts.json, authorization-review, the seven baselines/ledgers) plus, for todo, `functions.manifest.json` and `schema.manifest.json`.

`artifacts.json` already binds sha256 of every artifact and is the review-manifest. Rule 2’s “one custody digest” is not a new design. It is a move of a file that already does this.

The sketch then places `functions.manifest.json` and `schema.manifest.json` in `.snapback/build/` (“Gitignored. Regenerated.”). Those two are `custody: consumer-committed`, `consumer: snapback-runtime` in the same `artifacts.json` the RFC is summarizing. OQ3 asks whether the server load path cares. The custody field, the gitignore un-ignore, the Contract imports, and the Rust `include_bytes!` are the answer. Putting them in gitignored `build/` is a defective default, not an open question.

**Fix:** Treat current `custody` as the partition. `generated/` = what must resolve at runtime or from application imports (`consumer-committed` + `client-bundler` + contract runtime-links). Ledger = review/baselines (already committed). `build/` = `regenerable-cache` only. Do not relitigate functions/schema manifests as gitignore candidates.

### MATERIAL — §2. “Reuses `.snapback/` authors already ignore” is false for a committed ledger.

`artifacts.json` cache path is `../../.snapback/codegen-cache/...` relative to `generated/` → **app-root** `.snapback/`, not `snapback/.snapback/`. `.gitignore` has `/.snapback/` (repo root) and `**/.snapback/codegen-cache/`. A committed `snapback/.snapback/ledger/` is a new directory. You cannot reuse an ignored cache tree for committed review artifacts without a gitignore fight.

Getting-started already says do not edit `.snapback/codegen-cache/`. Putting a committed ledger next to a gitignored cache under one name is how those files get dropped from PRs.

**Fix:** Either app-root `.snapback/ledger/` with an explicit **not**-ignored rule, or a non-dot name (`snapback/review/`). Do not nest committed files under a directory whose existing meaning is “cache, ignore.”

### MATERIAL — OQ5 / generated membership vs 0318.

0253 S2 rule 7: Familiar “adds `server.{mjs,d.ts}` and the familiar-shaped `api.{mjs,d.ts}`.” Familiar apps import `./generated/server` (`tests/fixtures/familiar-todo/schema.ts:1`, `todos.ts:1`). 0318 makes that the surviving profile. 0321’s application-facing `generated/` is `api.mjs` / `api.d.ts` / `package.json` / optional contract links — explicit-profile, no `server.*`.

OQ5 says familiar has “the same `generated/` graph.” It does not.

**Fix:** If 0321 follows 0318, `generated/server.{mjs,d.ts}` is in the application tier. If 0321 precedes 0318, the split is done twice. Pick one in the body, not only in OQ5.

### minor — “Five-function todo.” `artifacts.json` lists six operations (`listTodos`, `listTodosOnce`, `createTodo`, `setCompleted`, `editTitle`, `deleteTodo`).

### minor — “The three-file claim becomes true.” After the split an author still has `codegen.policy.json` and, in this demo, `visibility-override-owners.json` and (until 0318) `handlers.mjs`. Directory hygiene is real. The three-file slogan is still marketing.

---

## LLP 0323 — A tiered public surface

4,248 identities, 1,461 symbols, 56 modules, 120 `removedSymbols` verified. Client `exports` has on the order of 40 subpaths. `expo-snapback-client.md` is 12,531 lines; ~501 KB is plausible. React hook list is 25 names including `useSnapbackProviderClient`, which is **not** a package export (`index.mjs` / `core.mjs` omit it; `implementation.mjs` and `familiar.mjs` use it internally). Public root hooks are 24; familiar adds `useQuery` / `useMutation` / `useAction` plus `useAuth` / `useCurrentPrincipal` / `useQueryState`. “28 hooks” is close, not exact.

### MATERIAL — §2 vs §3 vs LLP 0314.001 §2c. Byte reduction and “nothing is unpublished” cannot both be the proposal.

0314.001 §2c: `registry.json` is 5.16 MB for 1,461 symbols; “LLP 0323 (fewer published symbols) [is] the real reduction, and this RFC defers to them.”

0323 §1 cites that deferral for “~1 MB off the shipped corpus.”

0323 §3: “Every one of the 4,248 identities stays reachable. Tiering is about the default import and the first page of the reference.”

Splitting `expo-snapback-client.md` (501 KB) does not remove ~1 MB. `registry.json` is the megabyte-scale object. Shrinking it requires dropping identities from the published reference. Keeping all 4,248 reachable **and** in `published-symbols.json` does not do what 0314.001 deferred.

**Fix:** Choose. (A) `/internal` leaves `published-symbols.json` and `registry.json`; drop the 1 MB claim and amend 0314.001’s “fewer published symbols.” (B) `/internal` is unpublished; amend §3; then 0314.001 §2c is this RFC. The present text is both.

### MATERIAL — §2. Two definitions of core, and the React “flat surface” already has `./core`.

Rule 1: “A symbol is core iff a shipped template or the canonical benchmark app imports it.”

Sketch core: `SnapbackProvider`, `useQuery`, `useMutation`, `useAction`, `usePresence`, `useAuth`, `useUpload`, `useConnection`.

Shipped `packages/snapback-cli/templates/react/src/App.tsx` imports `useSnapbackAuth`, `useSnapbackConnection`, `useSnapbackCurrentPrincipal`, `useSnapbackMutation`, `useSnapbackQueries` from `@expo/snapback-react`. No `useQuery`, no `useAction`, no `usePresence`, no `useUpload`. `useSnapbackQueries` and `useSnapbackCurrentPrincipal` are in the template and not in the sketch.

OQ1 asks whether the template rule is sane. The body already ships a different set as the proposal.

Separately, the package is not a flat root. `package.json` already exports `.`, `./core`, `./familiar`, `./thumbhash`. `index.mjs:37-40`:

> Full compatibility composition. Query/mutation-only applications can select `@expo/snapback-react/core` and omit this file's optional capability module.

`core.mjs` cites LLP 0145 Option 2: root stays Full, narrow entry is static. 0323’s React diagnosis (“everything a client can do is reachable from a top-level import”) is the **intentional** Full root. The RFC proposes introducing `@expo/snapback-react` as a small core. That is an inversion of the default, not the invention of tiering. A maintainer will say: we already did this; argue why Full-root should become Core-root.

Client is the same shape: ~40 subpaths exist; the root and `guide/reference/expo-snapback-client.md` (341 symbols) are the wall. The RFC’s useful move is reference-per-tier and maybe inverting the default export, not “add subpaths.”

**Fix:** State the actual decision: invert `@expo/snapback-react` default from Full to Core (amend the 0145/index.mjs pin), generate the reference from Core first, and run Rule 1 on the template corpus **before** publishing a core name list. Do not list `usePresence`/`useUpload` as core until a template imports them.

### minor — OQ4. “Partitioning a surface that is about to lose a third of its names.”

0318 removes the familiar hook family. That is 3 public hooks on `./familiar`, not a third of 28. Overstated; does not change “do 0318 first.”

### minor — Missing objection. Subpath exports already exist; the cognitive problem is the generated **root** page and the Full default, not the absence of a tier mechanism.

---

## Cross-document (set-level)

1. **0318 §3 vs 0320 §3** — mutation plans / authored HostPlan must survive vs must stop being authored. 0318 does not Related-link 0320.
2. **0318 surviving profile is familiar (`generated/server`) vs 0321 application `generated/` is explicit `api.mjs`/`api.d.ts`.**
3. **0321 OQ5 “do this after 0318 or fold into 0318” vs 0323 §6 “last of the batch.”** 0323’s last-ness is fine. 0321 cannot both follow 0318 and describe an explicit-only `generated/` tier.
4. **0319 and 0320 compose** on the implementation axis as both claim, **if and only if** 0320’s OQ4 fallback is rejected. If declarative `defineQuery({ table, filter })` survives, 0319’s “axis disappears” sentence is false. Minor if 0320 stays at “JS only.”
5. **0323 §6 last** is the only sequencing statement that survives contact with 0252 D7 (0318 cannot flip default on Clique N=1) and with 0321’s already-shipped custody split (0321 is a layout change on top of existing `custody` fields, not a prerequisite for 0318).

Load-bearing objections the set does not anticipate:

- Explicit’s paved form is already inline `handler:` (0318).
- `artifacts.json` already is the digest and already classifies `consumer`/`custody` (0321).
- `@expo/snapback-react/core` already exists; Full root is a pin, not an accident (0323).
- 0252 D7 / 0253 S9 N≥3 second-family gate on default-profile change (0318).
- HostPlan is the live `live_delta` / 0173-static path after DK-4, not a VM workaround (0320).

---

## Verdicts

```
LLP 0318: NOT READY (3 MATERIAL)
LLP 0319: READY
LLP 0320: NOT READY (4 MATERIAL)
LLP 0321: NOT READY (4 MATERIAL)
LLP 0323: NOT READY (2 MATERIAL)
SET: NOT READY
```
