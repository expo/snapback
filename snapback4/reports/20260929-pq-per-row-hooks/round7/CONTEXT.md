# PQ round 7 context

Scope: merge `origin/main` at `78bcc92c8` into PQ `6b71b7379`, preserving
RL rounds 0–3 and PQ rounds 0–6. Read Snapback 4's command sheet, root LLP,
NOT-DOING, journal, adopted rules, design brief, current client card,
operations manual, both lanes' latest reports and Grok's round-6 READY review.
Applied `llp-orient` read-only before merging.

Governing LLPs: 3000 §4 (Snapback 4 fence and budgets, current), 2000.000 §7
(partition authority), 3000.016 §2.2 (publication), 3000.018 §3.2 (background
presence and memory order), 3000.019 §3.3 (deadline custody), 3000.023 §10
(combined current retention/queue contract, current). No Snapback 4 foundation
entry exists; Snapback 1–3 proof gates do not apply inside this fence.

Active constraints: 3000.023 §10 requires unbounded plain revalidation and
bounded change-evidence replacement, both retaining policies, with a new bound
starting only at attempt execution. It also requires eight starts/eight active,
cancellation/lifetime release, dependency selection, change-version and pending
cut fences, immediate hard resets and withdrawn-deadline floors. 3000.018 §3.2
keeps presence on its background path; both its final publication and memory
write must respect change evidence. 3000 §4 keeps the 593,719 B gzip cap and
1,500-line source ceiling.

Risk: queued and in-flight changes must neither start a replacement's bound
early nor renew one already started. Old-replica reads must not clear pending
change evidence. Resolution: one coherent §10, both fences retained, targeted
interleavings plus both lanes' existing tests and the full requested proof.
No skill hand-off or additional approval is required. The user authorized the
merge, report, journal and local co-authored commit; no push or publication.
