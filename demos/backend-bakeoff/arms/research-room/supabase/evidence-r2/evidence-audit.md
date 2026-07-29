# Evidence audit

- All 15 frozen scenario IDs have one r2 receipt and the aggregate count is 15.
- Seed receipt proves 2 rooms, 20 primary-room sources, 65,536 bytes per
  source, 32-dimensional embeddings, 3 actors, and 2 concurrent clients.
- Storage proof retains upload identity, byte hash equality, owner identity
  hash, deletion, and post-delete negatives.
- Outsider proof covers database rows, search RPC, Storage, and the private
  Realtime topic; Mallory observed zero progress events.
- Progress and collaborator receipts retain four durable rows and four Bob
  Broadcast payloads, plus transport attribution and terminal ordering.
- Cancellation retains settlement timestamps, three injected late attempts,
  three `false` results, and an unchanged authoritative row count.
- Retry and outcome receipts retain dedupe identity, attempt ledger, row
  counts, and all five distinct settlement states.
- Performance retains exactly 2 warmups and 7 recorded values for each local
  path. Hosted deployment and hosted cost remain an environment GAP and do not
  borrow local confidence.
- The original Stop-class builder incident remains separate from Supabase
  product `stopDefects`; its hashes, containment, scan, and rotation proof are
  retained under `evidence/`.
- r2 cleanup proves exact containers, volumes, network, runtime mirror,
  assigned ports, and credential values/patterns absent.
- No shared diary or aggregate report was edited by this worker.
