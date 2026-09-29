# WK round 5 context

Scope: host store ownership, worker watchdog inheritance, and Node ledger initialization cancellation. Applied llp-orient read-only before implementation. Read all lane prompts and reports, Astra’s complete round-4 review, and the available Grok progress notes; recheck before completion.

The inherited fetch/merge instruction produced merge 22e37b564f. Only the append-only journal conflicted; both histories remain. The scope follows the Snapback 4 fence, with no Snapback 1–3 gates. No Snapback 4 foundation link applies; LLPs 3000, 3000.007, 3000.009 and 3000.019 are current.

- LLP 3000#4-fence-numbering-routing: own workspace and gates, unchanged 593,719 B gzip cap.
- LLP 3000.009#5.3: process groups stop with their host; credential lifecycle, keeping credentials out of logs, and validated source execution remain intact.
- LLP 3000.019#3.4: retain the existing sidecar flock, never the SQLite database descriptor. Ownership requires the sidecar to remain in place. Preserve immediate busy refusal for non-host commands.
- LLP 3000.019#3.6: startup acquisition precedes serving; no extra writer work in HTTP admission.
- LLP 3000.009#5.2: initialization waits asynchronously and stops on cancellation; completed receipts still survive busy COMMIT and post-provider cancellation. Effect identity, attempts, ordering, authorization and meters stay unchanged.
- LLP 3000.007#9.2 and LLP 3000.005#2-where-it-sits: external Node workers remain separate from the engine and native jobs.

Decision: inherit the same flock’s open file description in each watchdog, change close-on-exec only after fork, and restore close-on-exec before launching Node. Keep the descriptor through group cleanup. Dev/serve wait up to five seconds for ownership before opening the store when an announced host has no reachable loopback listener. A live listener or unannounced CLI owner still refuses immediately. The address is only a wait/refusal hint; ownership always requires the sidecar lock. Other commands retain immediate refusal. Fresh dev stores remain independent. Extend the existing LLP, effects guide and operations manual.

Tests: immediate SIGKILL/restart under both verbs, with startup-time overlap detection for a SIGTERM-resistant worker and helper, old credential refusal, and Linux Node descriptor exclusion; actual initialization SQLITE_BUSY followed by abort and writer release. No production ledger guard change is needed.

Risk retained: issues/20260929-snapback4-watchdog-fallback-group-identity.md remains open. No macOS or provider qualification is inferred from Linux tests. Handoff: none.

The full Rust stage detected that unconditional waiting changed prompt refusal for active servers and CLI owners. The final wait classification preserves those contracts. Whole-guide baseline also exceeded its six-card word budget by 12 words; two language-card prose lines were shortened without moving recorded facts or changing compiled examples.

Grok’s completed round-4 READY WITH CHANGES review arrived during the full client phase. Follow-up scope: place source snapshots in the project’s private .snapback4 directory so a global temporary parent cannot add Node package lookup; use no-follow regular-file manifest copies at schema/project/ancestor scopes; atomically clear prior status rows with startup credential retirement. The existing commit test now holds its real reader through 110 busy commits and detects Grok’s 100-attempt cap mutation. These follow-ups extend LLP 3000.009 §5.3 and the existing guide/manual; no new surface, gate or budget.
