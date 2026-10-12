# Integration 5 independent review, round 1 — gpt

Reviewer: gpt-6.1-sol; reasoning effort high.
Received: 2026-10-12T17:12:20.318194+00:00.
Scope: uncommitted merge of c5a3095e70 into e82bb70b97; read-only fresh session, mutually blind.
Invocation: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < /tmp/sb4-integration5-review.txt`.
The response below is preserved verbatim; no author acceptance is inferred.

## Verbatim response

**NEEDS_CHANGES**

Two correctness gaps from the incoming parent remain in both the index and working tree:

1. **Unproved inserts can still produce a final output refusal.** [local.rs:172](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/engine/local.rs:172) charges output after the `unproved_write` refusal check. An unproved supplied-id insert followed by output exceeding 1 MiB returns local `E_BOUND`; the server can instead refuse the hidden collision with `E_RULE`. Apply the conservative `E_PREDICT` handling to output-pricing failures too.

2. **System reads still price expired keys.** [authorized_point.rs:176](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/engine/authorized_point.rs:176) opens metered scans using a cursor advanced over expired rows at line 182. [word_heap.rs:275](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/engine/word_heap.rs:275) charges those bounds. An expired row preceding a live row therefore changes heap usage; interleaved expired rows can add scan-opening charges. Sweeping can change cuts or refusals, contrary to §20.24.6.

Two fixes exist only unstaged:

3. **The staged strict codec census fails.** Index line 240 of [wasm-codec-census.mjs](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/wasm-codec-census.mjs:238) still allowlists the removed direct serializer call. Executing the census against staged blobs reports `stored_value_bytes consumed 0 times (expected 1)`. The working-tree removal fixes this.

4. **The staged wasm budget lacks the requested headroom.** [wasm-budget.json:2](/home/ccheever/projects/snapback-sb4loop/snapback4/metrics/wasm-budget.json:2) remains **679,918 B** in the index. Against the working-tree record’s **679,912 B** measurement, that leaves **6 B**. The **680,412 B** measurement-plus-500 update is unstaged. I did not independently measure wasm.

CUT’s prepaid prefix handling and interrupted-predicate retry, nightly changes, and both parents’ substantive journal/LLP additions appear preserved.

Verification executed: working-tree codec census **27/27 passed**, staged-blob census failed as above, scoped diff whitespace check passed. No Cargo or full qualification executed; correctness findings are from inspection. No files changed or excluded reports read.
