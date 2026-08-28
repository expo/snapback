# Snapback simplification batch — super-refine run journal (Cluster A)

Orchestrator/reviser: Claude Opus 5 (1M context), session
`session_01ShwvgZZQLC6PmiEVDK1bKu`. Author: Charlie Cheever, who invoked
`/llp-super-refine` on 2026-08-27 with the bound "a round or two on each
one, just to suss out major issues more than to perfect them" — document
authority and repository-disclosure authority for the external sends are
recorded from that invocation. Both reviewers run locally on the author's
machine; no repository bytes leave it beyond the two model providers'
own inference calls.

The eight targets were authored by this same orchestrating session
earlier in the conversation. The reviser therefore never reviews its own
work: all verdicts come from the two external families.

## Topology

Eight targets, split into two lockstep clusters by coupling. This file is
the primary run journal for **Cluster A** (authoring surface); the
`.cluster-pointer.md` files for 0319/0320/0321/0323 point here.
Cluster B's journal is
`llp/reviews/0322-tiered-diagnostic-codes.run.md`.

| Cluster | Targets | Rationale |
|---|---|---|
| A | 0318, 0319, 0320, 0321, 0323 | shared `Systems:` (authoring surface, codegen, DX); each cross-references the others' sequencing |
| B | 0322, 0314.001, 0324 | shipped-artifact size and corpus hygiene; 0322 and 0314.001 cross-reference on registry bytes |

Both clusters were sent to both families, so every target receives two
mutually blind reviews per round.

## Reviewer roster

LLP 0010.001 current instantiation, unmodified:

- codex `gpt-5.6-sol` @ ultra reasoning effort, read-only sandbox,
  independent ephemeral session (`codex exec -m gpt-5.6-sol
  -c model_reasoning_effort=ultra -s read-only`). The runner emitted a
  standing `--dangerously-bypass-hook-trust` warning from the user's own
  `~/.codex/config.toml`; it was not set by this loop.
- `grok-4.6` @ xhigh, headless (`grok --prompt-file … --disallowed-tools
  bash,shell,terminal,execute`), full terminal ban carried in the prompt
  as required, built-in file reads only.

Reviser: orchestrator.

## Round 1

- Status transition applied at loop start: all eight targets `Draft` →
  `Review`, the one authorized transition. Recorded in each document's
  `**Revised:**` line as `(a — Draft → Review at llp-super-refine loop
  start …)`.
- Repository HEAD at launch: `d49ae32b50fcc1506fe79aee3680cae76eb5c12d`.
  The targets are untracked working-tree files at that HEAD.
- Target sha256 (post status-flip, pre-launch):

  | Target | sha256 |
  |---|---|
  | 0314.001 | `ca39b0bf5e0fec8a5045e4ef4776935b1f2048a8a8114759ebac88bde6c94c2d` |
  | 0318 | `1691401b09704131621ff8e541a168900b8387d6b39a4eeb6afe12731be976e3` |
  | 0319 | `38e734a02cbe0dee942f1e3f48f17c7477392034c456417dcddd8a15faf8c47f` |
  | 0320 | `8e19e66b806d1c581b59ef14931ad4875679496ff5e6ef74a89ff89af77c2df5` |
  | 0321 | `a687334a805e9c8229d09a04015beb034c18195be7d3e4fda1334e1fb58ef84a` |
  | 0322 | `85779b29c2ef87d539e8aec5622dd70ce349c2ef7cbd5cb084b0fdd0baa71333` |
  | 0323 | `7e1a7c7d3ae7d0b9198a8df1750a897ce7bf9504ad8731542720e37073ce2aa4` |
  | 0324 | `64a12a6cad6a9419ab759f8f97bf17c4d0ea24571fea8213c7f1524fae57c252` |

- Capsule: live checkout, read in place. **Blindness for round 1 is
  structural for these targets** — no review artifact for 0318–0324 or
  0314.001 existed anywhere in the tree at launch. The parent
  `llp/reviews/0314-shipped-runtime-binary-size.{codex,grok}.md` do
  exist and review a *different* target (the parent research document);
  Cluster B reviewers were told to treat LLP 0314 as context. The
  instruction ban on reading `llp/reviews/` is additionally
  **SELF-ATTESTED** for both families, since a read-only sandbox and
  built-in file tools both span the checkout.
- Instruction brief sha256 (common body)
  `1848df190861b08b1d8a041b7131888fe706042de89f0aed861539a11e9e1a82`;
  per-runner prompts:
  codex-A `0dde74a4c1791f82…`, codex-B `0d3fa3a82aefa4d0…`,
  grok-A `a13199075bfb142f…`, grok-B `94c9cc75b80b41b3…`.
- Ordering note, disclosed for honesty: the target-hash and
  brief-hash records were computed and persisted to the run scratchpad
  before dispatch; this journal file was written immediately after
  dispatch, while the four reviews were in flight. No target byte
  changed between hashing and dispatch.
- Launch: four concurrent runs (2 families × 2 clusters).

### Verdicts

All four round-1 reviews (2 families x 2 clusters) returned. Artifacts
were held out of `llp/reviews/` until the last one landed, so no
in-flight reviewer could see another's output; structural blindness was
preserved for the whole round.

| Target | codex `gpt-5.6-sol` @ ultra | `grok-4.6` @ xhigh |
|---|---|---|
| 0318 | NOT READY (7 MATERIAL) | NOT READY (3 MATERIAL) |
| 0319 | NOT READY (2 MATERIAL) | **READY** |
| 0320 | NOT READY (5 MATERIAL) | NOT READY (4 MATERIAL) |
| 0321 | NOT READY (3 MATERIAL) | NOT READY (4 MATERIAL) |
| 0323 | NOT READY (4 MATERIAL) | NOT READY (2 MATERIAL) |
| 0322 | NOT READY (3 MATERIAL) | NOT READY (3 MATERIAL) |
| 0314.001 | NOT READY (4 MATERIAL) | NOT READY (2 MATERIAL) |
| 0324 | NOT READY (3 MATERIAL) | NOT READY (1 MATERIAL) |
| **SET** | **NOT READY** | **NOT READY** |

50 MATERIAL concerns total. One cross-family asymmetry: LLP 0319, where
grok returned READY and codex returned NOT READY on the ground that the
query flavors are not a cross-product but separate closed validators
with distinct normalized plans. Codex's reading is the better-evidenced
one and is treated as controlling.

### Orchestrator verification

Load-bearing reviewer claims were checked against the repository before
any were accepted. Spot-checks run, all confirmed:

1. `guide/getting-started/your-first-backend.md` does carry a "Legacy
   compatibility: bundled handler modules" section calling the
   `source`/`exportName` split "the compatibility lane, not the paved
   path for new work."
2. `handler` is present in both `JS_QUERY_SPEC_FIELDS` and
   `JS_MUTATION_SPEC_FIELDS` in `packages/snapback-codegen/define.mjs`.
3. LLP 0035 does say "Fan-out is no longer VM-bound; it is row-bound …
   the measured hand-off from DK-4 to the DK-3 revisit trigger."
4. LLP 0252 D7 does require a four-lane matrix over three workload
   families at preregistered N>=3, and states "The explicit profile
   remains the published default initially."
5. `demos/todo/snapback/generated/artifacts.json` `summary.counts`
   reports `custody: {consumerCommitted: 9, regenerableCache: 41,
   reviewManifest: 1, total: 51}` and `operations.total: 6`.
6. `packages/snapback-react/package.json` already exports `.`, `./core`,
   `./thumbhash`, `./familiar`; `core.mjs` states "The package root
   remains the compatibility composition."
7. `gzip -9` on this checkout: `registry.json` 5,162,043 -> 395,845;
   `diagnostics-registry.json` 2,526,048 -> 152,125; whole flat
   4,084,811 -> 942,276. `crates/snapback-server/build.rs` writes raw
   `fs::read` bytes with no compression.
8. LLP 0000's ratification ledger spans lines 67-429 (363 lines, ~32% of
   the document). `guide/start/` is 20,950 logical bytes; the "44 KB" in
   LLP 0324 was `du` block allocation.

Every spot-check confirmed the reviewer. No reviewer claim was found
overstated.

## Terminal — round 1, escalation to the author

The loop **stops after round 1** under the LLP 0010.001 invariant
"fundamental-redesign feedback stops the loop for author authorization."
It did not exhaust its round budget; it hit a stopping condition.

Both families independently reported that several targets are not
revisable into READY without decisions only the author can make:

- **0320** — codex: lifting can change race outcomes (HostPlan mutations
  are unconditional sequences with a client-supplied stale baseline; JS
  handlers validate captured dependencies at commit), and declarative
  single-table live queries are the only public cold-retention class
  while generated mutation-plan presence is the offline replayability
  predicate. The RFC's "does not remove capability" claim is false as
  written. Either the RFC dies or it becomes its own OQ4 fallback.
- **0321** — both families: the three-tier custody model the RFC
  proposes already exists in `artifacts.json` as `custody`/`consumer`
  fields, and the RFC's placement rules would gitignore
  `consumer-committed` runtime-load inputs that Contract, Rust
  `include_bytes!`, and hosted release packaging depend on. Codex's
  disposition is "rewrite as a materialization/committed-ledger location
  change over the existing custody model" — a different document.
- **0323** — both families: a small default root and zero removed
  published identities are mutually exclusive, because tracked
  identities are module-qualified. The RFC must pick, and picking is an
  author decision with a compatibility cost.
- **0318** — both families: LLP 0252 D7 is an Accepted promotion gate
  the RFC neither satisfies nor supersedes. Whether to supersede it is
  the author's call, not the reviser's.

Proposed next step per the invariant: targets **stay `Review`**. The
author decides, per document, between (a) authorize a revision under a
stated disposition, (b) revert to `Draft` for rework, or (c) withdraw.
No status beyond `Review` is set by this skill.

The eight targets are unchanged from their round-1 hashes; no revision
was applied.

## Disposition applied (2026-08-27, author instruction)

The author reviewed the round-1 terminal and directed: do the
discoverability work, produce documents for the two items worth doing,
and withdraw the rest.

**Withdrawn** (`Status: Withdrawn`, unlinked from `llp/current/`, each
carrying a `## Withdrawal (2026-08-27)` section stating the refutation
and pointing here). Original text retained unrevised — its false claims
are enumerated in the withdrawal section, not corrected in place, so the
documents remain readable as the record of what was proposed and why it
failed:

| Target | Withdrawn because |
|---|---|
| 0318 | LLP 0252 D7 is an unmet Accepted gate; the §1.4 exhibit is the documented compatibility lane; the profiles differ semantically, not just in spelling |
| 0319 | The flavors are separate closed validators with distinct normalized plan kinds, not a flattened cross-product |
| 0320 | Performance premise inverted (LLP 0035 M3); lifting can change race outcomes; cold retention and offline replayability are lost on lift failure |
| 0321 | The custody model already exists in `artifacts.json` and is documented; the placement rules would gitignore runtime-load inputs |
| 0322 | `httpClassified` is not wire reachability; `{code, detail}` collides with the shipped contract; LLP 0193 mechanically refuses the reclassification; the drift-gate win does not exist |
| 0323 | `./core` already ships as a governed LLP 0145 decision; a small root and zero removed module-qualified identities are mutually exclusive |
| 0314.001 | The whole flat is not a section-flat concatenation; the `contentHash` model is backwards; superseded by 0314.002 |

**Retained and revised:** LLP 0324, at revision (b). All four MATERIAL
items folded; the direction is unchanged and every change is a fact
correction or a scope narrowing. It stays `Review` and stays in
`llp/current/`.

**New successor:**
[LLP 0314.002](../0314.002-compress-the-embedded-guide-artifact.rfc.md),
`Draft`, linked into `llp/current/`. It originates from the codex
round-1 finding that the Guide artifact ships uncompressed, re-measured
independently: the packed corpus is 20,658,338 bytes raw, 3,501,719
under `gzip -9`, 1,255,996 under `zstd -19`. Its §7 records that
provenance.

**Repository change landed:** `AGENTS.md` §The Snapback Guide gains a
bullet directing Snapback engineers to read the guide page for any
authoring surface they are changing. This is the one discoverability
defect that survived investigation — three of the withdrawn RFCs
contradicted paved forms the guide states plainly, having been authored
from code, corpus, and `demos/` alone. Recorded as LLP 0324 §2.

Three discoverability items proposed at disposition time were
investigated and **dropped as non-problems**: the shipped templates
already use the paved inline form; `@expo/snapback-react/core` is
documented in 88 guide locations including a working import in
`guide/clients/react.md`; and the custody classes are documented in
`guide/getting-started/generated-artifacts.md`. The guide was correct on
all three.

No delta round was run. The loop terminated at round 1 by the
fundamental-redesign invariant, and the author's disposition resolved
each target without requiring a revision that a reviewer had not seen —
except LLP 0324 (b), whose fold is unreviewed and labeled as such here.
