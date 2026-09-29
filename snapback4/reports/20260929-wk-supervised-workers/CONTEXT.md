# Lane WK orientation

Scope: low-level effect delivery in `packages/snapback4/src/worker.ts`, CLI worker supervision, service-family custody, deployment, doctor and the social starter.

Governing LLPs:
- LLP 3000 §1/§7 (current): Snapback 4 fence, one interpreter, host ownership, tested guide and append-only journal.
- LLP 2000.000 §10 (current): effects are durable admission and external I/O belongs to a worker, outside the data plane.
- LLP 3000.007 §9.2 and §20.12 (current): conventional supervised worker, at-least-once execution, lease loss is opaque authority loss.
- LLP 3000.009 §5.2, §5.3 and §16 (current): stable work identity, durable steps, supervision and deployment-trusted service credentials. Extended in place for this change; §17's separately unaccepted scoped-credential proposal is untouched.
- LLP 3000.019 §3.6 (current): worker status and revocation may wait on the writer; HTTP admission must remain independent.
- LLP 3000.005 §3–§4: native jobs are metered wasm transaction chunks, independent of Node effect workers.

Constraints: existing claim/settle wire, retries, ordering, meters, authority and generated step reconciliation stay intact. No contract.ts changes; no wasm budget increase; no new LLP number; no push or publication. Core identity's host-only service check gains only the per-family lookup needed to retain the same revision fence for multiple children.

Rationale: builders repeat a detached launcher and JSONL completion set. Extend the existing source convention with `snapback/workers/<service>.mjs`, and add one opt-in ledger option. Existing `runWorker` and manually provisioned service seats remain standalone. No new config format, scheduler, JavaScript runtime or dependency installer.

Risks: provider commit and ledger commit cannot be atomic. One local SQLite file serializes opted-in handlers; separate disks do not share it. The file must survive release changes and backups. Deploy packages the named-worker source subtree, not imports outside it or npm dependencies. A last doctor report is not a live PID probe.

Doc updates: LLP 3000.009 §5.2/§5.3, effects (including worker alias), services/actions/programs/social cards, public package references and social starter README. Native jobs require no design change.

Hand-off: none. Used the read-only llp-orient skill from the available sibling vendor copy because this checkout's vendor symlink was uninitialized. No subagents or external review panel were commissioned.
