## 2026-07-29 — staged Linux package and external Chat confirmation

I rebuilt the frozen Snapback source on Linux, staged the dry-run package
closure as `0.1.1-llp0102.1`, and ran the frozen Chat app from a clean external
copy on assigned ports `33102` and `43102`. All Snapback imports resolved from
the external `node_modules`; start, restart, and stop used the installed
`snapback` command and installed Linux runtime. The project had independent
HOME, XDG roots, npm cache, runtime state, browser state, and evidence paths.

The final result was 14 passes, 1 declared gap, and no failures across all 15
expected checks. Seed shape, private-channel authority, authoritative sends,
native durable push, stable pagination, native ephemeral typing and presence,
reconnect, cross-client unread markers, concurrent sends, logout, revocation,
performance sampling, backup evidence, and exact cleanup passed. The one gap
was cold offline history: the protected membership-gated live query is not
retainable through the React Online surface, so a fresh offline client has zero
trusted retained rows.

What felt good:

- The installed runtime handled a genuinely broad realtime workload. Durable
  WebSocket updates, ephemeral TTL overlays, multi-client unread state,
  concurrent sequence allocation, sessions, revocation, browser personas, and
  restart recovery all ran through the real backend.
- Bundle and binary provenance remained unusually inspectable. Both starts
  proved the exact frozen clean release and exact generated app bundle.
- Failure boundaries were strong. Outsider private reads and subscriptions,
  logout, and membership revocation all failed closed rather than degrading
  into UI-only hiding.
- Final cleanup was narrow and mechanically provable: the app-owned runtime and
  persona carriers disappeared and the assigned listeners were gone.

What felt bad or frustrating:

- The same package and Linux preparation issues observed in Todo apply here:
  exact Hermes bootstrap required lane-local native development dependencies;
  isolated HOME needed explicit Volta binding; and
  `@snapback/client/online` lacked a public TypeScript declaration.
- The external lifecycle needed custom package-only glue to bind assigned
  ports, capture the process-bound impersonation capability, verify binary and
  bundle identity, and prove shutdown. Those are normal installed-product
  needs and should be first-party.
- A collaborative `0002` umask produced a startup artifact Snapback rejected as
  group-writable. That refusal was correct, but the diagnostic hid the precise
  predicate and made the correction slower to discover.
- Installed `snapback stop` left its owner-only secret-read root until the
  frozen arm removed the whole scoped runtime directory. The final state was
  clean, but the lifecycle boundary is surprising.
- The burst of 20 messages had a roughly 20.9-second median on this local Linux
  target, much slower than the single-event realtime path. This needs careful
  centralized interpretation rather than being hidden by the overall pass.
- The frozen performance receipt falsely labels this Linux x86_64 run as a
  `Mac17,3 arm64` workload. A companion environment receipt corrects it; the
  samples should carry reduced confidence until the shared harness derives
  machine identity dynamically.

Relative to Convex or Firebase, Snapback's combination of durable push and
native ephemeral overlays is conceptually attractive for chat: I did not need
to model typing/presence as durable rows, and authorization stayed part of the
backend contract. The tradeoff is maturity around the paved path. Package
typing, lifecycle orchestration, Linux preparation, burst throughput, and
offline retained history all need to become boring before Snapback can be the
default choice.

Improvement candidates for synthesis:

1. Ship complete declarations for all public package exports.
2. Promote installed-runtime start/provenance/stop into a supported package API
   with structured identity and cleanup receipts.
3. Remove process-bound secret sidecars during `stop`, or explicitly classify
   and manage retained lifecycle artifacts.
4. Add protected-query retained history with an authority-safe invalidation
   story.
5. Profile and improve serialized/concurrent message mutation throughput.
6. Preserve the strong split between durable chat history and ephemeral
   typing/presence while making multi-instance semantics first-class.
7. Derive evidence machine metadata dynamically.
