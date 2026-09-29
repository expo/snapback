# EA round 6 context

Scope: local identity admission and its detecting tests. Used llp-orient and
read rounds 0–5's prompts/reports, the full Astra round-5 review, the Snapback 4
command sheet, NOT-DOING, journal, adopted rules, root LLP 3000 and LLP 2000.000.
The current client, writes and why E_ADMISSION guide cards and operations manual
still describe the round-3 memory-only wait.

Governing LLPs (in current/, none in foundation/):
- LLP 3000.007 §20.4: bounded memory-only wait, first-identity pins, final
  revalidation and ordinary admission. This later ruling supersedes the earlier
  durable pre-identity design.
- LLP 3000.013 §6 and §13.3: store-bound ordinary delivery and custody.
- LLP 3000.019 §3.3: observable pending writes.
- LLP 3000 §4 and §6: scope fence, budgets and preserved simulator invariants.

Active constraints: retain the independent schema, store, generation and pinned
backend-fingerprint checks (LLP 3000.007 §20.4); keep ordered interpreter bodies
ordered while treating key/program order and server execution annotations as
representation. Deadline enforcement applies after initial and final I/O even
before overdue timers execute (same section). No durable pre-identity custody,
new public vocabulary, weaker refusal, changed authorization, prediction,
ordering or deduplication. No raised budget, reduced model count, push or publish.

Rationale: device restore serializes core::ir::Program, whereas /schema enriches
it with server execution metadata and declaration order. Refreshing the same
backend must not signal replacement. The real regression crosses offline reopen,
final identity I/O, reconnect and production native installation before admission.
A wall-clock-only advance models suspension without timer delivery.

Integration: fetched origin/main 283be371e98288c9119f1c9af227e0a060e07862 and
merged it in f1ac03ae467d00816b8a5778be29e9e88fcbdbbf before edits. Both histories
remain; only issue records arrived, with no conflicts. No await changed, so no
boundary-manifest regeneration is needed; the delivery matrix checks its census.

Doc updates: existing LLP 3000.007 §20.4 and operations manual clarify semantic
comparison, plus this report and one append-only journal entry. Guide wording
already covers the preserved public contract. Hand-off: none. No open design
question or delegation.
