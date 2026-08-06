# LLP 0182/0184 round 5 review — Claude (Anthropic)

**Verdict:** NOT READY
**Bound to revision:** `c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81` (content sha256 of `llp/0184-agent-accessible-control-plane.rfc.md`, 1310 lines)
**Reviewer:** Claude Opus 5 (`claude-opus-5[1m]`)
**Blindness:** self-attested — read only my own family's round-1/2/3/4 reviews; did not read the other family's review or the run journal

Round 5 fixes the round-4 bug it was chartered to fix, and fixes it better than the correction prose claims: every clause of the `host.restart` anomaly disclosure was verified against the code and is accurate, including the parts unflattering to the RFC's own invariant. §3a's retreat to a hand-maintained-plus-audit posture is the right call and honestly stated. The `config.set` split's structural premise — that the shipped human-entry page writes the value itself, so nothing is handed to a later agent call — is true and genuinely closes round 4's open artifact question.

Four MATERIAL concerns remain. Three are the same failure mode round 4 had: a correct fix that never reached the other place in the document that asserts the opposite. The fourth is a new instance of the loop's recurring pattern — a persuasive justification whose named authority does not exist in the form claimed.

## Round-1/2/3/4 concern resolution

1. **`composedFrom`/`host.restart` false-ownership claim (R4-M1) — RESOLVED, verified independently against `src/server.rs:15531-15536`, `mcp-control.mjs:209-210, 785, 817-831`, and `src/host_ops.rs:58, 1446-1455`. The disclosed anomaly (HTTP refuses via `SNAPBACK_HOST_OP_CLI_ONLY`; MCP executes via direct binary spawn with no admin token) is exact.**

2. **Hosted leg + `apiOnly` sensitivity pin absent from enumerated rules/Acceptance (R4-M2) — RESOLVED.** Both now appear in rule 5, rule 10's trigger list, rule 11, and both Acceptance bullets.

3. **§3a's mechanical-enforcement claim against `gateway.js` (R4-M3) — RESOLVED in §Design/3a**, verified accurate against `gateway.js`'s five distinct dispatch idioms and LLP 0031's hosted table (one row short — network-profile — of `gateway.js`'s actual eight paths). **NOT propagated to the delivery plan** — see New MATERIAL 1.

4. **`config.secret.acquire`/`config.set` handoff artifact (R4, carried) — PARTIALLY RESOLVED.** The "disjoint paths" framing is structurally coherent and verified true against `setup.html:470-491`'s direct POST to `config/set`. What's unresolved is where `config.secret.acquire`'s authority comes from — see New MATERIAL 2.

5-7. Remaining prior-round items (rule 2's second manifest, `data.patch`'s tuple, derived-instance wording, `app.ensure.provision` keying, `acceptance.run`'s pairing, guide carrier, rule 9 split, LLP boundary items) — all resolved in prior rounds and unchanged; quantitative base re-spot-checked and still accurate.

## New MATERIAL concerns

**1. Phase 1 item 3 still instructs building the mechanism §3a proved impossible.** It says "Generate and enforce... against `gateway.js`'s actual dispatcher," directly contradicting §3a's "hand-authored table... not derived from parsing the dispatcher." Pure drafting fix — reword to match §3a and rule 11.

**2. `config.secret.acquire`'s cited authority doesn't exist.** LLP 0036 has no "Acquisition tiers" section (it's called "The automation ladder"); L0 is explicitly "the human does everything... without Snapback tracking the flow" (nothing to project); the mechanism the operation actually needs is L1, which 0036's own status block states flatly is "not built." The RFC also mints a rival status enum (`pending`/`complete`/`expired`/`cancelled`) where 0036 already has a closed `awaiting-human(reason)` overlay — violating the same discipline the RFC correctly applies to LLP 0158 and LLP 0146 elsewhere. **Needs the author's call**: condition on an LLP 0036 L1 amendment (like the 0158/0146 pattern), or drop the row from v1 — §P3 already works without it since completion is confirmed via `config.status`/`config.verify`.

**3. The restated authority invariant never reached §Security and ergonomics invariants**, which still carries the original, now-disproven "No projection creates authority... same result semantics" verbatim — the RFC simultaneously asserts and refutes its own central security invariant, and the copy a reader treats as normative is the false one. Pure drafting fix.

**4. `host.restart`'s worked `cliDeferralReason` is false about the code** — nothing structurally prevents a `snapback restart` CLI command (the CLI already has separate `Start`/`Stop` variants that operate exactly like the MCP tool's composition); the reasoning transplants an HTTP-specific fact ("a running server cannot restart itself over its own HTTP surface") onto the CLI, where it doesn't apply. One clause fix, or better: add `snapback restart` to the plan and retire the example.

## New DETAIL concerns

Rule 11's mechanism circularly described; `config.secret.acquire` has no `surfaceAccess` value despite Acceptance requiring exactly one; §Design/2's forward reference to a nonexistent "Phase 2 `host.restart` vertical slice"; `unavailable`/target-refused terminology collision in §A persists a third round; rule numbering split across §3/§3a; carried DETAIL items (mcp-control's own carrier, CI-rule phase-activation timing, `snapback dev` verb channel, `notAuthorFacing` mapping, the observed `adminSecretRead` fifth authority mode).

## Verification notes

Extensive re-verification of all round-4 fixes plus fresh checks all held. Found incorrect: Phase 1 item 3's wording, `config.secret.acquire`'s LLP 0036 provenance claim, the unamended Security-invariants bullet, `host.restart`'s deferral reason.

**On the last-round question.** MATERIAL 1, 3, and 4 are pure drafting — three edits, none touching a decision. **MATERIAL 2 needs the author.** Nothing in this round touches the RFC's approach. The two-field model has absorbed every operation shape five rounds of adversarial reading could throw at it without needing a third axis or a precedence rule, and the round-5 `config.set` split plus the `host.restart` anomaly disclosure are the two most honest pieces of drafting the loop has produced. The defects that remain are propagation failures and one bad citation, not a wrong design.
