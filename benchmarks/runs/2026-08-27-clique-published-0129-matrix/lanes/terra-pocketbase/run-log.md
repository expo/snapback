lane=terra-pocketbase
model=terra
effort=terra medium
backend=pocketbase-0.39.9/0.27.3
start=1787852996
2026-08-27T00:00:00Z knowledge lookup | published PocketBase binary help | environment | resolved Linux amd64 because actual host is Linux x86_64, despite macOS lane text
2026-08-27T19:51:22Z server | PocketBase PID=2832930 port=48160 | environment | pocketbase.log
2026-08-27T19:51:51Z correction loop | Express 5 wildcard route rejected | agent-error | web.log
2026-08-27T19:52:00Z server | Clique web PID=2833625 port=48161 | environment | web.log
2026-08-27T19:52:14Z M1 start | implementation and seed attempted | agent-error | receipts/suite-m1.json
2026-08-27T19:52:14Z M1 capability-failure | suite is intentionally only a smoke check and no browser choreography receipt exists; frozen harness dependencies are absent and instrument is read-only | environment | receipts/suite-m1.json
2026-08-27T19:52:14Z M2 blocked-by-M1 | prerequisite failure | ambiguous | run-log.md
2026-08-27T19:52:14Z M3 blocked-by-M1 | prerequisite failure | ambiguous | run-log.md
2026-08-27T19:52:14Z M4 blocked-by-M3 | transitive prerequisite failure | ambiguous | run-log.md
2026-08-27T19:52:14Z M5 blocked-by-M3 | transitive prerequisite failure | ambiguous | run-log.md
2026-08-27T19:52:14Z M6 blocked-by-M1 | failed prerequisite set M1,M2,M3,M4,M5 | ambiguous | run-log.md
2026-08-27T19:52:14Z M8 blocked-by-M6 | prerequisite failure | ambiguous | run-log.md
end=1787853134

2026-08-27T19:52:15Z shutdown | stopped recorded PocketBase PID=2832930 and web PID=2833625 | environment | run-log.md
