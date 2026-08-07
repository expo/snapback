# LLP 0162/0163 merged C28 implementation review — Codex

**Reviewer family:** Codex
**Provider / runtime:** OpenAI Codex collaboration agent, `gpt-5.6-sol`, read-only review
**Date:** 2026-08-05
**Reviewed commit:** e60473b41159d639bb35ac926564ae49b64f9f51
**Reviewed tree:** 768221780693ee3594be315de0403e69e62932a7
**Verdict:** NOT READY
**Review scope:** Exact merged Track B operation-identity lifecycle against LLP 0162 rows 1–4, 13, 14 and LLP 0163
**Method:** Fresh independent static review; the reviewer was barred from `llp/reviews/`. This artifact records the response actually received.

## Findings received

1. **High — sessions-mode range transport was not automatic.** The request
   layer injected the current descriptor only on mutation routes; normal
   sessions callers therefore had their range request refused unless the
   application supplied the descriptor manually.
2. **High — the Host tombstone schema rejected the Rust wire representation.**
   Host identities serialize required `counter: null`, while the committed
   schema allowed only an integer.
3. **Medium — suppression SQL/JSON coherence omitted `terminal_at_ms`.** Host
   closure trusted that unchecked SQL projection, so corruption could shorten
   the declared receipt window.
4. **Medium — pending-writer rollback proof did not stage app/journal writes.**
   It proved absence of pending rows but not rollback of the publication set.

The exact commit had 2,127 passing Rust library tests and withheld-publication
checks, but these findings stopped it before performance. C29 repairs all four;
this verdict is not acceptance evidence.
