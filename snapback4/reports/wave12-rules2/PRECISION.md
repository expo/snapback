# RULES2 wave-12 precision

`check --json` ran in 100 independent copies of final `snapback/*.q`, with no
fixtures, stores, generated artifacts or writes in the evidence lanes. Every
schema passed before (`c22dfefc9c`) and after (`45c2936e64`), with the same 324
notes. The compressed raw results, per-schema source hashes and census are
beside this file. New notes by code: **N_WRITE_DENIED +0;
N_LOOKUP_NEVER_VISIBLE +0; every other code +0**. New refusals: zero.

Precision for new firings on the final-schema corpus has no denominator: there
are no firings. Do not call that a measured 100% precision rate. The tests
exercise positive contradictions and admitted near misses independently.
For alice's private row, bob/carol/service:ops each pass `owner != viewer`:
the update fails its table authority (public hidden-target answer NOT_FOUND),
while the nullable lookup is null and its non-null branch does not execute.
The physical row remains unchanged. Equal numeric spellings and effectful condition helpers have admitted-runtime regression witnesses. Unknown alternative guards, rebinding,
intervening writes, jobs, mutable-next-image admission and nullable snapshot
fields remain quiet. Eleven named composition tests cover these boundaries.

Read-only sample audit:

- **021 wedding-toast-order:** the final slots rule admits a null-successor tail
  to a caller without their own slot, so offerToast's nullable tail lookup can
  legitimately succeed. Staff are also readers. Treating it as always hidden
  would be false; the new proof emits nothing. The former friction is explained
  by the slot-audience advice, not by inventing a contradiction in the final fix.
- **018 film-location-releases:** caller/business-role gates do not by themselves
  prove that the caller differs from a stored owner; parties can coincide.
  Missing rule evidence is not a theorem that no admitted caller can update.
- **045 dataset-embargo-ledger:** requests.update explicitly admits the owner
  **or requester** in the repaired final schema; requestAccess's upsert update
  arm is intentionally legal. No new note is warranted.
- **055 secret-dice-log:** keyed reference identity and hidden sheets do not
  justify guessing that owners and callers are distinct. No new note is emitted.

The checker is a bounded contradiction prover, not a whole-language
satisfiability checker. Its safe quiet boundaries are stated in LLP
3000.036.002 §9. A role that was not required might still be held; an arbitrary
principal argument might equal viewer. The implementation never calls those
writes impossible.
