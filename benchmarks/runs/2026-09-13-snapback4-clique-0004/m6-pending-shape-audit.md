# M6 pending shape audit

- Audit date: 2026-09-13
- Delivery revision inspected: `714027ef962ed667c2a983d816f232ecf1089ae3`
- Disposition: application-level shape expectation; no Snapback defect ticket
- Validation: static, read-only audit; no independent runtime reproduction
- Grading: independent benchmark grading remains pending

## Builder evidence and attribution

At epoch `1789328498`, the builder attributed the behavior to a Snapback 4 defect: the decorated `chat.history` result omitted `pending`, while a raw-row query retained it (`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/run-log.md:52`). That is the builder's attribution, not this audit's interpretation.

The retained raw evidence is:

- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/m6-offline-probe4.log` — SHA-256 `20e11c0347ed57ce45ecb2acbd6247d39cd38f3af30f4e3b6043b0457f7c55cd`; lines 55-57 show a predictable offline `chat.send`, a pending write state, and the decorated history row without `pending`.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/m6-choreo-attempt3.log` — SHA-256 `a094e620a046bdccaed7d113bb30b9dbfa76d29788916efbca7961a23f09f6b7`; lines 4-5 classify the missing displayed pending state as an application outcome.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/m6-choreo-attempt4.log` — SHA-256 `f6c4758085d9e045d6b7616dad4c3a25c2ac1ac3482a395f9b28efcf873946c0`; line 4 records a green M6 choreography result after the application combined raw pending rows with shaped history.

The builder's query originally returned the `messageCard` shape (`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/snapback/chat.q:104-105`), then added an unshaped `historyRows` query (`snapback/chat.q:296-298`). The generated API reflects the boundary: `historyRows` returns `Rows["messages"][]`, whose rows may carry device metadata, while `history` returns an explicit shaped object without `pending` (`snapback/generated/api.ts:204-207`).

## Auditor interpretation

Snapback documents `pending` as device-owned metadata on a row written by the current device, removed when the server confirms the write (`snapback4/packages/snapback4/README.md:727-731`; `llp/3000-snapback4.explainer.md:380-385`). The device stores that metadata on predicted rows (`snapback4/crates/snapback4-device/src/device.rs:138-164`), and generated raw `Rows` types expose it as `pending?: boolean` (`snapback4/crates/snapback4-lang/src/emit.rs:18-25`).

A Quarry shape is a projection into a new object; `*` spreads the row's columns (`snapback4/crates/snapback4-lang/src/guide.rs:623-639`). The binder implements that rule by expanding a row into `id` plus the table's declared schema columns (`snapback4/crates/snapback4-lang/src/bind/program.rs:527-530,564-570`). Because `pending` is not a schema column, a shaped result does not promise to preserve it.

The observed behavior therefore matches the documented API boundary. Combining the raw pending rows with decorated history is a conforming application pattern. This audit does not change the builder's recorded attribution or any benchmark score; independent grading remains pending.
