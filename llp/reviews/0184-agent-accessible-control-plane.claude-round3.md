(Verbatim result text from the round-3 claude-family subagent is recorded in
the run journal's round-3 summary and in the orchestrator's conversation
record. Full text below.)

# LLP 0184 round 3 review — Claude (Anthropic)

**Verdict:** NOT READY
**Bound to revision:** `1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030` (content sha256 of `llp/0184-agent-accessible-control-plane.rfc.md`, 1022 lines — I verified this myself with `shasum -a 256` and it matches the value supplied in my assignment)
**Reviewer:** Claude Opus 5 (`claude-opus-5[1m]`)
**Blindness:** self-attested — read only my own family's round-1 and round-2 reviews (`llp/reviews/0184-agent-accessible-control-plane.claude.md` + `claude-round2.md`); did not read the other family's review or the run journal

The two-field split is the right move and it survives most of the adversarial pass: I tested it against every operation the document names and against the registry, and `(cliOnly, direct)` for assets, `(mcpOnly, direct)` for restart, and `(cliOnly, mediated)` for `snapback admin link` are all now expressible as exact pairs where round 1 and round 2 had none. The domain predicate is right about `SystemApi`, right that `direct_runner.*` was never excluded, and right that `app.ensure.provision` is the unique operator-authority `AppData` operation. The §B fix is the strongest in the revision: the round-2 finding I filed rested on my citing LLP 0095's **T-AUTH-INVALIDATION** transition, and this revision correctly identifies that **T-RESYNC** is a different transition requiring only `subscription_id` — my round-2 concern was partly misfounded and the new text is more accurate than my objection was. The guide carrier is now buildable with a mechanism that already exists in the tree.

Four concerns remain, three of them defects the revision itself introduced. All are drafting-scale; see the closing note.

## Round-1/round-2 concern resolution

1. **`mcp-control` cannot serve build-matched guide resources (R1-1, still open after R2) — RESOLVED.**
   §Design/4:519-536 replaces the packaged snapshot with invoking the co-installed binary: "**The correct carrier avoids the duplicate copy entirely.** `mcp-control` already runs alongside a co-installed native runtime binary — `@expo/snapback-runtime-{darwin-arm64,linux-x64,…}` ship as `optionalDependencies` … `mcp-control` invokes that co-installed binary directly for guide content (spawning its stdio guide server as a subprocess, or a lighter guide-export subcommand) instead of shipping a second copy that could go stale."
   Every load-bearing clause checks out this time, and the mechanism already exists rather than being asserted: `packages/snapback-cli/package.json` `optionalDependencies` = `@expo/snapback-runtime-darwin-arm64` / `-linux-x64`; `packages/snapback-cli/index.mjs:176-178` holds the `RUNTIME_PACKAGES` platform map; and **`mcp-control.mjs` already imports and calls the resolver** — `:25` `resolveRuntimeBinary,` and `:460` `this.runtime ??= resolveRuntimeBinary({ runtimeBinary: this.runtimeBinary });`. `snapback mcp` is still the Rust subcommand reading the restamped embedded corpus (`src/cli.rs:811-813` `Mcp`, dispatched `:1728` → `crate::guide_mcp::run_stdio()`). The paragraph's diagnosis of why round 1's approach failed is also correct and matches what I found last round ("the packaged artifacts are checked-in outputs of a Node script, not restamped per Rust build"). "Build-matched by construction — there is no independent snapshot left to compare or mismatch" is true. Two residues are DETAIL, below (platform coverage; the *catalog*'s carrier, which this paragraph does not address).

2. **Domain predicate (R1-5, replaced by R2-M1) — PARTIALLY RESOLVED.** The `SystemApi` correction is right and I verified all three legs. `RouteClass` has exactly three variants (`src/server.rs:7172-7180`). `direct_runner.*` is `SystemApi` (`src/server.rs:14989-14994`, the `direct` closure), so §Design/3:406-408's "it was never actually excluded despite round 1's prose claiming otherwise — it is simply, correctly, in-domain" is accurate. The served guide is `SystemStatic`, not "not-`AppData`" (`src/server.rs:7959-7970` `served_guide_route` → `RouteClass::SystemStatic`), as are all five console/setup routes (`src/admin.rs:3694-3712`). And I confirmed by exhaustive scan that `app.ensure.provision` is the **only** non-`SystemApi` registry operation carrying operator authority. So "the one named exception" is correct about uniqueness. What is not resolved is that the exception is expressed at **route** granularity — see New MATERIAL 1.

3. **Rule 3 demands rows the domain cannot produce (R2-M2) — PARTIALLY RESOLVED.** §Design/3 adds the third leg I asked for and routes ownership correctly, but the mechanism sentence ("each such command's `clap` definition itself supplies the catalog fields") is a claim about code that does not hold — a `clap` definition supplies a command name, a one-line doc comment, and arg names/types/defaults, nothing more; no intent keywords, guide anchor, or behavior flags exist anywhere in those declarations. The decision is right; the carrier is asserted rather than designed.

4. **Disposition exclusivity/exhaustiveness (R1-3 → R2-M3) — PARTIALLY RESOLVED.** The surface/who split genuinely fixes the two holes I filed (`host.restart`, `snapback admin link`). What is not resolved is the case the revision explicitly reaches for as its proof — exposed-but-unbuilt (`acceptance.run`) — see New MATERIAL 2; and the `mcpOnly` archetype (`host.restart`) is mischaracterized — see New MATERIAL 4.

5. **Rule 2 fail-open, second console surface (R1-4 → R2-4) — RESOLVED.** Rule 2 now names both remaining surfaces via a second declared call-site manifest, with the same row-or-`uiLocal`-marker obligation.

6. **OQ3 asserts a v1 default §A does not contain (R2-M4) — RESOLVED.** §A now writes the rule explicitly and closes the hosted-derived hole, matching LLP 0158's actual text.

7. **§B requires a per-subscription generation that does not exist (R2-M5) — RESOLVED.** §B removes the invented generation; my own round-2 citation was to the wrong LLP 0095 transition, and the new text correctly identifies T-RESYNC vs T-AUTH-INVALIDATION.

8. **Rule 9 would break LLP 0061's passing surface-map join (R2-M6) — RESOLVED.** §Design/3 now states the split explicitly and keeps the currently-green check green.

9. **R1-2 (LLP 0146 remediation dependency) and R1-6 (LLP 0044 boundary)** were resolved in round 2 and remain resolved.

## New MATERIAL concerns (not in round 1 or round 2)

1. **The `app.ensure.provision` exception is keyed on a route that three operations share, so rule 1 both requires and forbids a row for `/app/ensure`.** All three `app.ensure.*` operations register the identical path with the operation selected from the request body (`src/server.rs:9116-9122`), so a route-keyed checker asked about `/app/ensure` must simultaneously demand a row (in-domain as `provision`) and fail on its existence (out-of-domain as `legacy`/`attest`). Fix: key the exception and rule 1's in/out test by operation identity, which §Design/3's own justification already says ("included by policy rather than route class") but the implementable rule does not carry through.

2. **The `unavailable ⇒ surfaceAccess: none` constraint forces exposed-but-unbuilt operations into `internal`, which is false of them.** `acceptance.run` is pinned unbuilt by LLP 0024, not unsupported/deprecated — `internal`'s definition ("unsupported... which supported operation, if any, replaces it") is false of it, while `unavailable`'s definition ("a known desired capability is not implemented") fits exactly. The constraint that forbids `(mcpOnly, unavailable)` is what manufactures the contradiction, not the pair itself — its own MCP tool already returns the pinned unimplemented envelope rather than a fake success, so the invariant the constraint exists to protect is already honored. Resolution: drop the `unavailable ⇒ none` constraint.

3. **The `apiOnly → native` promotion rule is unconditioned by response sensitivity.** `GET /_snapback/api/auth/mailbox` is `AdminWrite`/`CredentialSecret`/`ImpersonationCapability`, has no CLI/MCP/AdminClient projection today, and its whole point is that the agent *does* read the capture — so it is truthfully `(apiOnly, direct)`, not `mediated`. Nothing pins it there; enough usage evidence promotes it to `native`, minting a typed MCP tool whose ordinary result is credential plaintext, directly violating "No secret in convenience channels." Resolution: refuse promotion (or require an explicit authored override) when `responseSensitivity` is `CredentialSecret` or the effect is `ImpersonationCapability`.

4. **`host.restart` — the archetype chosen to prove `mcpOnly` — is a client-composed operation, not a thin projection of a registered one.** There is no server-side `host.restart`; `snapback_restart` synthesizes the envelope itself by calling stop-then-start (`packages/snapback-cli/mcp-control.mjs:817-830`). This is a live counterexample to "No projection creates authority... return the same result semantics," and Phase 1 generation would fail on the RFC's own chosen example under §Design/2's "conflicting facts fail generation" rule. Resolution: correct Phase 0 item 1's `CLI_ONLY_HOST_OPS` claim, state how a composed projection is represented, and/or pick a genuinely thin `mcpOnly` example.

## New DETAIL concerns (not in round 1 or round 2)

1. Research snapshot misses roughly half the in-domain `SystemApi` surface (48 routes found vs. ~half discussed) — scope-realism, not correctness.
2. Runtime-binary platform set is exactly two (darwin-arm64, linux-x64); the cold-agent guide criterion is provable only on those.
3. The *catalog's* own carrier in `mcp-control` (as opposed to the guide's) is still unstated — same fail-closed-identity risk that broke round 1's guide carrier.
4. `config.unset`'s disposition is stated two ways (P2 implies `native`, P3 says `(cliOnly, direct)`).
5. `mcpOnly`'s definition embeds one operation's justification as the general contract; belongs in `cliDeferralReason` instead.
6. Carried from round 2: no rule states when each CI rule activates across phases.
7. Carried from round 2: `snapback dev` verb channel still unenumerated.
8. Carried from round 1/round 2: still no mapping between LLP 0061's classification set and the new fields.
9. §A's "derived-instance leg stays `unavailable`" applies a row-level field to a *leg* of one operation; per-target eligibility belongs in `availability.targets`.

## Verification notes

Extensive fact-checks all confirmed correct, including: the per-row `_version` column and its CAS precedent in `src/storage.rs`; the domain-predicate facts exhaustively (all three `RouteClass` variants, `direct_runner.*` = `SystemApi`, `app.ensure.provision` as the sole exception); all four premises of the guide carrier; the `config.unset` handler quotation; LLP 0158's "solely for network-profile activation" text; LLP 0095's T-RESYNC vs. T-AUTH-INVALIDATION distinction; the inspect projection's exposed fields; every quantitative claim (17 tools, 41 host-op identities, 30 request spellings, 31 console actions); and the `availability.targets: ["local", "derived-hosted"]` example against LLP 0167.

Could not verify: apply-token storage/concurrency (still unnamed); whether a call-site manifest for `main.ts`/`setup.html` can be made mechanically closed rather than hand-maintained; whether OQ1's "no source-text parsing" criterion is achievable for the CLI-declared leg; effort realism/phase sizing (not a correctness question).

**On the last-round question:** All four MATERIAL concerns are drafting-scale and none touches the RFC's approach. The two-field split itself is sound — it survived every operation thrown at it, including the two shapes that broke round 1 and round 2. Two items would benefit from the author's judgment rather than another drafting pass: whether `snapback_restart` should remain a client-composed envelope at all (M4), and whether credential-secret-returning routes should be promotable at any threshold or pinned by policy (M3's risk appetite).
