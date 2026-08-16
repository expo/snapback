# Commission: separate broadcast-shaped from query-shaped realtime

**Opened:** 2026-08-15 · **Severity:** P2 design commission ·
**Source:** author performance-direction ruling 2026-08-15

For public or group-scoped feeds, Snapback currently reauthorizes and
reconstructs a full result independently for every ordinary data event, for
every subscriber. The author's direction: authorize at subscription
establishment and at authority transitions, then distribute compact committed
deltas to the fan-out set; keep the strict fail-closed lane for genuine
permission changes. Supabase Broadcast demonstrates the scaling benefit of
this split; Snapback can provide it without adopting Supabase's weaker
retained-delivery semantics.

Ask: author an RFC that decides
- the classification rule for "broadcast-shaped" (candidate: LLP 0209 §3
  class-1 authority-independent base + group-scoped establishment check —
  the same classification G0 builds; this commission must not fork it);
- the delta distribution mechanism's relationship to LLP 0209 §7 delta lanes
  and the DK-3 `live_delta` precedent (LLP 0008), and to the ephemeral
  realtime lane (`src/ephemeral.rs`) which already does
  authorize-at-establishment distribution;
- the authority-transition fence semantics for the broadcast lane (LLP 0200
  §2.4 unchanged vs a broadcast-specific variant);
- what the fail-closed lane retains exclusively (permission changes,
  per-principal shapes).

Depends on LLP 0209 G0's authority classification existing; sequence after
G0, alongside G2/G3. Related: LLP 0209 §§3/6/7, LLP 0200 §2.4, LLP 0008,
LLP 0170 (information flow).

---

**Resolved 2026-08-16.** Authored as
`llp/0268-broadcast-shaped-realtime.rfc.md` (Draft, v0.2) via the 2026-08-16
orchestration session, through a dual-family review loop (codex + grok, both
NOT READY round 1 with a convergent establishment-scope/instance-binding
MATERIAL, both READY on the v0.2 delta; artifacts in
`llp/reviews/0268-broadcast-shaped-realtime.*`). The RFC adopts LLP 0209
§3/G0's classification by reference and gates all implementation on G0's
exit, preserving this ticket's sequencing constraint. Acceptance is the
author's call.
