# LLP 0162/0163 merged C28 implementation review — Fable

**Reviewer family:** Fable
**Provider / runtime:** Anthropic Claude Code 2.1.223 CLI, model `fable`
**Date:** 2026-08-05
**Reviewed commit:** e60473b41159d639bb35ac926564ae49b64f9f51
**Reviewed tree:** 768221780693ee3594be315de0403e69e62932a7
**Verdict:** NOT READY
**Review scope:** Exact merged Track B operation-identity lifecycle against LLP 0162 rows 1–4, 13, 14 and LLP 0163
**Method:** Fresh mutually blind CLI review; HEAD and cleanliness were verified, `llp/reviews/` was barred, and no tests were run by the reviewer. This artifact records the response actually received.

## Blocking finding received

The generated tombstone schema rejected every real Host tombstone. Rust emits
required `counter: null` for `HostIncarnation`, but
`operation.identity-tombstone-v1.schema.json` required an integer and the
artifact corpus had no representative Host tombstone round trip. The reviewer
classified this as a qualification-surface correctness defect and required a
nullable-required schema plus an instance validation.

## Areas the reviewer found sound

- tombstone key/epoch/counter coherence and domain-separated digest
  classification;
- contiguous closed-prefix floor advancement;
- four-range/1,024-identity issuance and exact lost-response re-service;
- terminal and pending retained-replay guards;
- same-principal identity-null recovery and cross-principal nonterminal
  refusal; and
- explicit capability withholding.

The review also suggested clarifying that tombstones retain audience/epoch/
counter routing projections while omitting principal, authority, input, and
authenticator details. C29 applies that clarification. No performance process
ran on C28, and this verdict is not acceptance evidence.
