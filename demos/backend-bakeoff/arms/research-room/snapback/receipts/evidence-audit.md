# Research Room / Snapback evidence audit

The arm is a product-blocked result, not an incomplete green run. The full
generated sessions artifact requires `bounded_response_stream_v1` and is
refused before the listener binds. No scenario that needed application state
is reported as a pass.

- Direct evidence: generated artifacts, startup failure envelope, exact
  cleanup receipt, and the unchanged canonical 8/8 streamed-action control.
- Explicit GAPs: asset bytes/upload (`RESEARCH-02`) and semantic/vector
  retrieval (`RESEARCH-05`).
- Direct product failures: authenticated progress, collaborator observation,
  cancellation fencing, and the five settlement outcomes (`RESEARCH-06`,
  `08`, `09`, `11`).
- Downstream protocol failures: seed, outsider, keyword, citations, retry,
  cron, secrets, and performance could not execute after target admission
  failed. They remain failures in the frozen status vocabulary and were not
  silently inferred from code.
- Stop audit: no user data or secret was created before refusal; no
  cross-user disclosure, late patch, destructive cleanup, or false pass
  occurred.
- Control: the exact binary passes the repository's dev-auth streamed-action
  suite 8/8, localizing the defect to sessions capability admission rather
  than the stream host.

Confidence dimensions (0–2): actor/authority 0, transaction/conflict 1,
transport 1, offline/reconnect 0, settlement 1, target identity 2, cleanup 2,
artifact reproducibility 2. Total: 9/16.
