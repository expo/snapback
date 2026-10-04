# NZ context

Scope: Expo export wrapper, witness publication/custody/status, doctor output,
starter scripts/READMEs and the witness guide. Engineering Snapback 4; no app
authoring or engine/contract change. Base: WD `38d9bfe0de`.

Governing LLPs: [3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
(independent fence), [2000.000 §11–12](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(native boundary witness; measured loop), and
[3000.030 §13, §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-execution-nx-rounds-08-2026-10-02)
(bounded preparation and exact export proof). The root and native-proof LLP
are not linked in this checkout's foundation/current sets.

Active constraints and rationale:

- LLP 3000.030 §15: independently verify selected HBC on prime/offline/restart;
  exact native/dependency audit, conservative unknown-plugin fallback.
- LLP 3000.030 §15: wrapper/export/run leases, atomic publication rollback,
  durable creation intent, birth-bound cleanup, native supervisor/anchor custody.
- LLP 3000.030 §13: select only tool-created, recorded, leased simulators;
  never infer ownership from a name or reclaim another backend's port.
- LLP 3000 §4 and rules/RULES.md: no engine changes, budget increases or
  broad process machinery. The user's commission authorizes the background
  command, focused regression coverage and local measurement tools.

Risks: detach must transfer custody before command exit; supersession must
serialize through cleanup; publication must not claim a still-pending proof;
status must expose dead workers; sleep must invalidate execution and clean up
on wake. Darwin birth/signal and simultaneous-watchdog-destruction residuals
from §15 still apply. Simulator services are not ordinary inherited child work,
so QoS and foreground interference require measurement, not an E-core promise.
Current 0.4.12 dependency audit drift is independently ticketed by WD; use
the archived, checksum-verified 0.4.11 fixtures for matched warm comparisons,
and report the scope explicitly without weakening the audit.

Doc updates: dated §15 revision, append-only JOURNAL, starter READMEs,
`guide witness`, local report. Hand-off: none.
