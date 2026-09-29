# PQ round 5 context

Applied `llp-orient` before editing the local observation subscription and its
publication tests. Read rounds 0–4 prompts/reports, the Snapback 4 command sheet,
NOT-DOING, journal and rules, the root/design brief, current client/reads cards,
and the complete Astra round-4 review. Grok was progress-only at startup.

Scope: `local.ts`, raw-handle deadlines and the final publication callback.
Governing documents: LLP 3000 §4 (Snapback 4 fence), LLP 2000.000 §7
(partition authority), LLP 3000.016 §2.2 (local publication), LLP 3000.019
§3.3 (answer ownership/deadlines), LLP 3000.023 §§3.1–3.6 and 7
(retention and scheduling), LLP 3000.029 §0 (shelved LV work).
The root is in foundation; 3000.023 is in current. The corpus survey is scoped
to this fence, with no Snapback 1–3 gates or runtime bootstraps.

Constraints: subscriptions apply the existing retention policy before queueing;
sweeps preserve the acquisition-only path. New episodes start at execution;
existing deadlines never renew. Cancellation at final publication must reject
without updating the watch. Scope/reset/floor guards, queue bounds and lifetime
remain intact. No contract, Rust runtime, meter, budget or LV change is needed.

Updated the existing LLP 3000.023 §7 to remove the obsolete separate-path claim
for raw resubscription. No new LLP or skill hand-off. Main was initially current
at 7f540f094; before qualification, merged DX through b7d05baff as 58e22c75b.
Both journal conflict sides were preserved. RL had not landed at that merge.


Grok completed during qualification. Final scope also includes local evaluation,
remembered ordering, online retry episode start, and their tests. LLP 3000.023 §7
now records change-version retirement without changing cadence-only refreshes.
Final main/review checks were current at b7d05baff with both review copies
unchanged. No new hand-off or scope outside the Snapback 4 fence.
