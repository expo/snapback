# Evidence audit

- All 15 frozen scenario IDs are present exactly once.
- Final adjudication is 11 PASS, 4 explicit GAP, 0 FAIL, and 0 Stop.
- Every PASS has an authoritative check and retained evidence path.
- Every GAP includes a precise nonclaim; no custom fallback is relabeled as a
  native semantic, schedule, secret, or cleanup capability.
- The five performance paths each retain two warmups, seven raw samples,
  median, and nearest-rank p95 under the frozen small-workload claim scope.
- Alice, Bob, and Mallory are distinct hashed provider principals. Protected
  results were checked through scoped provider queries/subscriptions.
- Realtime is attributed to InstantDB's EventSource-backed `subscribeQuery`;
  one-shot reads are not relabeled as push.
- Cancellation includes an injected late user-scoped transaction and an
  authoritative zero-row proof.
- Cleanup is exact-target bound. All data/object/user counts are zero, actor
  tokens are invalid, assigned ports have zero listeners, and runtime state is
  absent. The remaining empty auto-expiring shell is disclosed as GAP.
- The retained secret scan found none of five exact credential/canary values in
  client, receipt, or evidence roots.
- CLI/process evidence follows the cross-lane amendment: no raw process
  arguments, browser storage, CLI status/config, or credential-bearing command
  lines are retained.
