# LLP 0167: remaining acceptance corpus and later stages

**Opened:** 2026-08-04
**Systems:** Server, Cloudflare arm, Agent experience, Acceptance testing
**Related:** LLP 0167, LLP 0024, LLP 0042, LLP 0017, LLP 0138

The Rust core of LLP 0167 landed (profile model, activation gate, env +
admin-API surfaces, two-phase deadline release on all three lanes,
HTTP marker, telemetry snapshot). Honest residue, in rough order:

1. **Socket-level ack+delta timing acceptance test** — commit-group
   plumbing is covered by carrier/queue unit tests, but there is no
   end-to-end socket test asserting the shared commit-relative deadline
   envelope (ack floor, delta floor, scheduler-noise skew bound).
2. **HTTP lanes have no per-connection monotone deadline clamp** — the
   clamp is complete for live durable queues; queries/mutations on one
   keep-alive connection could observe reordered-by-delay responses only
   if a client pipelines, which HTTP/1.1 clients here do not. Decide:
   clamp per connection or document per-request semantics.
3. **Middleware-origin refusals are neither delayed nor marked** —
   responses produced before the query/mutation handler (auth gate,
   body-shape refusals) bypass the egress seam. RFC intent is
   result-readiness stamping for commitless responses; either extend the
   seam into the refusal tower or record the boundary explicitly.
4. **Per-delay Tokio timer per delayed enqueue** — fine at demo scale;
   coalesce into a single deadline scheduler if profile use under load
   matters.
4a. **Non-staged commit fanouts fall back to per-frame stamping** — the
   commit egress group (shared commit-relative deadline, once-per-commit
   jitter) is captured only in `finish_mutation_commit`. Job-completion
   publication, generic `notify_live_subscriptions` fanouts, and
   auth-mode seed frames stamp per frame from enqueue and re-sample
   jitter per frame. FIFO stays safe (monotone clamp) and built-in
   profiles have zero jitter, but a nonzero-jitter profile splits one
   commit's deadlines across subscriptions on those paths. Route them
   through `admit_commit` + the shared carrier.
4b. **Env-startup leg has no test** — the `SNAPBACK_NETWORK_PROFILE`
   startup activation (refusal fails boot; non-normal announces in
   startup output; env profile re-activates after restart) is exercised
   only indirectly; the in-process restart unit test is near-tautological.
   Add a spawn-the-binary test for refusal, announcement, and
   runtime-set-clears-on-restart.
5. **Later stages (unstarted):** Cloudflare coordinator arm (two-phase
   release outside `runExclusive`, deployment classification, ENG-23576
   delivery anchoring via `waitUntil`/DO alarms, per-arm "restart"
   semantics for hibernation), Latency Kanban client-sleep deletion +
   manifest schema versioning (LLP 0138), `host.networkProfile{Get,Set}`
   host-ops + MCP tools (LLP 0024/0042, OQ2 namespace ruling needed),
   admin-console Developer panel (LLP 0017 amendment), fold-or-document
   the two `SNAPBACK_TEST_*_DELAY_MS` coordinator seams (OQ4).

The capability row `operating.network-profiles` is `partial` with a GAP
naming this ticket's scope; flip it when the corpus above closes.
