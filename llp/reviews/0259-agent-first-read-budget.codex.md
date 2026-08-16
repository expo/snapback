# Review artifact: LLP 0259 — codex family

Target: `llp/0259-agent-first-read-budget.rfc.md`

## Round 1 — 2026-08-15

- **Reviewer:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
  read-only sandbox, blind.
- **Revision under review (r1):** sha256
  `f7be03ecc2886baeff51b020f4c8f2f2fceb58e2c9d63ac1fe330c06583231f4`.
- **Capsule:** APFS clone of `git archive HEAD` plus disclosed overlay;
  no 0259 review artifacts or run journal present (structural blindness).
- **Instructions:** sha256
  `b022d0368e14d89af1413a2086ff2cf7da2465b16d5e8940b55733467c8f68b4`.
- **Verdict:** NOT READY (5 MATERIAL, 2 minor).

### Review body (verbatim)

## 1. Overall assessment

The central decision is sound: Snapback should preserve the capability-complete corpus while replacing “read everything first” with a bounded, template-led app-building path. The RFC correctly identifies that discovery coverage and first-read cost are different problems.

I would keep and revise this proposal, not abandon it. It is not ready yet because several implementation decisions do not match the actual retrieval carriers, current product state, or LLP 0252’s authority over the Familiar default.

## 2. Strengths

- §Motivation and §Diagnosis are evidence-led. The file sizes are accurate, and Diary 0078 supports the conclusion that boot, closure integration, and surface selection dominate cost while later feature work can be Convex-like.

- §Design 1 preserves the capability index as the completeness/GAP authority while demoting it as a linear read. That is the right amendment to LLP 0061/0187.

- §Design 4 correctly identifies two concrete first-hop defects: the demo-relative `_kit/define.mjs` import and the advanced React binding opening. Leading with published imports and template-shaped code is substantially better.

- §Design 3 is right to remove Familiar and tiny-data from the default funnel while they remain Experimental. This also avoids confounding LLP 0256’s bare/assisted evaluation.

- §Product work that beats more docs draws the right ownership boundary. The open `take(4096)` generation/runtime mismatch is real, and the RFC avoids claiming that documentation alone closes the Clique result.

- §Non-goals and §Acceptance appropriately refuse a competitive-performance claim. This RFC should claim a smaller context contract, not improved wall-clock until later measured evidence exists.

## 3. Concerns

1. **MATERIAL — §Design 3 assigns the Familiar default decision to the wrong authority.**

   “Familiar becomes default only when” the four listed gates pass reads as a sufficient default rule. It is not. Accepted LLP 0252 §D7 requires qualified multi-workload, multi-run, cross-family evidence and an author-recorded Promote disposition. LLP 0253 is still Draft, and its §S8 explicitly leaves templates, dual qualification, and the Phase-3/default program to LLP 0252.

   OQ3’s recommendation that “LLP 0253 plus a published closure” declare the gates met is therefore wrong.

   Resolve by stating:

   - LLP 0259 never makes Familiar default.
   - Familiar remains fenced until the author records a Promote disposition under LLP 0252 §D7/Phase 4.
   - LLP 0259’s closure/template/consumer requirements are additional entry-path prerequisites, not sufficient promotion criteria.

2. **MATERIAL — “one default surface” conflates the source profile with canonical client consumers.**

   §Design 3 defines the default as explicit `.mjs` plus `useSnapbackQuery`/`useSnapbackMutation`. But shipped templates legitimately differ: `react` uses `useSnapbackQueries`, while `expo-chat` uses both `useSnapbackQuery` and `useSurface`. Telling agents to copy the template while declaring a narrower client default creates a contradiction.

   Resolve by defining two independent axes:

   - Default backend authoring profile: `snapback-explicit-v1` using `.mjs`.
   - Default client consumer: whatever canonical consumer the selected template already emits—single/group hooks, mutations, or `useSurface`.

   The actual fences should exclude Familiar aliases and tiny-data `db.*`, not valid canonical client compositions.

3. **MATERIAL — the proposed budget is not expressed in bytes the carriers actually deliver.**

   Several mechanisms save visual attention but not context:

   - The current skill is 14,420 bytes and is loaded as a complete file. Merely moving tiny-data out of its “golden path” does not remove its detailed tiny-data section or Rosetta block from context.
   - HTTP and MCP page resources return complete Markdown pages. An anchor or “Stop here” heading does not prevent a 44–55 KiB page from entering context.
   - `snapback guide <term>` currently returns matching page/anchor pointers, not bounded section contents.
   - “Load the local template files” has no exact inventory or budget. The `expo-chat` template is roughly 83 KiB before generated files.
   - Repository `AGENTS.md` is already injected in many in-repo agent contexts; “do not load it” cannot recover those bytes and could obscure the diary obligations.
   - The contract says both “at most one feature page” and “two pages per task.”

   Acceptance currently checks instructions and file existence, not the aggregate bytes delivered or actual navigation behavior. The static retrieval check explicitly does not prove that an agent stays within a tool/context budget.

   Resolve with a carrier-level contract such as `FirstReadProfileV1` for each template:

   - exact resources and local source files;
   - aggregate `maxBytes`;
   - full skill and scaffold-instruction sizes included;
   - required safety facts;
   - permitted escalation triggers;
   - digest and a CI size check.

   Move optional skill material into on-demand references, physically split quick-start content from large reference pages or add bounded section retrieval, and require at least one cold `react` and one cold `expo-chat` trace before claiming the diet implemented.

4. **MATERIAL — §Design 5 would promote historical incidents without reconciling their current status.**

   Diaries are evidence of what happened, not necessarily current advice. Several cited Clique seams were repaired on 2026-08-15:

   - LLP 0253 r4 unified output under `generated/` and retired `_generated/`.
   - The shared operation-name grammar and canonical client now admit generated dotted names; current tests explicitly prove every generated spelling is callable.
   - Current Familiar output uses namespace access instead of Metro-invalid dotted ESM aliases.
   - The `take()` seam remains open and is correctly ticketed.

   The existing skill’s “No `v.array()` on table fields” trap is also stale: the current capability index and getting-started page admit typed opaque arrays/objects, including non-authoritative principal snapshots. The RFC should remove or version-fence that guidance, not copy it into another card.

   In addition, `issues/20260813-guide-gap-familiar-source-consumer-closure.md` is absent. A nonexistent issue cannot own Design 3’s fourth gate or the claimed remaining consumer recipe.

   Resolve with a per-incident reconciliation table containing: observed diary failure, current-source status, newest-published-closure status, remaining action, and whether it belongs in the first-read trap list. Recover/file the missing issue or inline its complete acceptance contract and assign a real owner.

5. **MATERIAL — the refusal card is infeasible and conflicts with LLP 0203 P1.**

   Approximately 40 full `SNAPBACK_*` names plus meaningful one-line fixes cannot realistically fit in ≤2 KiB. More importantly, a handwritten second set of fixes duplicates the generated diagnostic registry and violates “generated or gated, never transcribed.” It also competes with the already-correct exact lookup path.

   Resolve by deleting the refusal encyclopedia. Keep the rule “read the code, then run `snapback guide <code>`.” If an authoring-only projection is valuable, generate it from registry metadata such as `audience: app-author` and a canonical remediation field. A much smaller card could instead route 6–8 failure classes to exact lookup.

6. **minor — the card inventory and acceptance criteria disagree.**

   §Design 2 promises at most five pages, including plural add-one-feature recipes. The implementation creates four pages, and Acceptance requires four cards or merely an explicit skill-only answer. The fifth item has neither a page-count interpretation nor an acceptance obligation.

   Resolve by choosing the exact artifact set and making Design, implementation, and Acceptance enumerate the same deliverables.

7. **minor — `/llms.txt` is already more demoted than the RFC implies.**

   The current endpoint lists the complete guide under “Bulk export,” last, with “use only when you want the whole corpus.” The needed change is to replace the capability-index-first entry tier with the new bounded start artifact—not to portray bulk-last labeling as unimplemented.

   Resolve by recording the existing state and naming only the remaining delta.

## 4. Suggestions / new ideas

### A template-specific start packet

A better design than four largely independent cards is one generated start packet per template:

```text
snapback guide --start react
snapback guide --start expo-chat
```

Each packet would contain:

- exact edit loop and proof command;
- exact schema/functions/client files to inspect;
- the template’s actual provider and consumer spellings;
- auth/upload posture;
- generated-file ownership;
- the few safety traps relevant to that template;
- links—not copies—for everything else.

The same packet could be served through CLI, HTTP, and MCP with one digest and byte budget.

### A negative-vocabulary fence

Add a CI check over first-read artifacts that refuses experimental/default-confusing spellings unless they occur in an explicit stop fence. For the explicit template profile, names such as Familiar `query(...)`, Familiar `useQuery`, or tiny-data `db.useQuery` should not silently enter the packet.

This makes “one default profile” enforceable rather than stylistic.

### Budget renewal instead of a task-wide hard cap

“One or two pages per task” is too rigid for multi-feature work such as authenticated uploads plus presence. Use progressive renewal:

1. Start packet before the first edit.
2. One feature fragment for one unresolved design question.
3. A new fragment only after a concrete trigger: unsupported brief requirement, structured refusal, or failed proof.

That controls speculative reading without forcing agents to under-read safety material.

### A first-read receipt

For the two acceptance lanes, retain a tiny machine record:

```text
resources read
bytes delivered
first meaningful edit
first refusal
first green proof
pages opened before each milestone
correction loops attributable to missing/misleading context
```

This is not a competitive benchmark. It directly proves the contract this RFC changes and prevents optimizing for a fast but wrong first edit.

### Make the skill genuinely thin

Set a full-file skill budget—perhaps 8–10 KiB—and move:

- experimental surface instructions;
- deep Rosetta journeys;
- long trap history;
- carrier-specific detail

into on-demand references or Guide pages. Keep only the default loop, high-severity safety facts, done-oracle, and escalation rules in `SKILL.md`.

## 5. Open questions

1. What exact aggregate byte ceiling applies before the first meaningful edit, and which injected context is counted as fixed overhead?
2. Is the start artifact generic, or template-specific as the shipped client patterns suggest?
3. What safety facts must appear in every start packet even when they consume budget?
4. Should “success” be first edit, first live read, or first green proof? I recommend recording all three and gating on first green plus correction loops.
5. Which current Clique incidents remain true in the newest published closure, as opposed to current source only?
6. Will the missing Familiar consumer issue be recovered, replaced, or absorbed into this RFC?
7. What registry field or generated rule selects the small set of app-authoring diagnostics, if any projection is retained?
8. Which sections will actually be removed from the full skill, rather than merely moved below headings?
9. Who owns the `FirstReadProfileV1` manifest and its byte/negative-vocabulary checks?

## 6. Recommended next step

Revise the RFC around three concrete decisions:

1. Bind Familiar promotion exclusively to LLP 0252’s author disposition and distinguish source profile from template-owned client consumers.
2. Replace heading-level budgeting with a physically bounded, template-specific start artifact plus an enforced aggregate budget and cold trace.
3. Reconcile every proposed trap against current source and the published closure, recover the missing issue, and remove the handwritten refusal encyclopedia.

Keep the document in Review. Because those changes substantially alter the contract and acceptance design, a focused delta or implementer-lens review would be valuable if the author extends the single-round authorization; otherwise the post-round revision should be labeled unreviewed rather than treated as converged.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-16

- **Reviewer:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
  read-only sandbox, blind.
- **Revision under review (r2):** sha256
  `06f539333bc06b9fec3c2f34c54973b9ab8224e96741c3c27d6ee41776067a08`.
- **Capsule:** r1-pristine clone with r2 overlaid; no 0259 review
  artifacts present (structural blindness).
- **Instructions (delta round):** sha256
  `88b75b800db500beb540416cbe01e724f95dbb12d812d9588bc7c48e348eaafc`.
- **Verdict:** NOT READY (4 MATERIAL, all IN-DELTA; 3 minor IN-DELTA).
  PRE-EXISTING MATERIAL: no.

### Review body (verbatim)

## 1. Overall assessment

r2 substantially repairs the enumerated r1 defects. In particular, it reaches the served funnel, gives LLP 0252 sole authority over Familiar promotion, separates backend profile from client consumer, replaces heading-level budgeting with physical artifacts and profiles, reconciles stale traps, and removes the refusal encyclopedia.

The evidence also checks out: the capability index has 122 data rows; cited guide sizes match; the React and Expo templates use the hooks r2 attributes to them; Diaries 0078 and 0083 support the timing and friction claims; and LLPs 0252/0253 confirm that Familiar remains Experimental and that 0253 does not own default promotion.

However, the new packet/profile design has four MATERIAL in-delta defects. The aggregate budget is not actually bounded, the required bounded feature-fragment carrier does not exist in the implementation plan, the rollout scope and sequencing contradict the design, and “every first-read carrier” omits important published entry points. These are defects in the new r2 decisions, not surviving MATERIAL defects in pre-existing text.

## 2. Strengths

- §Motivation accurately reframes the problem from capability discovery to delivered context cost. The measured file sizes and approximately 120-row index claim are correct, and the diary evidence remains appropriately qualified rather than being promoted into a magnitude claim.

- §Design 1 repairs the principal served-funnel omission by explicitly covering `/llms.txt`, the instance home, MCP, the skill, scaffold instructions, and the Guide opening. Retaining the capability index as the completeness/GAP registry is the right distinction.

- §Design 3 correctly separates backend-authoring profile from client-consumer spelling. The `react` template uses `useSnapbackQueries`; `expo-chat` uses `useSnapbackQuery` and `useSurface`. The text also correctly attributes Familiar exposure to the Guide index/map and capability registry rather than falsely claiming it appears in the skill’s explicit golden path.

- §Design 3 correctly subordinates any Familiar default change to LLP 0252 §D7. LLP 0253 is Draft and explicitly leaves templates, dual qualification, and promotion to LLP 0252.

- §Design 5 is a meaningful improvement over diary transcription. The `_generated/` and dotted-export issues are fixed in current source, the impossible `take(4096)` issue remains open, and skill trap 1 is demonstrably stale because typed opaque `v.array`/`v.object` fields now exist.

- §Acceptance properly limits the proposed claim to a smaller delivered first read and explicitly refuses to claim improved Clique wall-clock or token performance.

## 3. Concerns

1. **MATERIAL · IN-DELTA — `FirstReadProfileV1` does not establish an aggregate first-read budget.**

   §Design 4 leaves exact `maxBytes` and even the accounting boundary open until implementation. The suggested 3/6/10 KiB component limits do not bound `resources[]`, which also includes named local source files and injected scaffold instructions. Those files can dominate: the current Expo packet candidates include an 18,629-byte chat screen and an 8,657-byte functions file before counting schema, skill, `AGENTS.md`, or the packet itself.

   As written, Acceptance passes if implementation chooses any `maxBytes`, including one larger than today’s first read. It therefore cannot falsify the RFC’s central “smaller delivered first-read” claim.

   Resolve by defining byte-accounting semantics—actual delivered occurrences rather than merely distinct files, treatment of packet bytes already transcluded into `AGENTS.md`, and fixed injected overhead—and pinning a hard aggregate ceiling or an explicit required reduction against a recorded baseline for every in-scope profile.

2. **MATERIAL · IN-DELTA — progressive renewal depends on a bounded feature-fragment carrier that the implementation does not provide.**

   §Design 1 requires `snapback guide <term>` to return bounded feature content rather than a whole 40–55 KiB page. Current exact symbol and diagnostic lookups are bounded, but fuzzy Guide search in `src/cli/guide_command.rs` returns only page, heading, anchor, and URL. Following that URL over HTTP still loads the complete Markdown page—the exact carrier defect the RFC diagnoses.

   No implementation step adds section extraction, and the optional `snapback context` endpoint is explicitly not a landing gate. Thus the proposed escalation path is unavailable even after all listed implementation steps land.

   Resolve by specifying and implementing a build-bound fragment contract: extraction boundaries, byte ceiling, truncation/pagination, content identity, CLI output, and corresponding HTTP/MCP access. Add acceptance that a representative feature lookup returns content within the fragment budget without fetching the owning full page.

3. **MATERIAL · IN-DELTA — packet scope and rollout order contradict the normative design.**

   §Design 2 says there is one packet per shipped template and enumerates five templates; §Design 4 says each template gets a checked profile. The Implementation sketch and Acceptance require profiles and traces only for `react` and `expo-chat`, with no later step covering `crud-dashboard`, `media-feed`, or `todo-contract`.

   The sequencing is also unsafe: step 1 repoints the skill and template `AGENTS.md` files to start packets, while step 2 creates the mental-model page and first packets; nevertheless §Implementation says step 1 may land without packets. That creates either broken pointers or an unbudgeted interim fallback.

   Resolve by choosing one coherent scope. Either require packets/profiles for all five shipped templates, or explicitly route the other three to a budgeted shared fallback. Land the fallback and every pointer target no later than the steering change, and make Acceptance cover every shipped template’s resulting route.

4. **MATERIAL · IN-DELTA — the “every first-read carrier” inventory omits published entry points that still impose the old funnel.**

   §Design 1’s table excludes package READMEs and the public documentation-site `/llms.txt`. Current `@expo/snapback-cli`, `create-snapback-app`, and numerous other package READMEs still route readers to the capability index; the docs-site generator deliberately sorts the capability index first. These are pre-install/npm first hops explicitly established by LLP 0187 T4 and LLP 0186 W2/W5.

   Updating only the embedded server’s `/llms.txt` does not repair the public `/llms.txt` or npm landing-page funnel, so the claim “every first-read carrier” would remain false.

   Resolve by adding published package README projections and the public docs-site `/llms.txt` to Design 1, implementation, and Acceptance. Generate or cross-check their packet routing under LLP 0203 P1.

5. **minor · IN-DELTA — the Familiar consumer deliverable is described as named but is not actually given a stable name.**

   §Design 3 defines useful properties for a “CI-checked published-closure consumer recipe in `guide/`,” but supplies no page path, capability id, or other stable artifact name. Acceptance therefore repeats the word “named” without identifying what must exist.

   Resolve by assigning the recipe a stable guide path/id or a precise generated deliverable identifier.

6. **minor · IN-DELTA — the published-status wording in the trap table is ambiguous.**

   “Live on ≤0.1.21” can be read as saying the fix is live, although `published-closure.json` identifies 0.1.21 as published before the current-source fixes. It also asserts all earlier versions without cited evidence.

   Resolve with wording such as: “Defect present in newest published closure 0.1.21; source fix unreleased,” plus the exact future `since`/`unreleased` transition rule.

7. **minor · IN-DELTA — Acceptance does not preserve LLP 0203 P5’s control-plane steering.**

   The affected carriers currently name `mcp-control` and its authority consequence. The diet could satisfy LLP 0259’s Acceptance after deleting that steering, even though LLP 0203 P5 requires every funnel to name the control plane.

   Resolve by asserting that the carrier wrapper—not necessarily every packet copy—continues to name both MCP authority postures and the setup preview.

## 4. Suggestions / new ideas

- Generate packets and profiles from one compact template-orientation manifest containing source files, provider/consumer spellings, safety facts, proof command, and escalation triggers. This would make LLP 0203 P1 enforcement straightforward.

- Add `snapback guide --start auto`, resolving the current scaffold from a committed template/profile marker. Explicit template names should remain available for deterministic tooling.

- Have cold receipts report both unique artifact bytes and actual delivered bytes. The latter exposes accidental duplicate packet loading through `AGENTS.md`, the skill, and a later CLI fetch.

- Consider a monotonic budget rule: adding a required resource must either remain under the profile ceiling or explicitly replace an equal-or-larger first-read resource.

## 5. Open questions

1. Are all five shipped templates part of this RFC’s implemented contract, or are three intentionally assigned to the shared fallback?
2. Should bounded feature fragments be a new `snapback guide` mode, or stable fragment resources, or both?
3. Does `maxBytes` count repeated delivery of identical bytes, and how are already-injected `AGENTS.md` and skill bodies represented?

## 6. Recommended next step

Revise to r3 by closing the four MATERIAL items: pin aggregate accounting and enforceable ceilings, specify the bounded fragment carrier, make template scope and landing order coherent, and cover the npm/public funnels. Incorporate the three minor clarifications, then run another delta review on the resulting revision. The author retains the status decision.

PRE-EXISTING MATERIAL: no
VERDICT: NOT READY
