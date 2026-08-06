# LLP 0162/0163 C28 pre-merge implementation review — Codex

**Reviewer family:** Codex
**Provider / runtime:** OpenAI Codex collaboration agent, `gpt-5.6-sol`, read-only review
**Date:** 2026-08-05
**Reviewed commit:** eb6e143357310fed25dbfe9f612c8b5b505bc7d4
**Reviewed tree:** 87cf7072496f1c2e9eca884e8d1f5f5136bb608c
**Verdict:** NOT READY
**Review scope:** C28 operation-identity lifecycle repair against LLP 0162 rows 1–4, 13, 14 and LLP 0163
**Method:** Fresh independent static review; the reviewer was barred from `llp/reviews/`. This artifact records the response actually received.

## Findings received

1. **High — fresh-authority recovery could terminalize capacity-stranded
   identity-null intent.** Replay reused the durable predecessor descriptor;
   after reauthentication the server rejected it as stale and the generic
   catch marked the record failed. Required repair: same-principal atomic
   reauthorization or an explicit nonterminal stranded disposition, plus a
   successor-authority fixture.
2. **Medium — tombstone SQL/JSON coherence omitted the retained counter.** The
   table and writer retained it, but lookup did not compare the SQL projection
   to the tombstone JSON. Required repair: counter coherence and a corruption
   negative.
3. **Medium — pending writer proof gap.** Both writer seams called the shared
   guard, but only the terminal writer had a direct post-prune tombstone/floor
   regression. Required repair: an equivalent pending-writer fixture.

Focused Rust tests passed 10/10, the then-current JS capacity test passed, and
publication remained withheld. The findings were repaired before the merged
C28 review; this verdict itself is not acceptance evidence.
