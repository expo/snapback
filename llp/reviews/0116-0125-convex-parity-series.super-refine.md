# Convex-parity research series (LLP 0116–0125) review program journal

## Authorization

Charlie Cheever approved the tiered review program on 2026-07-30 and set
the READY bar:

> The READY bar I'm looking for is something like "We've really thought
> this issue and concept through as much as we can without writing code
> and running it to gather empirical evidence" as much as "there are no
> flaws in this."

Approved topology, per the author's message:

- **Full super-refine (multi-round, dual-family):** LLP 0122, 0123, 0117,
  0118 — they feed Tranche A (P0) and Tranche B's lead item; 0118
  additionally underwrites reviving a design that previously died in a
  review timeout.
- **Single-round dual-family pass:** LLP 0119, 0120, 0121, 0124, 0125 —
  one Fable + one Codex review each, verified fixes applied, no loop.
- **LLP 0116 last, delta-review only** — it is derivative; reviewed after
  sibling corrections propagate, using the delta-review stopping rule.

Starting the loop advanced the nine target Research docs (0117–0125) from
Draft to Review under that program approval. LLP 0116 stays Draft until
its delta review. The loop cannot advance any target beyond Review; all
status adjudication after the loop is the author's.

Reviewer configuration: Fable reviews come from fresh non-author Claude
(Fable 5) subagent contexts — the orchestrating session authored the
series via subagents and therefore does not count itself as a reviewer.
Codex reviews run via codex-cli 0.146.0 `codex exec` in a read-only
sandbox. Reviewers are mutually blind: neither reads any
`llp/reviews/` artifact for LLPs 0116–0125 nor any other reviewer's
output.

## Round 1 — 2026-07-30

Scope: all nine topic docs (Tier 1 round 1 of N; Tier 2 round 1 of 1).

Instruction capsule SHA-256 (shared verbatim by both families):
`30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`

Target SHA-256 vector (post-Review-status content, the text reviewers
read):

- LLP 0117:
  `72f18aebddeb24644938241533aaf60134e267b76af34bd8fef4dc0a62b1658a`
- LLP 0118:
  `3e1e2ce6951490156dafca4ae8bf6034a6f70c78762b6dc8bb806b0aff625d97`
- LLP 0119:
  `0afa360ef52e3b598c141efa77a055e7d3d3948a5162644bc8aaaee5a7340305`
- LLP 0120:
  `43bdb65cc7b7a411bf3db4c06f7ea5b20aa2b2f5793deb2ff4ed650efa14e82c`
- LLP 0121:
  `9dfa1164eafb71f49694e24629b34886f8cf48c4d6216ec48a5d8e6f0c3aa985`
- LLP 0122:
  `c41f584d37139c5d8544fd4a2cf1b3a75f1fe5317b99f35abf1cbecdc48bb815`
- LLP 0123:
  `b5cde08b1a1a33551c5f2d6f2bfde7624b824b88c134938cc6efa793730213e5`
- LLP 0124:
  `19348a3dbf8bb0d0d4bdd519490050dd0b51027b1377bf10354382849a1ab3ac`
- LLP 0125:
  `9161587d13febe4f5e156a32c438c810fa44ad2a43ea9d223230fb5d0cff2942`

Verdicts and dispositions are appended below as reviews are actually
received; no review is recorded by intent.
