# RT5 scoped LLP context pack

Scope: test-only Postgres literals, text decode, ordered-flight/envelope
witnesses; the existing commit-path experiment and the RT5 record.

Governing working-set documents: LLP 3000 §7 (one implementation and commit
order), LLP 3000.009 §4.1 (store fetches facts; Rust evaluates policy),
LLP 3000.009.001.000 §9.1 (adapter parity), and
LLP 3000.009.001.000.001 §3.5–3.6, §4, §6 RT5, §7 (command boundaries,
mechanism qualification, schedule and correctness). The round-trip child is
referenced by its current parent but has no separate current link at the base.

Binding constraints: owner fence first and raising on mismatch; head lock
before later command snapshots; separate generation and receipt checks;
no unchecked client verdict before COMMIT; COMMIT in its own flight (round-trip
§3.5). Typed values, terminal NUL refusal, explicit columns and test-proven
waits (parent §9.1 rules 1–9). No attach/serving change in RT5 (§6).

Rationale/evidence: S1b's k3, its 1 s/4 s/three-process method and observed
extended-protocol stall (experiment README, S1b). Counts alone do not qualify
latency (round-trip §3.6).

Open risk: loopback latency does not qualify the Hetzner path; RT6 must apply
connection output qualification, guard encoder scratch within existing memory
allowances, preserve the final client checks, and run the serving ratchets.
No raw-driver API is reopened for historical experiment code.

Doc updates: prepend RT5 to the one Revised line; §6 implementation note,
append-only journal entry, experiment commands and this report. Hand-off:
none for implementation; lead's network run remains before mechanism adoption.
