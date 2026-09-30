# Round 3 context

Scope: local detached observations, shared observation scheduler, scope composition
and table/group dictionaries. Snapback 4 fence; Snapback 1–3 gates do not apply.

Governing LLPs: 3000 (root, current), 2000.000 §7 (partition authority),
3000.023 §10 (current answers-stay policy and bounded observation work, current),
3000.016 §2.2 (local/server routing), 3000.018 §3.2 (ordered recovery memory),
3000.019 §3.3 (sharing and fallback). The client guide is the current paved form.
The PR round 0–2 prompts/reports and full Astra round-2 review were read.

Constraints: LLP 3000.023#10 retains eight starts/turn and eight active attempts,
local queue-excluded retention, immediate hard withdrawals, audience precision,
closed facade deadlines and inspection opt-in. LLP 3000.016#2.2 retains query
routing and publication fences. LLP 3000.018#3.2 retains remembered-answer order.

Rationale: a saved detached answer cannot account for evidence it missed;
conservatively discard it after any client evidence, even unrelated evidence.
Read the actual watermark rather than mirror another publication cut. The getter
must not add detached state that only a live-map publication can clear. Urgent
work needs bounded overtaking to preserve ordinary-read progress.

Risks: one device metadata read on detached resumption; online change
notifications remain table-wide, so full capacity can still withdraw authorized
siblings. Plain refetch, precise local scope matching and actual read authority
remain unchanged. Dictionary keys are data, not Object.prototype properties.

Updates: LLP 3000.023, client guide/reference, journal and round3 report.
Hand-off: none.
