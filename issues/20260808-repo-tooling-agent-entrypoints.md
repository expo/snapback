# Repo tooling: swallowed sync failures, unarmed hooks, no entry-point index, opaque proof progress

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 (items 1–3) / P2 (rest) · **Area:** scripts/ / .githooks/ / verify-local-proof

From the 2026-08-08 agentic surface audit (LLP 0202 theme 10). Distinct from
the deferred items in `issues/20260808-tooling-robustness-papercuts.md`
(drift-backstop lock/path, login-shell admin gate, ref-check skip counts,
capability-maturity range narrowing — not repeated here).

1. **`sync-agent-skills` reports success after refusing to link.**
   `scripts/sync-agent-skills:38-46`: a populated-dir/non-symlink target gets
   a stderr warning and `return 0`; control falls through to
   `Synced agent skills…` + exit 0 (`:95-97`). The checkout/merge hooks only
   react to non-zero exits (`.githooks/post-checkout:9-11`,
   `post-merge:9-11`), so the skills every agent depends on can be silently
   absent forever. Fix: count refusals; exit non-zero (or print
   `PARTIAL`) when any link was refused.
2. **Nothing verifies `core.hooksPath` is armed.** `AGENTS.md` instructs the
   `git config`, but no check asserts it — a fresh clone/worktree pushes
   with zero frozen-record gates and no warning (the 2-hour backstop
   detects only after the push). Fix: in `sync-agent-skills`, emit a
   one-line stderr note when `git config --get core.hooksPath` ≠
   `.githooks`, matching its existing `vendor/ibex` hint pattern (`:90-93`).
3. **`--help` on the main shell entry points is a trap.**
   `scripts/verify-local-proof:46-49` rejects unknown args without printing
   the flags it accepts (`--keep-going`, `--complete`, `--affected REV`,
   `--selection-receipt`, `:19-51`); `scripts/bootstrap-ibex-runtime` parses
   no argv at all, so `--help` silently starts the full multi-minute
   bootstrap; same for `check-generated-artifacts`, `check-generated-types`,
   `check-demo-surfaces`, `cold-clone-check.sh`. Fix: add `--help` + unknown-
   arg rejection to the five bash entry points.
4. **No `scripts/README.md`.** 89 entries; ~17 are real agent entry points,
   72 are gate implementations, and nothing distinguishes them.
   `scripts/local-proof-selection-policy.v1.json` could seed the index. Fix:
   a ~40-line README with two tables (situation → script; gate internals).
5. **Proof progress/re-entry.** 130 `run` gates print per-gate state but no
   `i/N` position and support no `--gate ID` re-run (sibling
   `drift-prone-gates.mjs backstop --gate` exists); the
   `SNAPBACK_PROOF_KEEP_GOING`/`SNAPBACK_PROOF_RESULTS`/JSONL surface is
   documented only inside `.github/workflows/local-proof.yml`; the
   `--affected REV` fast path the LLP 0189 cadence tells agents to use is
   documented nowhere an agent looks. Fix: pass the selected count into
   `proof_runner_init`; accept `--gate`; add the flag/env table to the
   README verification section (incl. `CHROME_BIN`,
   `SNAPBACK_IBEX_CHECKOUT`, `SNAPBACK_EXACT_ROOT`).
6. **Smaller:** hooks no-op silently when the sync script is missing/lost
   its exec bit (`.githooks/post-checkout:5-7` — contrast `pre-push`'s loud
   refusal); `install-drift-backstop-schedule` has no `uname` guard (raw
   `launchctl: command not found` on Linux) and no `--status`/`--uninstall`;
   `scripts/vector-search-reference.mjs` is referenced nowhere in the repo
   (delete or name its consumer).
