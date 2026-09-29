# DX round 1 context

Scope: dev refusal writer shutdown, console grouping regressions, managed dev
signals, and their current guide/manual contract. Used `skills/llp-orient/SKILL.md`.
The round 0 prompt and report still bind this round. Astra's complete NOT READY
review supplied the two findings; Grok's file is checked separately for completion.

Governing LLPs and constraints:

1. LLP 3000 §4 and §7: Snapback 4's independent workspace and checks; periphery
   changes here do not invoke the other Snapback versions' gates. The historical
   signal-handler decisions keep fatal-signal status and async-safe diagnostics.
2. LLP 2000.000 §6–8: authorization, metering and read outcomes remain the same.
3. LLP 3000.015 §2.1 (current overlay): dev-only, bounded asynchronous evidence;
   no caller/receipt disclosure, no rule reevaluation, no request-path I/O;
   empty answers stay quiet and unrecorded unless explicitly traced. Console
   windows and the queue/ring remain bounded at 32; live evidence must not claim
   stale or dropped records as the latest cause.

Rationale: the one-second console window creates buffered output that must be
flushed on managed shutdown. Channel disconnection cannot establish that boundary
while a long poll retains a sender. The server owns shutdown; the writer owns
all persistence and console formatting, including the final flush.

Decision: enqueue an explicit shutdown marker, await acknowledgement for up to
two seconds including queue admission, drain accepted records and bounded racing
handoffs, flush groups and release the live lock before acknowledging. Dev takes
the managed signal path even without an application worker. Production keeps its
prior signal behavior. Fatal signals and blocked diagnostic I/O have no delivery
guarantee. Requests finishing after shutdown begins are outside this boundary.

Doc updates: extend the existing §2.1; update the guide, signal-code description
and operations manual. Add phase and generation to console output so distinct
causes are identifiable. No new LLP, budget, public transport or gate. Hand-off:
none.
