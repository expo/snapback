# LLP 0259: Re-budget the agent first-read contract

**Type:** RFC
**Status:** Review
**Systems:** Docs, Developer experience, Tooling, Templates, Guide, Packaging
**Author:** Charlie Cheever / Grok
**Date:** 2026-08-15
**Revised:** 2026-08-16 (r3 — UNREVIEWED in-delta fix after the r2 delta
round. Both families: NOT READY, PRE-EXISTING MATERIAL: no. Closes
claude C1 and codex M1–M4: pinned steering-byte ceiling and accounting;
landing escalation uses existing `snapback guide` + one named page;
`GuideFragmentV1` specified and gated separately; all five templates
have a pointer-safe route; published README + docs-site `/llms.txt` +
CLI channels added. See Revision history.)
**Revised:** 2026-08-15 (r2 — UNREVIEWED orchestrator revision after one
authorized dual-family round; claude NOT READY / 3 MATERIAL, codex NOT
READY / 5 MATERIAL. Incorporates both families' MATERIAL repairs and
author-authorized co-author ideas: template start packets, served-funnel
repointing, carrier-byte budgets, trap reconciliation, 0252 Promote
authority. 583 lines vs r1 438 = +33.1%; over the ~20% guideline,
disclosed, author-authorized this round.)
**Revised:** 2026-08-15 (r1 — Draft → Review at `/llp-super-refine` loop
start, the one authorized transition)
**Related:** LLP 0041 (publish-rapidly; diet is unpublished until a
qualified closure), LLP 0061 (guide corpus, served funnel, first-read
steering), LLP 0186 (W2 context-injection artifacts), LLP 0187
(discoverability routing; template "capability index first" rule), LLP
0146, LLP 0178, LLP 0193 (errors-as-docs; generated refusal projections),
LLP 0194, LLP 0195 (public / npm docs surface), LLP 0196, LLP 0198, LLP
0203 (P1: generated or gated, never transcribed), LLP 0252 (Familiar
default / Promote disposition), LLP 0253 (Familiar v1 API; Draft), LLP
0254 / LLP 0255 / LLP 0256 (tiny-data)

## Summary

The Snapback Guide already solved the 2026-08-05 problem: a cold agent could
not *find* relational queries, presence, or the admin console. The 2026-08-15
problem is the opposite. Agents now **over-read**, then **explore every
official-looking authoring surface**, then **debug closure and tooling seams**
that more prose will not cheapen.

This RFC re-budgets the first-read contract those earlier programs installed.
It does not replace the capability index, the honesty machinery, or the
CI-checked snippets. It changes what a cold *app-building* agent is required
to load before writing a table.

The default first read is no longer "skill + catalog + capability index + a
40–55 KiB feature page." It is a **template-specific start packet** — a
physically bounded, digest-checked artifact served through the same CLI /
HTTP / MCP / scaffold channels — plus progressive, trigger-gated
escalation. Experimental surfaces stay out of that packet. This RFC never
makes Familiar the default; only an author-recorded Promote disposition
under LLP 0252 §D7 can do that.

The governing cost claim is unchanged from LLP 0186: Snapback should be the
cheapest backend for a coding agent, measured in wall-clock and tokens. The
skill, `/llms.txt`, Rosetta, and scaffold `AGENTS.md` shipped. Then the
corpus kept growing, and the first-read contract was never re-budgeted.

## Why this is a new LLP

LLP 0186 already owns agent-authoring efficiency and the external
context-injection artifacts. LLP 0187 already owns in-corpus routing and the
scaffold line "check the capability index first." LLP 0061 already owns the
guide, the capability index, and the served funnel (`/llms.txt`, instance
home, MCP resources). LLP 0207 was a second efficiency plan and was
withdrawn.

Amending those documents would bury a new diagnosis inside accepted August
programs whose W2/T4 artifacts *are the current bottleneck*. This RFC is
the successor: it cites them as authorities, proposes concrete amendments
to their first-read language, and leaves their completeness, GAP, and
retrieval-eval machinery in place.

Do not extend this RFC into a sixth coordination program. The work is a
small set of entry-path edits, one generated start-packet projection, and a
short list of generate-time product fixes that already have tickets.

## Motivation

### The measured gap moved

LLP 0186's 2026-08-05 paired bakeoffs put a WhatsApp-shaped brief through
Snapback and Convex at **26m03s vs 11m15s**, and attributed the loss to
pre-product plumbing, misleading diagnostics, and shipped-but-undiscovered
capability. Those were the right targets. Most of that wave's cheap repairs
landed.

Diary 0078 (2026-08-13 Clique familiar-vs-Convex pilot) is the current
cost picture on the Familiar / source-closure path:

| Lane | Wall-clock | Output + reasoning tokens | Outcome |
| --- | --- | --- | --- |
| Convex (Grok) | 2,705s | ~223k | M1–M3 green |
| Snapback Familiar (Grok) | 10,098s | ~424k | M3 choreography still red |
| Convex (Sol M1) | 1,213s | — | green |
| Snapback (Sol M1) | 3,308s | — | green |
| Then M2 | essentially tied | — | both green |

Once the app was live, Snapback feature work was already Convex-like. Sol's
M2 being a tie is the tell. The tax is **boot, surface choice, and page
size**, not missing conceptual coverage. Diary 0078's own judgment: the
highest-leverage next step is not more syntax.

Diary 0083 (2026-08-14 Clique **explicit** lane — the surface this RFC
keeps as default) strengthens that split. Sol's M1–M3 went green in
1,871s / 1,414s / 675s. The served guide "saved substantial time." Residual
tax was product seams: Expo admission rejecting a generated
`authoringProfile` descriptor key, supervised binding not reminting after
a function-digest change, and optional authorized-lease offers causing
ordinary live-query rejection. That is evidence for "keep explicit as the
default and stop advertising a second backend," not for more Conceptual
pages.

### What a cold agent is told to load

A cold app-building agent is currently instructed, by the published
authoring skill, every `snapback new` `AGENTS.md`, `guide/index.md`, and
LLP 0187 T4, to:

1. Read the skill (~14 KiB, the whole file).
2. Read `guide/index.md` (~24 KiB, a full catalog).
3. **Read the entire capability index** (~58 KiB, ~120 data rows).
4. Then open "the relevant page," which is often 20–55 KiB.

The *served* npm funnel repeats the same stack. `GET /llms.txt` currently
opens with a "Read first — one-request entry tier" whose first item is the
capability index; the instance home advertises the bulk flat. Template
`AGENTS.md` files send the agent to
`/_snapback/guide/capabilities.md`. `packages/snapback-cli/package.test.mjs`
hard-asserts the literal phrase "capability index first."

That first-read stack is already about **100 KiB** before the agent writes a
table. Representative page sizes on 2026-08-15:

| File | Bytes | What an app-building agent usually needed |
| --- | --- | --- |
| `guide/capabilities.md` | 58,367 | "Does X exist?" — a lookup, not a read |
| `guide/clients/react-expo.md` | 55,015 | provider + hook + `snapback dev --expo` |
| `guide/backend/assets.md` | 58,029 | ImagePicker → upload → `v.assetRef` |
| `guide/sync/offline-and-retention.md` | 59,671 | usually nothing on day one |
| `guide/clients/react.md` | 44,677 | the 33-line template `App.tsx` |
| `guide/getting-started/your-first-backend.md` | 23,124 | schema + one query + one mutation |
| `guide/reference/diagnostics.md` | 572,480 | exact `snapback guide <code>` lookup |
| `guide/guide-flat.generated.md` | ~3.2 MiB | never |

HTTP and MCP page resources return **complete Markdown**. An anchor or
"Stop here" heading does not keep a 44–55 KiB page out of context.
`snapback guide <term>` today returns matching page/anchor pointers, not
bounded section contents. "Load the local template files" has no inventory:
`expo-chat` is tens of KiB of source before generated output.

There is no carrier-level byte budget. `/llms.txt` already labels the
whole-corpus flat as a bulk last resort; the remaining defect is the
Read-first tier still pointing at the 58 KiB index.

### Two official-looking backends, one of them at the front of the map

The skill's golden path is explicit `.mjs` plus a tiny-data mention in
step 5. It does not name Familiar. The Familiar funnel is real and runs
through the artifacts the skill *mandates* loading: `guide/index.md`'s
Backend map **leads** with the Experimental Familiar profile, and the
capability index carries familiar rows. Tiny-data sits inside the skill
itself, so moving a heading does not remove those bytes.

An agent that follows the mandated first read therefore meets Familiar
and tiny-data before it has copied `listTodos`. That is the largest
documentation-caused token leak in the 2026-08-15 review.

### Getting-started pages are not getting-started

`guide/getting-started/your-first-backend.md` is 475 lines. The first schema
example still uses the in-repo demo import:

```js
import { defineSchema, defineTable, v } from '../../_kit/define.mjs';
```

The shipped `react` template uses:

```js
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
```

Agents copy the first snippet they see. Enum domains and structured stored
values sit before "Define functions."

`guide/clients/react.md` opens on `prepareReactBinding` /
`createSnapbackReactProvider`. The `react` template's `App.tsx` is 33 lines
of `useSnapbackQueries` / `useSnapbackMutation`. The sophisticated boot path
is real; it is not the first thing an app-building agent should see.

## Diagnosis

The 2026-07/08 programs optimized for **"never miss a capability."** That
was correct when agents were building around shipped features they could
not find (LLP 0187's replicated misses). The capability index, alias
column, paved-alternative links, and retrieval-eval seeds were the right
tools.

The 2026-08-15 cost function is **"minimum tokens and minutes to a working
app on the default surface."** Completeness is still required of the
corpus. It is no longer a required *first read*.

Concretely:

1. The capability index is a good registry and a bad novel. "Check it
   first" should mean `snapback guide <term>` (or checkout grep), not
   "read ~120 rows."
2. Honesty banners, GAP fences, and `since:` comments stay. They do not
   belong in the start packet.
3. Heading-level "stop here" folds do not save tokens on carriers that
   deliver whole files. Budget the bytes the carrier actually sends.
4. Competing experimental surfaces must be absent from the start packet
   until a template emits them *and* LLP 0252 records Promote.
5. Diaries are evidence of what happened, not current advice. Traps must
   be reconciled against `main` and against `published-closure.json`
   before they enter the start packet.
6. More chapters will not close a 3–4× wall-clock gap whose residue is
   generate-time / runtime disagreement and unpublished Familiar
   consumption. This RFC owns the entry path. Product work is recorded,
   not claimed closed.

## Design

### 1. First-read contract

Replace "load the guide, then the capability index, before designing
anything" in every first-read carrier, not only the in-checkout ones:

| Carrier | Current first item | New first item |
| --- | --- | --- |
| Authoring skill | `guide/index.md` + full capability index | start packet for the active template, or the shared mental-model section if no template is selected |
| Template `AGENTS.md` | pilgrimage to served `capabilities.md` | the transcluded start packet for *this* template |
| `guide/index.md` opening | "Start every task here: capability index" | "Start with the start packet / mental model; the index is the registry" |
| Repo `Agents.md` / `AGENTS.md` | platform-engineering corpus | keep (already injected in-checkout); add a one-paragraph app-building pointer at the top. Do not tell agents to unread a file the runtime already injected |
| Served `GET /llms.txt` Read-first tier | capability index | shared mental-model page plus `/_snapback/guide/start/` packet index (the served string is a static const and cannot name a per-template URL), then "lookup, do not linear-read, the capability index" |
| Instance home `/` | advertises the bulk flat | advertises the start packet / mental-model page; bulk flat stays last-resort |
| MCP guide resources | manifest → index / flats | same Read-first order as `/llms.txt` |
| Bare `snapback guide` / JSON channels | "Start with the capability index" | start-packet / mental-model first; `capabilityIndex` is a lookup channel, not the lead item |
| Published package READMEs (`@expo/snapback-cli`, `create-snapback-app`, and the remaining `@expo/snapback-*` funnel READMEs from LLP 0187 T4) | capability index | generated or cross-checked pointer to the mental-model page / start-packet index (LLP 0203 P1) |
| Public docs-site `/llms.txt` (LLP 0195) | capability index first | same Read-first order as the served server `/llms.txt` |

This is an amendment to LLP 0187 T4 and LLP 0061's served-funnel
steering. Design 1 of *this* RFC owns the edit list; LLP 0061 records
the amendment the same way it recorded T4/T5. The capability index
remains the completeness registry and the GAP authority. Carrier
wrappers that today name both MCP postures (`snapback mcp` vs
`snapback mcp-control`) and `snapback agent setup --print` keep that
LLP 0203 P5 steering; packets do not have to repeat it.

**Progressive renewal** has two implementable rungs. Do not claim the
second until its carrier exists.

**Rung A — landing (uses carriers that exist today):**

1. **Before the first edit:** only the start packet, or the shared
   mental-model page plus the template stub (Design 2). The packet
   *names* local edit-target files; opening those files to work is not
   a first-read failure.
2. **One named page** for one unresolved design question: run
   `snapback guide <term>` and open exactly the page (or Design-4 split
   page) it names. Do not open a second page without a trigger.
3. **A further page only after a trigger:** the brief is outside the
   packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

**Rung B — claimed only after `GuideFragmentV1` ships:**

Same ladder, but step 2 returns a bounded heading-sliced fragment
(≤ 4 KiB, content-hashed, `nextSlice` / `TRUNCATED` using the existing
`reference-lookup.mjs` grammar) over CLI, HTTP, and MCP, without
fetching the owning full page. Implementation and Acceptance treat
Rung B as a separate claim.

Budgeted `snapback guide <Symbol|code>` lookups **do not count** as
escalation pages — they are the prescribed alternative to opening a
page. Checkout grep of the capability index is allowed; an MCP or
served-corpus agent must use `snapback guide <term>` instead, because
grep of an MCP resource loads the whole 58 KiB page.

**Honesty-loop escape hatch.** If a *behavior* (not a declaration-exact
signature) is undocumented, read the owning package source, then file a
`guide-gap` ticket. The diet must not suppress LLP 0061 §5.

### 2. Start packet, not a handful of independent cards

Every shipped template has a **pointer-safe first-read route** that
lands in the same change as the steering edit. Two depths:

- **Full packet** (`react`, `expo-chat`): the generated start packet
  below.
- **Stub profile** (`crud-dashboard`, `media-feed`, `todo-contract`):
  the shared mental-model page plus a ≤1 KiB template stub naming the
  proof command, the edit-target files, and the actual consumer
  spelling. Stubs still have a `FirstReadProfileV1` and count toward
  Acceptance.

```text
snapback guide --start react
snapback guide --start expo-chat
snapback guide --start crud-dashboard   # stub → mental-model + 1 KiB
snapback guide --start media-feed       # stub
snapback guide --start todo-contract    # stub
```

Full packets are projected through CLI, HTTP
(`/_snapback/guide/start/<template>.md`), MCP, `/llms.txt`, and the
template's `AGENTS.md` (transcluded at scaffold-build time, checked by
`package.test.mjs` the way Rosetta is checked by `scripts/check-rosetta.mjs`).
One digest, one byte budget, one negative-vocabulary fence. The
transcluded `AGENTS.md` section carries the packet digest on a comment
line so the identity check is a compare.

Each packet contains, and contains only:

- the exact edit loop and proof command for that template
- the exact schema / functions / client files to inspect (not "the
  template tree")
- the template's actual provider and consumer spellings
- auth / upload posture
- generated-file ownership
- the few *current* safety traps that apply to this template,
  reconciled per Design 5 (version-bounded where the source fix has
  landed; unbounded only while the defect is still open)
- links — not copies — for everything else

The shared mental-model page ("Snapback in one screen", ≤ 3 KiB) is the
no-template fallback: you write `schema` + `functions` + `seed`; codegen
owns `generated/`; the server is the security boundary; a live query is
a named generated subscription; presence is ephemeral; sessions mode for
users or uploads; `bun run prove` is done. It does not duplicate a
template packet.

Add-one-feature recipes, if any, are surgical diffs against a named
template and are **not** part of the first-read packet. Under Rung A
they are reached as the single named page `snapback guide <term>`
returns. Under Rung B they may arrive as a `GuideFragmentV1` slice.

Do not add a handwritten ~40-row `SNAPBACK_*` encyclopedia. Keep the rule
"read the code, then `snapback guide <code>`." If an authoring-only
projection is later valuable, generate it from
`guide/reference/diagnostics-registry.json` under LLP 0193 (LLP 0203 P1:
generated or gated, never transcribed). A start packet may name 6–8
*failure classes* that route to exact lookup. It may not transcribe
fixes.

Wrong/right snippets that do appear in a packet are `source=`-bound, so
the pre-LLP-0211 "`v.json()` vs table `v.array()`" rot cannot re-enter
mechanically.

A composed `snapback context <brief>` / `GET /_snapback/guide/context?q=`
endpoint that returns packet + one matched fragment is optional product
work, not a landing gate. The packets must work without it.

### 3. Two independent default axes

Until a `snapback new` template emits something else **and** LLP 0252
records Promote, the defaults are:

| Axis | Default | Fence |
| --- | --- | --- |
| Backend authoring profile | `snapback-explicit-v1` (`.mjs`) | Familiar `schema.ts` / `query()` / `useQuery` stay out of explicit packets |
| Client consumer | **whatever canonical consumer the selected template already emits** | tiny-data `db.*` stays out; `useSnapbackQuery`, `useSnapbackQueries`, `useSnapbackMutation`, and `useSurface` are all in-bounds when the template uses them |

`react` uses `useSnapbackQueries`. `expo-chat` uses `useSnapbackQuery` and
`useSurface`. Telling agents to copy the template while declaring a
narrower hook spelling is a contradiction. The fence is against Familiar
aliases and the tiny-data doorway, not against valid canonical
compositions.

**This RFC never makes Familiar the default.** Familiar remains fenced
until the author records a Promote disposition under LLP 0252 §D7 /
Phase 4 (qualified multi-workload, multi-run, cross-family evidence).
LLP 0253 is Draft and explicitly leaves templates, dual qualification,
and the Phase-3/default program to LLP 0252.

0259 may state *additional* entry-path prerequisites that a future
Familiar template/packet would have to meet — published matched closure,
codegen/client sharing function-name and take-limit rules, and the
CI-checked published-closure consumer recipe at
`guide/recipes/familiar-published-closure-consumer.md` (guide id
`recipes.familiar-published-closure-consumer`) — but those are not
sufficient promotion criteria and do not substitute for 0252.

That recipe path is the **stable deliverable**. Diary 0078's citation of
`issues/20260813-guide-gap-familiar-source-consumer-closure.md` is
historical; that file was not present in `issues/` or `issues/closed/`
at review time. Recovering or replacing the ticket is hygiene (Design
6); the gate depends on the guide page, not the ticket filename.

Tiny-data stays an experiment under LLP 0254 / 0255 / 0256. It leaves the
skill golden path *and* the start-packet bytes.

`guide/index.md`'s Backend map moves shipped default-surface pages
(queries, mutations, first backend) above Experimental profiles.
Familiar is not the first link an agent who opened the index sees.

### 4. `FirstReadProfileV1` — budget the bytes the carrier sends

Heading folds and "do not load" lists are insufficient. Each template
gets a checked profile:

```text
FirstReadProfileV1
  template             # or "stub:<name>"
  depth                # packet | stub
  steering[]           # skill always-loaded body, packet or
                       # mental-model+stub, transcluded AGENTS section
  editTargets[]        # schema/functions/client files to open for work
  maxBytes             # STEERING only; see accounting
  requiredSafetyFacts[]
  escalationTriggers[]
  digest
```

**Accounting (normative).** `maxBytes` counts **steering bytes actually
delivered**, not the files the agent will edit.

- Include: always-loaded skill body; start packet **or**
  mental-model + stub; transcluded `AGENTS.md` section.
- Dedup: packet bytes already transcluded into `AGENTS.md` count once
  when the contract tells the agent to read `AGENTS.md` *or* the
  packet, not both.
- Exclude: `editTargets[]` (schema, functions, screen). Those are work
  files. Listing them is required; charging them to the diet would
  make `expo-chat`'s chat screen (~18 KiB) fail a docs budget.
- Exclude: already-injected repo `AGENTS.md` / platform-engineering
  context. That is fixed runtime overhead, recorded on the cold
  receipt, not charged to `maxBytes`.
- Occurrences: if a carrier would deliver the same steering artifact
  twice, count it twice unless a dedup rule above applies. Cold
  receipts report both unique and delivered bytes.

**Hard ceiling.** Steering `maxBytes` ≤ **16 KiB** for every profile
(packet or stub). Component caps inside that ceiling:

- shared mental-model page ≤ 3 KiB
- full start packet ≤ 6 KiB
- stub ≤ 1 KiB
- always-loaded skill body ≤ 10 KiB (experimental surfaces, deep
  Rosetta, long trap history, and carrier-specific detail move to
  on-demand references)

CI fails if any component or the deduped steering aggregate exceeds
its cap. Adding a required steering resource must stay under 16 KiB
or replace an equal-or-larger steering resource. The 16 KiB ceiling
is a required reduction against the recorded r1 instructed stack
(~14 KiB skill + ~24 KiB `guide/index.md` + ~58 KiB capability
index ≈ 96 KiB). An implementation that sets `maxBytes` to "whatever
we shipped" fails Acceptance.

**Negative-vocabulary fence.** First-read artifacts refuse
experimental/default-confusing spellings unless they occur inside an
explicit stop fence. For an explicit template packet, Familiar
`query(...)`, Familiar `useQuery`, and tiny-data `db.useQuery` must not
appear as if they were the path.

Getting-started and default-client encyclopedias are **physically
split**, not merely folded: a small published-import quick-start page
(transcluded from a template or published-path fixture) and a separate
reference page. Carriers that can only return a whole file then return
the small one. `check-guide` already enforces `source=` identity.

**`GuideFragmentV1` (Rung B only).** A heading-sliced, build-bound
fragment: start at the matched guide heading, ≤ 4 KiB, content hash,
`nextSlice` / `TRUNCATED` using the existing `reference-lookup.mjs`
grammar, served from CLI (`snapback guide <term> --section`), HTTP, and
MCP. Exact symbol/diagnostic lookup already has this shape; Rung B
extends it to manifest-anchored guide sections. Rung A does not depend
on it.

### 5. Trap reconciliation, not diary reprint

Diaries record incidents. The start packet may only carry traps that are
reconciled at landing time against `main` and against
`guide/published-closure.json`. Each row states: observed failure,
current-source status, newest-published-closure status, remaining
action, and whether it belongs in a first-read packet.

Reconciled as of 2026-08-15 review (capsule + current tree):

| Incident | Current source | Newest published | First-read? |
| --- | --- | --- | --- |
| Familiar `_generated/` vs `dev` opening `generated/` | Fixed. LLP 0253 r4; `_generated/` refuses. `issues/closed/20260815-familiar-codegen-generated-directory-mismatch.md` | Defect present in newest published closure 0.1.21; source fix unreleased. Drop the first-read row when `published-closure.json` `newestPublished` carries the fix (`since:` that version) | Version-bounded only, not a current-source trap |
| Dotted Familiar exports / Metro quoted aliases | Fixed. Shared `@expo/snapback-contract/operation-name`; `issues/closed/20260815-generated-operation-name-seams-metro-and-client-grammar.md` | Defect present in newest published closure 0.1.21; source fix unreleased. Same `since:` transition | Version-bounded only |
| Generated `take(4096)` accepted, runtime 1024 | Open. `issues/20260815-take-limit-shared-rule-and-generation-refusal.md` | Open | Yes, until generate-time refusal ships |
| Skill trap 1: "No `v.array()` on table fields" / design-only | **Stale.** Capability index and `your-first-backend.md` admit typed opaque arrays/objects (experimental, interior not queryable) | Depends on closure | Reconcile the existing skill row; do not copy the stale form into a packet |
| Mixing `useSnapbackQuery` with `db.useQuery` | Skill already warns; not a sourced Clique-paid loop | tiny-data Experimental | Not a Clique trap. Tiny-data stays out of the packet; no extra row |
| Nested `v.principal()` is a snapshot, not membership | Current getting-started text | Same idea if the closure includes LLP 0211 | Yes, one line, if the template can author structured fields |
| Inline `useSnapbackQuery` args / implicit sessions `auth` / seed identity / strict asset `<img>` | Still current | Still current | Yes, if the template hits that surface |

The skill's existing `since: 0.1.x` convention is the model for
version-bounded rows. Design 5's job at each landing is to re-verify,
not to accumulate history.

### 6. Ticket hygiene

- `issues/20260808-guide-gap-principal-to-app-identity-binding.md` — the
  page `guide/auth/app-identity-binding.md` exists. Close the docs ask or
  retarget at the remaining platform ask (verified identity claims in
  handlers).
- `issues/20260808-guide-gap-declared-refusals-discoverability.md` — the
  mutations page landed; remainder is codegen advisory / client hint.
- `issues/20260808-guide-freshness-warning-saturation.md` — 69% of pages
  warning (45 of 65 at filing) hides new drift. Out of this RFC's
  landing path. Start-packet authorities should be *stable* (templates,
  this RFC) so the new default context is not immediately noisy.
- The missing
  `issues/20260813-guide-gap-familiar-source-consumer-closure.md` is
  recovered or replaced; the gate is the guide page
  `guide/recipes/familiar-published-closure-consumer.md`. Diary 0078
  keeps the historical citation.

### Product work that beats more docs

This RFC does not own these. It records them so a docs-only landing
cannot be mistaken for the Clique close-out.

1. Refuse impossible `take()` at generate time
   (`issues/20260815-take-limit-shared-rule-and-generation-refusal.md`).
2. Shared function-name and limit rules in codegen and client — landed
   in source 2026-08-15; the *defect* is still present in the newest
   published closure 0.1.21. The fixes are unpublished.
3. `snapback init` into an existing Expo/React app
   (`issues/20260808-guide-gap-compose-snapback-into-existing-app.md`).
4. Keep making `SNAPBACK_*` refusals name the fix (LLP 0178 / 0193).
5. Diary 0083 explicit-lane seams, to be filed as ordinary tickets at
   landing: Expo admission rejecting generated `authoringProfile`;
   supervised binding not reminting after a function-digest change;
   optional authorized-lease offers rejecting ordinary live queries.
6. Optional composed `snapback context` endpoint (Design 2). Not a
   landing gate.

Under LLP 0041, entry-path steering is a surface fix that should not sit
landed-but-unpublished. The diet reaches npm agents only when a
qualified closure carries the new skill, templates, and `/llms.txt`.

## Non-goals

- Rewriting the capability index, surface map, or generated API reference.
- A corpus-wide freshness reconciliation as a landing gate.
- Making Familiar or tiny-data the default in this RFC.
- Telling app-building agents to read the LLP corpus.
- Pretending an already-injected repo `AGENTS.md` can be unread.
- A new competitive benchmark. Measurement stays with LLP 0186 W1 / LLP
  0198 / LLP 0201. This RFC's success signal is a smaller *delivered*
  first-read, proven by profile budgets and a cold trace, not improved
  Clique wall-clock.
- Changing hosted-vs-local honesty rules, snippet verification, or GAP
  row discipline.

## Open questions

1. **Start-packet freshness SLA.** Packets should cite stable
   authorities. If a packet warns, is that a P1 doc defect rather than
   background saturation?
2. **Existing retrieval-eval seeds.** Do start packets become allowed
   expected-pages for competitor-phrase cases that currently require a
   deep page, or only for the new diet seed? An agent that correctly
   stops at a packet must not fail a seed that demanded
   `backend/relational-queries.md`.
3. **Who owns `FirstReadProfileV1` checks** — `check-guide.mjs`, the CLI
   package tests, or a small dedicated script? Recommendation: guide
   checker for page/packet bytes; CLI package tests for transcluded
   `AGENTS.md` identity and the retired "capability index first" phrase.
4. **Optional `snapback context`.** Ship later under Product work, or
   never if packets plus `snapback guide` suffice?

Resolved in this revision:

- **Card home.** Guide-embedded / served (claude r1 M1).
- **Familiar default authority.** LLP 0252 §D7 Promote (codex r1 M1).
- **Lookup vs grep.** Served/MCP agents use `snapback guide <term>`.
- **Guide lookups vs fragment budget.** Lookups do not count.
- **Refusal encyclopedia.** Deleted as a first-read artifact.
- **`maxBytes` accounting and ceiling.** Design 4 (codex r2 M1).
- **Escalation carrier.** Rung A uses existing one-page lookup; Rung B
  is `GuideFragmentV1` and separately gated (claude r2 C1 / codex r2 M2).
- **Template scope.** Full packets for `react` and `expo-chat`; stubs
  for the other three; no pointer without a target (codex r2 M3).
- **Published funnels.** READMEs, docs-site `/llms.txt`, CLI channels
  (codex r2 M4 / claude r2 C2).
- **Familiar recipe identity.**
  `guide/recipes/familiar-published-closure-consumer.md` (codex r2 m5).

## Implementation sketch

Small, checkable, no `main`-quiet assumption. Publication pickup is in
the same change that promotes the closure (LLP 0041).

Steering changes and their pointer targets land **in the same change**.
There is no "repoint now, packets later" slice.

1. **Steering + skill diet + every pointer target** (Design 1–5).
   Mental-model page, `react`/`expo-chat` full packets, stubs for the
   other three templates, `FirstReadProfileV1` for all five. Repoint
   skill, every template `AGENTS.md`, `guide/index.md` opening and
   Backend map, repo app-building pointer, served `/llms.txt`, instance
   home, MCP order, `snapback guide` channels output, published package
   READMEs, docs-site `/llms.txt`. Thin the always-loaded skill to
   ≤10 KiB. Reconcile skill trap 1 (`v.array()`). Wrapper text keeps
   both MCP authority postures (LLP 0203 P5).
2. **Physical split of `your-first-backend.md` and `clients/react.md`**
   (Design 4). Published npm specifiers, template-sourced snippets.
3. **Retrieval-eval diet seed** plus a decision on existing seeds
   (open question 2). The new seed fails if the plan opens
   `guide-flat.generated.md` or exceeds the profile's `maxBytes` before
   the first edit.
4. **Ticket hygiene** (Design 6).
5. **Cold traces** for `react` and `expo-chat` (and stub-route traces
   for the other three): unique bytes, delivered bytes,
   `FirstReadProfileV1.digest`, first edit, first refusal, first green
   `prove`, pages opened. Required before claiming Rung A implemented.
6. **`GuideFragmentV1`** (Design 4). Required only before claiming
   Rung B. Not a blocker for Rung A.

## Acceptance

**Rung A (steering diet).**

- A cold agent following the skill, any shipped-template `AGENTS.md`,
  served `/llms.txt`, the instance home, bare `snapback guide` channels,
  a published funnel README, or the docs-site `/llms.txt` is **not**
  instructed to linear-read `guide/capabilities.md` or
  `guide/guide-flat*.md` before the first edit. Every pointer has a
  landed target (packet or stub).
- Carrier wrappers still name both MCP authority postures and
  `snapback agent setup --print`.
- The skill golden path and every explicit packet/stub name
  `snapback-explicit-v1` and that template's actual client consumer.
  Familiar aliases and tiny-data `db.*` are fenced. This RFC does not
  claim Familiar is or will become default.
- `your-first-backend.md`'s first schema snippet (or its split
  quick-start page) uses a published npm specifier and is
  transclusion-checked against a template or published-path fixture.
- `FirstReadProfileV1` exists for all five shipped templates. CI
  enforces the 16 KiB steering ceiling, component caps, Dedup, and the
  negative-vocabulary fence. Transcluded `AGENTS.md` matches the packet
  or stub digest. `maxBytes` is not an implementation-chosen number
  larger than the r1 instructed stack.
- Skill trap 1 and any Clique rows in first-read artifacts match Design
  5's reconciliation table at landing time.
- Design 6's two partial guide-gaps are closed or retargeted. The
  Familiar consumer deliverable is
  `guide/recipes/familiar-published-closure-consumer.md`.
- `packages/snapback-cli/package.test.mjs` and `scripts/check-guide.mjs`
  stay green.
- No claim that Clique wall-clock or tokens improved until a later
  LLP 0201 / 0198 run. Rung A claims a smaller delivered *steering*
  first-read, not a competitive victory.

**Rung B (bounded fragments).** A representative `snapback guide <term>
--section` (and the HTTP/MCP twins) returns ≤ 4 KiB without fetching
the owning full page. Not required to claim Rung A.

## Revision history

- **r1 (2026-08-15).** Draft → Review. First-read contract as skill +
  3 KiB card + grep; four independent cards; explicit `.mjs` +
  `useSnapbackQuery` as the sole default; Familiar gated on four 0259
  criteria including a now-missing ticket path; heading-level "stop
  here" folds; handwritten refusal card.
- **r2 (2026-08-15).** Addresses claude M1–M3 and codex M1–M5, plus
  author-authorized co-author material. Reviewed in the r2 delta round:
  both families NOT READY, PRE-EXISTING MATERIAL: no.
- **r3 (2026-08-16), UNREVIEWED.** In-delta fixes for claude C1 and
  codex M1–M4 plus the listed minors: Rung A/B escalation; 16 KiB
  steering ceiling and accounting; all-five-template pointer-safe
  routes; published README / docs-site / CLI channels; stable Familiar
  recipe path; trap-table publication wording; MCP P5 wrapper
  reservation. No family has reviewed r3.
