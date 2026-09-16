# Independent pilot qualification

This is supervisor/grader material, not part of the builder's staged packet.
It operationalizes the unchanged public brief and fixture contract; it does
not add product requirements. All rows begin **not run**. The builder's
adapter or receipt boolean is evidence to inspect, never the verdict itself.
Qualification uses the completed pilot's ordinary authenticated application
surface and the neutral provider's actual records. Preserve private state,
original logs and journals. Do not print fixture tokens into public evidence.

## W3 admission witness

| ID | Observation required |
| --- | --- |
| W3.1 | A real invitation commit produces an actual sink email with a working token read from that email. |
| W3.2 | A different authenticated account is refused; membership and complete audit state remain unchanged. |
| W3.3 | The intended account accepts; membership and its audit entry are observed in the same committed state. |
| W3.4 | Reusing the accepted token is harmless: no additional membership, audit event or email effect. |
| W3.5 | Server-clock expiry under shortened windows refuses acceptance without a state change. |
| W3.6 | Revocation refuses subsequent acceptance without a state change. |
| W3.7 | Re-inviting an existing member creates neither a second membership nor an extra seat reservation. |
| W3.8 | Lost response after an actual commit, before replay-receipt persistence, recovers the same keyed result after restart; compare actual membership/audit/email state. |

## W5 admission witness

| ID | Observation required |
| --- | --- |
| W5.1 | Before a wrong-signature delivery, capture actual plan, seat limit, renewal, applied revision and complete stable audit digest. Observe a real non-2xx HTTP attempt and compare all five fields unchanged. |
| W5.2 | Repeat that intermediate observation for the unsigned delivery, before any valid identical-body delivery. A connection failure is not rejection. |
| W5.3 | The valid identical body is subsequently admitted; bad signatures did not consume its event ID. |
| W5.4 | A duplicate valid event does not change state or emit another audit event. |
| W5.5 | Out-of-order delivery leaves the newer revision and state; old/no-op deliveries emit no extra plan audit event. |
| W5.6 | All 200 canonical backlog events recover across receiver/provider restart, with exactly-once effective state and audits. A two-event conformance run alone does not pass. |
| W5.7 | Receiver restart after acknowledgement preserves the acknowledged state. Lost committed response and pre-dispatch 503 lead to retries with the original key/body, not duplicate effects. |
| W5.8 | Provider enqueue lost-response/restart recovery preserves the original delivery IDs and batch; no second batch appears under the same key. |
| W5.9 | Pending invitations reserve distinct-address seats; expired/revoked reservations release them; inviting beyond capacity is refused. |
| W5.10 | Acceptance rechecks membership and seat limit atomically, including a plan change after invitation. |
| W5.11 | Ordinary writes while past_due are refused; authorized reads and billing updates remain available. |

Each verdict records the command/probe, observed state, timestamp and private
receipt path plus a sanitized content digest. A failed or unrun row remains
failed/unrun even if the builder's acceptance entrypoint prints green. W3/W5
qualify only when every required observation is supported independently.

## Calibration and next-session boundaries

- Inspect the actual application and acceptance assertions for all W1–W7
  requirements, not just the admission witnesses above.
- Verify the full canonical action stream and all 2,000 large-org report rows
  through the same authorized adapter. Preserve every interrupted attempt.
- Require the five-probe sampling plan to predate sampling. Keep raw samples
  and host-load telemetry; do not turn missing or contended data into ceilings.
- Launch W8 as a new session on the finished pilot, with no prior transcript.
  It is not implemented in the W1–W7 pilot session.
- Freeze budgets/ceilings and the common public brief only after calibration.
  The first actual cell starts in a different empty application with a fresh
  model context and no pilot code or diagnosis hints.
- Pilot narrative and private lifecycle records retain explicit nulls/not-run
  outcomes. Before the actual cell, admit Workroom in the existing machine
  schema under protocol rule 7; do not port a general benchmark framework.
