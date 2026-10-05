# IT context pack

Scope: intermittent client fixtures and the production worker, local-query,
change-feed and expiry paths they exercise. Base is recorded in baseline/manifest.json.
The Snapback 4 fence excludes the older inventories/bootstrap.

Governing LLPs (settled corpus, not a new proposal):

- LLP 3000#publication-suite-under-contention: complete observations and state
  barriers; preserve seeds, assertions and performance bounds.
- LLP 3000#http-overload-diagnostics: classified admission/transport failures;
  idle-connection policy and the narrowly proved reused-socket retry.
- LLP 3000.009#52-schedules-and-durable-work: fenced action leases, stable
  step keys, reconciliation or parking after an uncertain provider outcome.
- LLP 3000.017#33-change-notification and #47-tests: ephemeral epoch changes
  wake interested queries; deadlines rerun complete answers; five acceptance
  trials keep their appearance, disappearance and request-count bounds.
- LLP 3000.014#5: source-envelope identity pairs retained/current rows.
- LLP 3000.016#2.2: local-first query publication and evidence/expiry fences.
- LLP 3000.023#10: observation work, same-key replacement and bounded retention.
- LLP 3000.007.001#3.11: oversized indivisible sync page recovery; refusals
  retain store/generation identity and do not become empty applied pages.

Current authoring facts are in packages/snapback4/SERVER.md (action context,
steps and uncertainty) and CLIENT-AND-OPERATIONS.md (query publication and
partition refusal). None grants exactly two attempts independent of lease
expiry, or permission to publish a value after its expiry fence.

Risks: the historical transport failures have no retained causes; a passing
isolation run cannot classify them. Wall-clock expiry acceptance must retain
component timing evidence. A retained-order mismatch may be a deliberately
stale local fallback; do not label it a fixture bug without its routing trace.

Likely updates: JOURNAL, the requested report and existing issue records;
update a governing LLP only if an implemented mechanism or guarantee changes.
Hand-off: none. Stop for an uncovered design decision rather than inventing one.
