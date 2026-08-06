# LLP 0182 round 4 review — Claude (Anthropic)

**Verdict:** NOT READY

**Bound to revision:** `3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868` — verified via `shasum -a 256` at review start (1197 lines). **Note on a mid-review rename:** by review end, `llp/0182-agent-accessible-control-plane.rfc.md` no longer existed. A concurrent session landed `llp/0182-zerobugs-snapback-parity.research.md` and `llp/0183-zerobugs-quality-surface.rfc.md` on `origin/main`, and this RFC was renumbered to `llp/0184-agent-accessible-control-plane.rfc.md` (1197 lines, sha256 `05f5fa6be0fe5f0295be875a562a0ed41ef6fb11357ed1d07cdd21c285fe1edd`). The content delta is the document number only. Review binds to the hash verified at review start; every line number below is valid in both files.

**Reviewer:** Claude Opus 5 (`claude-opus-5[1m]`)

**Blindness:** self-attested — read only my own family's round-1/2/3 reviews; did not read the other family's review or the run journal.

The revision fixes the three round-3 defects I most doubted could be fixed cleanly, and two are now verified against code rather than asserted: `app.ensure.provision` operation-identity keying is right, and `data.patch`'s authority tuple now matches both LLP 0024's table and the shipped `authority_admin` constructor exactly. The `config.secret.acquire`/`config.set` split maps onto LLP 0036's own L0-L3 acquisition ladder more precisely than the RFC argues.

Three MATERIAL concerns remain, all in text this round introduced. Two are pure drafting; one needs an author judgment call.

## Round-1/2/3 concern resolution

1. **`app.ensure.provision` exception keyed on a shared route (R3-M1) — RESOLVED.** Verified against `src/server.rs:9117-9119`'s intent-dispatch.

2. **`unavailable ⇒ surfaceAccess: none` forced exposed-but-unbuilt rows into false `internal` (R3-M2) — RESOLVED.** `acceptance.run`'s `(mcpOnly, unavailable)` pairing is satisfiable end-to-end against `src/host_ops.rs:63-64, 1457` and `guide/surface-map.md:174`.

3. **`apiOnly → native` promotion unconditioned by response sensitivity (R3-M3) — PARTIALLY RESOLVED.** The pin is correctly policy-keyed (verified it also automatically catches `host_ops.auth.mintSession`, a second `CredentialSecret` row the RFC never names — vindicating the design). But it lives only in prose (§Product contract) — rule 5 and Acceptance's promotion bullet still state promotion with no exception. See New MATERIAL 2.

4. **`host.restart` is a client-composed operation, not a thin projection (R3-M4) — NOT RESOLVED; the fix's premise is false.** See New MATERIAL 1.

5. **CLI-leg carrier asserted rather than designed (R2-M2/R3) — RESOLVED.** A real, hand-authored, mechanically-enforced (via rule 3's enumeration) manifest is now named.

6. **Rule 2's second console surface — RESOLVED, honestly scoped** as v1's hand-maintained-plus-audit choice.

7. **`data.patch`'s receipt authority tuple — RESOLVED,** independently verified against `src/host_ops.rs:583-593, 607-620` and LLP 0024's table.

8. **Derived-instance target-rule wording — RESOLVED** across all checked locations (§A, §B, §C, Risks, Authority and scope, Acceptance, OQ3).

9. **Guide carrier and LLP 0044/0094/0095/0146 boundary items** — resolved in prior rounds, unchanged.

## New MATERIAL concerns (not in prior rounds)

**1. `composedFrom` is founded on a false claim: `host_ops.host.restart` *is* registered, and `snapback_restart` already declares itself a projection of it.**

`src/server.rs:15531-15536` registers `host_ops.host.restart` (`AdminWrite`, `SystemApi`); the request-spelling map resolves `"host.restart" ⇒ "host_ops.host.restart"` (`:15843`); `packages/snapback-cli/mcp-control.mjs:209-210` declares `operation: 'host.restart'`. So "there isn't one" is wrong, and "populated instead of `hostOps`" would drop a registered identity rule 1 requires a row for — self-defeating the rule the field exists to satisfy. The row's real anomaly is sharper than the RFC represents: the HTTP projection actually *refuses* `host.restart` (`SNAPBACK_HOST_OP_CLI_ONLY`, `src/host_ops.rs:1446-1456`, "a running server cannot start or stop itself over its own HTTP surface"), while the MCP projection *executes* it by spawning the co-installed binary with no admin credential gate at all — the same operation identity succeeds through one projection and always refuses through another, falsifying "No projection creates authority... return the same result semantics" for this and two adjacent identities.

**Resolution:** populate `hostOps` **and** `composedFrom` (additive, not substitutive); disclose the effective credential carrier per projection rather than one route-derived value; either carve process-lifecycle operations out of the "same gate" invariant or restate it as "no projection widens the authority its own gate enforces."

**2. Two round-4 fixes exist only in prose and never reach the enumerated CI rules or Acceptance, so the RFC could be marked Implemented with both unbuilt.** The hosted domain leg (§3a) and the `apiOnly → native` sensitivity pin are both absent from rules 1-10 and from Acceptance's corresponding bullets. Pure drafting fix: add a rule for the hosted leg, add it to rule 10's trigger list and Acceptance's completeness bullet, and add the sensitivity pin as an explicit clause of rule 5 and Acceptance's promotion bullet.

**3. §3a claims "the same shape as rule 2's `app.contract` check" applied to `gateway.js`, but `gateway.js` has no routing table to enumerate — and the RFC already conceded, 60 lines earlier, that imperative code can't be closed that way.** Rule 2's primary path is mechanically closed *because `app.contract` is declarative*. `gateway.js:94-263` is heterogeneous imperative code — exact-path checks, a `Set`, a prefix test (`path.startsWith('/_snapback/test/')`), two regexes, a catch-all — with no data structure to enumerate without an AST/source parse, which OQ1's own deciding criterion rules out. The reverse direction (manifest entry → real case) is achievable by runtime probing, which is also what LLP 0031 already designates as the hosted enforcement seam ("the Cloudflare acceptance suites are its enforcement seam"). The inventory half of §3a is sound and nearly complete (LLP 0031's hosted table is exactly one row short of `gateway.js`'s actual eight paths); only the enforcement claim is wrong.

**Resolution — needs the author, not another drafting pass:** either (i) give the hosted manifest the same honest hand-maintained-plus-audit posture rule 2 gives `main.ts`/`setup.html` (costs nothing, consistent with the rest of the document), or (ii) require `gateway.js` to dispatch from a declared route-table data structure (~15 cases, genuinely cheap) so the enumeration becomes actually mechanical — a real code change in another arm, belonging in the delivery plan. What cannot stand is claiming (ii)'s property while planning (i)'s mechanism.

## New DETAIL concerns (not in prior rounds)

1. Shortfall table's `Config set` row still asserts the pre-split "mediation problem" classification wholesale; needs a clause noting the split.
2. §P3 over-cites LLP 0036 on keyring/external-resolver carriers — those are v2+ in 0036, not available today; only stdin/fd is v1.
3. The split should be pinned to LLP 0036's own L0-L3 acquisition ladder by name (L1=`config.secret.acquire`, L2=`config.set`), reusing 0036's closed `awaiting-human(reason)` enum instead of implying a new one; also surface 0036's per-entry `humanCommitment` gating fact, which `operability` doesn't carry.
4. `config.unset`'s disposition still stated two ways (P2 implies `native`, P3 says `cliOnly`) — carried from round 3, unfixed. No `snapback config` CLI subcommand exists today, so both are `apiOnly` at Phase 1 backfill; the P2/P3 values are post-projection targets — should say so.
5. `mcpOnly`'s definition still embeds `host.restart`'s specific rationale as the general contract; now demonstrably over-narrow since `acceptance.run` is a second `mcpOnly` row with an unrelated reason.
6. "`unavailable`" used informally for target-refusal in §A and §3a, colliding with the closed `operability` value name; should say "target-refused" (carried by `availability.targets`) instead.
7. The `SNAPBACK_HOST_OP_CLI_ONLY` runtime diagnostic text carries the same false CLI-ownership claim Phase 0 item 1 only repairs in the allowlist comment — add the diagnostic text to the same repair.
8. §3a says the hosted manifest carries "the same required fields a `RouteClass::SystemApi` entry supplies automatically" — but per §Design/2 those fields actually come from multiple different owners (Guide manifest for intent, LLP 0024 registry for schema), not the route registry alone.
9. OQ3's premise names both `devUser` and `devAdminBypass` as pending the LLP 0158 grant, but §A's actual structure only conditions `devAdminBypass` that way.
10. Carried from prior rounds: the catalog's own `mcp-control` carrier still unstated; no rule states CI-rule activation timing per phase; `snapback dev` verb channel still unenumerated; no `notAuthorFacing`↔new-fields mapping.
11. Observed drift worth Phase 0 folding in (not a 0182 defect): the shipped code has a fifth authority mode, `adminSecretRead` (`src/host_ops.rs:595-605`), absent from LLP 0024's five-mode table — 0182 correctly claims it doesn't *add* one, but the code already did.

## Verification notes

Extensive fact-checks confirmed correct: the full `data.patch` authority-tuple fix against both LLP 0024 and shipped constructors; `app.ensure.*` intent-dispatch; `acceptance.run`'s full `(mcpOnly, unavailable)` chain; `/_snapback/api/auth/mailbox`'s policy shape; LLP 0031's hand-routed-Worker quotation and hosted route table (exactly one row short of `gateway.js`'s real eight paths); `admin-ui/main.ts`'s bootstrap call sites; LLP 0036's CLI/MCP config shape and explicit `agent` audit-source value (the strongest single piece of support for the `config.set` split that the RFC doesn't cite); all quantitative claims re-counted (41 host-op identities, 17 control tools).

Found incorrect: §Design/2's "there isn't one" about `host.restart` (MATERIAL 1), and §3a's "same shape as rule 2" claim (MATERIAL 3) — both the same recurring pattern: a persuasive fix whose named mechanism doesn't hold against the code it names.

Could not verify: whether some cheaper-than-AST enforcement exists for `gateway.js` (didn't survey JS tooling options); apply-token storage/concurrency (still unnamed since round 2); other hosted-arm entry points beyond `gateway.js` (didn't audit all of `coordinator.js`); effort realism.

**On the last-round question.** MATERIAL 1 and 2 are pure drafting. **MATERIAL 3 needs the author's judgment call**: hand-maintained-plus-audit (consistent with rule 2's own v1 posture and LLP 0031's designated hosted enforcement seam) or a real `gateway.js` code change to make it genuinely declarative. Nothing here touches the RFC's approach — the two-field model has survived four rounds and every operation shape thrown at it, and the `config.set` split is the cleanest structural fix the loop has produced.
