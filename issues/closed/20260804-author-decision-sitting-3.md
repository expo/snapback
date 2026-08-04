# Author decision sitting #3 — 2026-08-04 (sitting record)

**Status:** Closed at landing (provenance record). This file is the
provenance record for the 2026-08-04 author decision sitting #3 (Charlie
Cheever, with Claude Fable 5 recording and propagating). Every ruling's
propagation landed in one commit with this record; the propagation map at
the bottom says where each ruling lives. Modeled on
`issues/20260803-author-decision-sitting-2.md`, whose stated closure
criterion — close once the commissions the sitting opened have owners
underway — this sitting satisfies at landing: sitting #3 opens no new
commissions; every ruling propagates immediately into existing documents
and tickets, and the two execution items it touches are owned (the f7
rerun by a sibling agent, the 0146 strict-flag refusal by the open
tranche ticket's continuation).

Sibling work, same sitting: the **f7 HEAD-sha confirmation rerun and the
retry-storm fix** are executing concurrently as sibling work of this
sitting by another agent of the same session; ruling 1 records the
disposition here, and the sibling owns the f7 ticket
(`issues/20260801-0137-a1expo-f7-rn-connection-cycles.md`) — this
record's commit deliberately does not touch it.

## Rulings, 2026-08-04

1. **f7 disposition (0137 A1-Expo RN connection cycles): confirm at HEAD,
   then close the loop-half with the idle-hold receipt as a standing
   regression gate.** Run a HEAD-sha confirmation rerun with the existing
   harness, then close the loop-half of
   `issues/20260801-0137-a1expo-f7-rn-connection-cycles.md` with the
   60s-idle-hold receipt landed as a standing regression gate. Context:
   the 2026-08-03 simulator rerun already ran with the loss-detail
   instrumentation and the ticket held an author-gated choice between
   closing on that evidence versus waiting for a HEAD-sha confirmation;
   this ruling takes the confirmation path and converts the receipt into
   a permanent gate. A sibling agent is executing the rerun and owns the
   ticket edit; this record only fixes the disposition.

2. **LLP 0043 ratification point 1 — LLP 0053 queue-obligation
   ingestion: v1 stays server-refusal-only.** No LLP 0053
   queue-obligation (`pendingByScope`) suspension port on the JS arm; the
   named Contract-arm asymmetry stands as recorded in the design's
   asymmetry list. Context: the recorded design's matrix row 4 relies on
   server re-validation at replay, with the consequence that a
   delete-disposition invalidation strands a queued record only at replay
   time rather than at obligation delivery; the ruling accepts that
   consequence for v1 and directs revisiting only on evidence of
   meaningful refusal rates, not speculatively.

3. **LLP 0043 point 2 — `SNAPBACK_AUTH_STALE_RESULT` taxonomy: stranded,
   as recorded.** An authority-change refusal at replay surfaces
   client-side as *stranded* — a custody outcome with the re-record
   recovery affordance — exactly as the recorded design proposed;
   content refusals stay drop-and-mark-failed. Context: the design
   refined (without weakening — still terminal, never retried) the
   drop-and-mark-failed rule for the one refusal class the client could
   prove is an authority change; the ruling ratifies the refinement
   rather than collapsing every server refusal into `failed`.

4. **LLP 0043 point 3 — cross-principal disposition:
   delete-with-diagnostic-count.** A principal change is a privacy
   deletion boundary: queue namespaces are cleared before the successor
   can observe them, the cut is recorded as a diagnostic count visible to
   the process that performed it, and there are no redacted tombstones —
   nothing is retained for, attributed to, or replayed under the
   successor. Context: the alternative (payload-free tombstones for the
   predecessor's possible return) was rejected; Contract-arm parity
   argued for delete, and privacy deliberately wins over cross-principal
   observability.

5. **LLP 0043 point 4 — recovery affordance:
   read/discard/re-record-as-new-`clientMutationId`.** Recovery for
   stranded records is explicit and app-driven: a read surface for the
   current principal's own rerecordable stranded records, explicit
   discard, and explicit re-recording that mints a new
   `clientMutationId` under the current descriptor. There is no
   automatic re-submission and no exactly-once bridge across
   authorities. Context: the read+discard-only alternative was rejected;
   the affordance ships whole, while keeping re-recording a new intent,
   never a replay.

   **With points 1–4 ruled, the recorded design is RATIFIED whole.** The
   LLP 0043 §Auth posture subsection "JS-arm sessions-custody queue —
   Recorded design (2026-08-03, commissioned at author sitting #2)" is
   marked RATIFIED (2026-08-04, sitting #3), its four open alternatives
   are resolved with the rulings above (design text kept), and
   **implementation is now authorized as a lane** — tracked by leg 2 of
   `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` (which
   stays open). The design commission ticket is complete and closed. The
   JS arm's `SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED` fence remains
   the shipped behavior until the lane lands.

6. **LLP 0146 escape hatch: NO hatch in v1.** The boolean
   `strictDeclarations` strict-mode opt-in ships as-is; the
   per-dependency-class vocabulary ("explicitly conservative or
   unobservable classes") gets defined only when a real app hits such a
   class — evidence-driven. Context: the D1 slice shipped the boolean
   opt-in and accumulated the undefined class vocabulary as an author
   question; defining a vocabulary with no motivating case would be
   speculation, so the hatch waits for evidence. Resolves the first
   accumulated author question in
   `issues/20260803-0146-d1-d3-tranche.md`.

7. **LLP 0146 strict flag on non-enforcing targets: REFUSE AT LOAD with
   a named code.** On targets that cannot enforce `strictDeclarations`
   (the Cloudflare arm today), the manifest flag is refused at
   load/ensure time with a named `SNAPBACK_*` code — the flag must never
   ride through unenforced. Context: current behavior lets the flag ride
   through with the capability row stating the nonclaim; the ruling
   makes the nonclaim a refusal instead. The implementation item
   (load/ensure-time refusal with a named code, plus test) is added to
   the tranche ticket's next steps — it belongs to the tranche's
   continuation, not to this recording. This partially resolves LLP 0146
   OQ14 in the refuse direction: OQ14's broader question (what
   constitutes an authoritative capture on Cloudflare) stays open, so
   partial resolution only is noted. Resolves the second accumulated
   author question in `issues/20260803-0146-d1-d3-tranche.md`.

## Propagation map

| Ruling | Landed in |
| --- | --- |
| 1 (f7 disposition) | this record (disposition); execution + ticket edit owned by the sibling agent (`issues/20260801-0137-a1expo-f7-rn-connection-cycles.md`, untouched here) |
| 2–5 (0043 ratification) | `llp/0043-offline-replay-retention.rfc.md` (Revised entry; §Auth posture subsection header → RATIFIED; four open points → ruled outcomes; header-area recorded-design note updated; implementation-authorized language); `issues/closed/20260803-0043-sessions-custody-design.md` (resolution note, moved to closed); `issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` (leg-2 ratification annotation, stays open) |
| 6 (0146 no escape hatch in v1) | `llp/0146-agentic-authoring-affordances.rfc.md` (Revised entry; §Open questions sitting-#3 ruling block; dated note at the D1 escape-hatch text); `issues/20260803-0146-d1-d3-tranche.md` (first accumulated question → RULED) |
| 7 (0146 refuse-at-load) | `llp/0146-agentic-authoring-affordances.rfc.md` (Revised entry; §Open questions sitting-#3 ruling block; OQ14 partial-resolution note); `issues/20260803-0146-d1-d3-tranche.md` (second accumulated question → RULED; implementation item added as next-step 3) |
