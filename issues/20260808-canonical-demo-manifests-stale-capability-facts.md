# The canonical todo demos' manifests declare capability facts false for months

**Opened:** 2026-08-08 · **Severity:** P3 (example-content drift)

Both guide-canonical todo demos' machine-readable manifests still assert
2026-Q1-era capability gaps:

- demos/todo/demo.snapback.json:65-70 and :107ff, and
  demos/todo-v2/demo.snapback.json:74-78 and :115-125, state
  `"react": { "requirement": "blocked", "expectedDiagnostic":
  "REACT_ADAPTER_NOT_BUILT", "note": "React/Expo adapter is a capability
  gap in v0" }` and list `react_adapter`, `assets`, `cron`,
  `notifications`, `external_auth` under `capabilityGaps` — all shipped
  per guide/capabilities.md (clients.react "shipped"; assets/cron/expo-push
  pages exist).

guide/index.md names these demos as its first two examples; an agent that
trusts examples over prose (which agent-first docs train it to do) reads
the floor reference app's manifest saying the React adapter doesn't exist.

Related, same slice: demos/todo models the legacy bundled-handler authoring
form (`defineJsLiveQuery({ source: 'handlers.mjs', … })`,
demos/todo/snapback/functions.mjs:24-35, imports via the demos/_kit shim) —
deliberate, but unlabeled at the demo level; a "legacy form on purpose —
start from demos/todo-v2 or the templates" line at the top of its README
would stop cold agents absorbing the legacy shape.

Ask: refresh both manifests against current capability truth (or scope
`capabilityGaps` explicitly as "gaps at the time this demo was scoped"),
and add the legacy-form banner to demos/todo.

Found by the 2026-08-08 comprehensive docs review (templates/examples slice).
