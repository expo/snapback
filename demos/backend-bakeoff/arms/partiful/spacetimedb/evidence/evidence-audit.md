# Evidence audit

- Actor/authority: four distinct retained principal hashes; direct positive and
  negative reducer results; Mallory protected-view counts; Bob revocation
  cache eviction.
- Transaction/conflict: Bob and Casey cross the same two-promise barrier for
  one final seat; exactly one commits and one server reducer rejects.
- Transport: second-client generated-binding subscriptions observe event,
  guest-policy, RSVP-total, wall, asset, and revocation changes. Product polling
  is false.
- Settlement: reducer/procedure promises, confirmed reads, view settlement,
  receiver calls, durable ledgers, and direct SpacetimeSQL checks agree.
- Target: exact namespace, immutable database identity, version, schema hash,
  standalone endpoint hash, PID/cwd, and assigned ports are retained.
- Hosted: explicitly unavailable; no local evidence is relabeled as hosted.
- Cleanup: exact identity deletion, syntactically valid positional `describe`
  absence probe, target-only state removal, PID/cwd validation, and closed
  assigned ports are required before capsule completion.
- Secrets: raw tokens remain only under ignored `state/` with mode 0600 and are
  removed at cleanup. Retained artifacts contain hashes only.
