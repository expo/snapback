**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at ultra reasoning effort (`-c model_reasoning_effort=ultra`), read-only sandbox, independent ephemeral session.
**Date:** 2026-08-27
**Redacted:** no
**Method:** cli-runner (detached background dispatch, orchestrator polled)

# Snapback simplification batch — Cluster B review artifact — GPT (Codex) family

Lockstep cluster: LLP 0322 (primary) + 0314.001 + 0324. This file is the single verbatim
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
- Result: **0322 NOT READY (3 MATERIAL), 0314.001 NOT READY (4), 0324 NOT READY (3), SET NOT READY.**

### Verbatim review body

Overall, the set is not ready. The headline byte/code measurements mostly reproduce; the blocking errors are in reachability, integrity, authority, and preservation claims.

## LLP 0322

- **MATERIAL — §1, OQ1, §5 — `httpClassified` is not wire reachability.** The generator derives it only from a reviewed Rust-server test table ([scripts/generate-diagnostics-registry.mjs:471](/Users/ccheever/projects/snapback/scripts/generate-diagnostics-registry.mjs:471)). `SNAPBACK_CONNECTION_SOCKET_REQUIRED`, for example, crosses the Cloudflare HTTP boundary as 409 ([coordinator.js:5231](/Users/ccheever/projects/snapback/targets/cloudflare/src/coordinator.js:5231)) and drives client retry behavior ([index.mjs:1772](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1772)), yet its registry record has `httpStatus: null`. Therefore “the rest never cross a wire,” the 1,702-code upper bound, and the resulting cost estimate are false. Suggested fix: inventory every carrier—Rust and target-local HTTP/WebSocket, CLI/MCP/subprocess JSON, codegen, and client-local diagnostics—then remeasure the candidate population.

- **MATERIAL — §2–§3, OQ3/OQ4 — an unstable `detail` cannot preserve existing machine behavior or LLP 0193.** Production consumers branch on exact codes for retry, recovery, authority custody, and exit classification—not merely acceptance tests. Examples include the JS readiness retry set ([index.mjs:1772](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1772)), Swift’s socket-establishment action ([StateMachine.swift:1288](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift:1288)), the app-CLI’s frozen exit taxonomy ([result-core.mjs:30](/Users/ccheever/projects/snapback/packages/snapback-app-cli/result-core.mjs:30)), and exact security-sensitive issuer tuples ([index.mjs:3005](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:3005)). LLP 0193 defines internal codes as never agent-triggerable and mechanically refuses unmarked agent-triggerable-to-internal reclassification ([LLP 0193:103](/Users/ccheever/projects/snapback/llp/0193-errors-as-docs-completeness.plan.md:103), [LLP 0193:314](/Users/ccheever/projects/snapback/llp/0193-errors-as-docs-completeness.plan.md:314)). Suggested fix: retain every machine-consumed and agent-triggerable distinction as stable, or introduce a separate stable machine-readable reason beneath the broad public class. Preserve exact remediation lookup and explicitly amend LLP 0193.

- **MATERIAL — §3 — dropping site coordinates does not stop line-motion churn under the current identity design.** `sourceDigest` hashes the complete bytes of every scanned source ([generator:608](/Users/ccheever/projects/snapback/scripts/generate-diagnostics-registry.mjs:608)), including production and Guide inputs, and the complete registry bytes feed the Guide `contentHash` ([guide-lib.mjs:1271](/Users/ccheever/projects/snapback/scripts/guide-lib.mjs:1271)). Moving code therefore still changes the shipped artifact even without per-site records. Suggested fix: split the build-time source-completeness digest from a coordinate-insensitive public-registry digest; only the latter may participate in the shipped Guide identity.

- **minor — Summary/§1 — two count interpretations are wrong.** `sourceFiles: 631` is the number of production files scanned, not files containing emitting sites; only 371 distinct files have emissions. `guideAnchored` means a literal code appeared below a Guide heading ([generator:529](/Users/ccheever/projects/snapback/scripts/generate-diagnostics-registry.mjs:529)); it does not establish explanatory prose or remediation quality. Suggested fix: say “631 production files scanned” and “452 have a generated exact Guide anchor.”

The published counts, ratios, and artifact sizes themselves are exact.

## LLP 0314.001

- **MATERIAL — §2a, §3, §5 — deleting flats is a governing amendment and a multi-consumer migration, not deletion of one assertion.** LLP 0061 explicitly requires packing every generated flat and recording its path, bytes, digest, and MCP URI ([LLP 0061:544](/Users/ccheever/projects/snapback/llp/0061-agent-first-snapback-guide.rfc.md:544), [LLP 0061:709](/Users/ccheever/projects/snapback/llp/0061-agent-first-snapback-guide.rfc.md:709)). Current code requires the whole flat in the closed corpus ([guide_artifact.rs:17](/Users/ccheever/projects/snapback/crates/snapback-server/src/guide_artifact.rs:17)); MCP requires embedded section flats ([guide_mcp.rs:121](/Users/ccheever/projects/snapback/crates/snapback-cli/src/guide_mcp.rs:121)); `check-guide` and the docs-site generator also consume the committed files. Suggested fix: choose explicitly between retaining committed projections but excluding them from the encoded shipment, or deleting them and migrating the generator, checker, docs-site, decoder, HTTP, MCP, and tests. Either option must amend LLP 0061’s physical-carriage language.

- **MATERIAL — §3 and OQ3 — the hash model is false and contradicts LLP 0314.000.** `contentHash` does not cover the packed set. It covers only the regenerated whole flat and the two JSON registries ([guide.rs:174](/Users/ccheever/projects/snapback/crates/snapback-server/src/guide.rs:174), [guide-lib.mjs:1271](/Users/ccheever/projects/snapback/scripts/guide-lib.mjs:1271)). Section flats and pages are outside it. LLP 0314.000 says exactly that and introduces `artifactSha256` to bind every encoded record ([LLP 0314.000:358](/Users/ccheever/projects/snapback/llp/0314.000-reduce-shipped-runtime-size.plan.md:358)). Thus deleting section records need not change `contentHash`, while it necessarily changes the whole-artifact digest and closed record set. Suggested fix: preserve or explicitly redefine `contentHash`, make `artifactSha256` bind the reduced set, and record an explicit amendment/sequencing relationship with scope-frozen LLP 0314.000.

- **MATERIAL — §2b — “pick one and render or parse the other” includes a capability-losing direction.** LLP 0194 already establishes JSON as canonical and Markdown as a projection ([LLP 0194:57](/Users/ccheever/projects/snapback/llp/0194-generated-api-reference.rfc.md:57)). Diagnostics Markdown exposes only the first site plus a count while JSON retains every site ([generator:651](/Users/ccheever/projects/snapback/scripts/generate-diagnostics-registry.mjs:651)); the symbol index also deliberately caps removed-symbol output ([generate-symbol-registry.mjs:719](/Users/ccheever/projects/snapback/scripts/generate-symbol-registry.mjs:719)). Markdown cannot reconstruct either registry. Suggested fix: pin both JSON registries as shipped authorities and derive Markdown from them on demand, with byte-parity tests for existing Markdown responses.

- **MATERIAL — §2c — calling compression “marginal” is quantitatively false.** On this checkout, `gzip -9 -c` reduces `registry.json` from 5,162,043 to 395,845 bytes and `diagnostics-registry.json` from 2,526,048 to 152,125 bytes: a combined 92.9% reduction. The 4,084,811-byte whole flat becomes 942,276 bytes. The current encoder writes raw file bytes ([build.rs:196](/Users/ccheever/projects/snapback/crates/snapback-server/build.rs:196)) and embeds the raw artifact ([guide.rs:22](/Users/ccheever/projects/snapback/crates/snapback-server/src/guide.rs:22)), so compression is a credible capability-preserving alternative, not a marginal encoding tweak. This also weakens the cross-document claim that LLP 0322 is the “real reduction,” since 0322’s candidate population is unsupported. Suggested fix: compare derived-record omission against a compressed closed container using final binary/package size, decode cost, startup latency, and memory before selecting the reduction mechanism.

- **minor — Summary/§1/§2b — the inventory contains several errors.** `registry.json` at 5,162,043 bytes—not the 4,084,811-byte whole flat—is the largest file. The `guide/reference/*` remainder is 1,043,567 bytes, not approximately 660,000. The served corpus has 158 non-flat Markdown pages, not 176 hand-written pages. The generated API Markdown plus diagnostics Markdown totals 2,283,844 bytes, not approximately 1.3 MB. Suggested fix: regenerate the table from the same manifest/file-set predicate used by the encoder and distinguish authored pages from generated projections.

- **minor — §2a/§3 — `/llms.txt` sizes are neither statted nor current.** They are hard-coded in a static string ([server.rs:10399](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:10399)); the whole-flat label still says 2.5 MiB. Recomputing them would change the response body, contradicting the stated body invariant. Suggested fix: either preserve approximate static labels or explicitly authorize and test that response change.

## LLP 0324

- **MATERIAL — §§2a–2d, §3, §5 — the named moves cannot produce the promised root while preserving every ratified word.** The ledger is 363 of 1,102 lines and 25,537 of 79,097 bytes—about 32%, not the bulk. Removing it plus every `Revised:` and `Related:` line still leaves 724 lines and 43,894 bytes. The proposed under-150-line contents omit ratified audience guidance, cross-cutting requirements, subsystem boundaries, reference apps, design principles, scale limits, and implementation direction beginning at [LLP 0000:430](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:430), [LLP 0000:567](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:567), and [LLP 0000:762](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:762). No destinations are named for this material, despite the preservation promise. Existing links already target several affected anchors, for example [LLP 0027:61](/Users/ccheever/projects/snapback/llp/0027-all-aboard-caltrain-demo.plan.md:61). Suggested fix: provide a disposition table for every existing heading—retain, move to a named authoritative document, or explicitly supersede—and include compatibility anchors or a citation-migration audit. Then remeasure the root.

- **MATERIAL — §2c/OQ2 — generated `Related:` destroys the field’s semantics.** LLP defines `Related:` as “nearby documents worth reading,” not a backlink or corpus inventory ([upstream LLP 0000:98](/Users/ccheever/projects/snapback/vendor/llp/llp/0000-linked-literate-programming.explainer.md:98)). `llp-orient` follows `Related:` one hop ([llp-orient:30](/Users/ccheever/projects/snapback/skills/llp-orient/SKILL.md:30)). A link-graph-generated header cannot determine semantic relevance and may expand one-hop orientation across most of the corpus; it is not “strictly more accurate.” Suggested fix: keep `Related:` curated and select the separate generated `llp/index.md`/backlink-index option.

- **MATERIAL — §2b/OQ1 — sub-LLP identity and foundation membership are falsely presented as alternatives.** `foundation/` contains links ([AGENTS.md:21](/Users/ccheever/projects/snapback/AGENTS.md:21)); `0000.000` can also be linked there. If it is linked, the 25.5 KB ledger remains in prescribed foundation-first orientation and much of the budget benefit disappears. If it is not, the RFC must reconcile that with the reconstruction truth hierarchy, where LLP 0000’s ratification ledger is the highest authority ([LLP 0286:324](/Users/ccheever/projects/snapback/llp/0286-clean-room-reconstruction-experiment.plan.md:324)). Moving it also changes citations from `LLP 0000#…` to `LLP 0000.000#…`; sub-LLP status does not preserve citation shape automatically. Suggested fix: decide identity, foundation membership, default-read status, and citation compatibility separately, then measure the resulting orientation path.

- **minor — Summary/§1 — the checkout measurements are internally inconsistent.** The root’s 1,102 lines, 79,097 bytes, 162 related LLPs, and 12 foundation entries are correct. The current checkout has 331 top-level Markdown documents and 21 meaningful `current/` entries, not 323 and 13; the batch itself added eight. The published status counts total 330, not 323. `guide/start/` is 25,949 logical bytes, or 20,950 Markdown bytes; 44 KB is filesystem block allocation and is not comparable to the root’s logical byte count. The first `Revised:` entry is about 28 words, not several hundred. Suggested fix: state a frozen inclusion predicate and compare logical bytes consistently.

- **minor — Summary/§6 and metadata — LLP 0259 is misattributed.** App builders are explicitly routed away from the LLP corpus ([AGENTS.md:3](/Users/ccheever/projects/snapback/AGENTS.md:3)); LLP 0259 scopes its first-read budget to cold app-building agents and makes telling them to read LLPs a non-goal ([LLP 0259:45](/Users/ccheever/projects/snapback/llp/0259-agent-first-read-budget.rfc.md:45), [LLP 0259:540](/Users/ccheever/projects/snapback/llp/0259-agent-first-read-budget.rfc.md:540)). Root compaction benefits Snapback-engineering orientation, not every agent or the LLP 0259 start packet. Also, local `LLP 0011` is the auth RFC, not the upstream corpus-overlay prior art. Suggested fix: reframe the audience and cite the upstream overlay document explicitly.

- **minor — §1 — the alleged status-vocabulary drift was not measured from metadata headers.** The cited nonstandard values are body-local `**Status:**` labels; `ref-check` reads the first metadata occurrence in its header window. Suggested fix: rerun this observation through the actual metadata parser before handing it to `llp-maintain`.

LLP 0322: NOT READY (3 MATERIAL)
LLP 0314.001: NOT READY (4 MATERIAL)
LLP 0324: NOT READY (3 MATERIAL)
SET: NOT READY
