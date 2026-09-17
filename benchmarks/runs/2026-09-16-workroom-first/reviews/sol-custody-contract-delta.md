# Workroom custody — independent Sol contract-delta review

Date: 2026-09-17
Reviewer: Codex gpt-5.6-sol, requested xhigh.
Native session: `01a0ad0c-063a-7bd3-8bcf-1b2842bbfb02`.
Reviewed: `197aa9c6b3a8f0e5a4d8db932b87957c8721a5f2` against unchanged runner/test bytes from `19cc2656f7`.
Received: 2026-09-17T02:15:00Z; process exit 0.

Continuation of the reviewer's own mutually blind native session. Documentation-only clarification; no other review was supplied. The original verdict is retained separately and not relabelled. Sol's first resume command refused an unsupported option before model execution; corrected invocation above produced the received verdict.
Only the received public answer follows; no private model thoughts are retained.

## Supervisor disposition

READY under the explicitly narrower diagnostic-only contract. No runtime evidence was generated.

## Received review

No remaining material findings under the newly narrowed diagnostic-only contract.

- The documentation now accurately describes the 30-second budget as covering signalling/drain polling from `_cleanup`, with active, crossing, and final snapshots separately bounded.
- Deadline exhaustion still records uncertainty and forces `custody.ok: false`.
- The historical hash is now correctly distinguished from the unchanged r3 runner hash.
- Unsafe group or PID signalling remains refused through identity revalidation.
- The sampled double-fork blind spot and reason-specific 124/125/130/143 exit behavior are explicitly disclosed.

This does not revise the prior verdict on the withdrawn hard wall-clock contract; the document correctly acknowledges that claim was inaccurate rather than retroactively satisfied.

No tests or runtime evidence were produced. HEAD and both unchanged source hashes match the supplied values.

**VERDICT: READY** for the clarified, bounded launcher claim.
