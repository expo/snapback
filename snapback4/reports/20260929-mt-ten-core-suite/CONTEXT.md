# Lane MT context

Applied `skills/llp-orient/SKILL.md` before changes. The initially missing
`vendor/llp` checkout was initialized at its recorded gitlink; no skill update.

- Scope: `scripts/test.sh`, its Rust runner, client test scheduling, publication
  warm-up instructions, the office M1 host ticket, the retention fixtures in
  `keep-device.test.mjs` and the reset fixture in `keep-reset.test.mjs`. No product change.
- Governing documents: LLP 3000 (foundation), especially
  [§4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
  and §7's qualified packaged SQLite policy;
  [LLP 2000.000 §12](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md#12-building-snapback-3-without-rebuilding-snapback-2s-process)
  (foundation); [LLP 3000.021 §3.3](../../../llp/3000.021-what-the-comparative-builder-still-wrote.rfc.md#33-p14-a-linux-binary-on-npm)
  (current, Accepted).
- Active constraints: every check reports failures; Snapback 4's independent
  workspaces/fence; publication still executes the source suite with its SQLite
  build input and refuses red; unchanged assertions, seeds, timeouts and wasm
  budget. The user's requested full runs authorize the longer qualification.
- Rationale: preparation may populate Cargo's cache, but does not qualify any
  test. The authoritative Cargo inventory and subsequent executions still run.
- Risks: Linux affinity does not reproduce M1 single-core speed or Darwin.
  A 64 GiB cgroup limit does not reproduce unknown ambient M1 memory pressure.
  Host-wide load is not the load of an affinity-restricted process.
- Likely documentation updates: the command sheet, existing LLP 3000 suite
  decision, this report, one journal append and the existing M1 ticket.
- Hand-off: none.

After the trial exposed the remount fixture race, also read LLP 3000.019 §3.3,
LLP 3000.029 §§2–3 and §11, and the current `guide/reads.rs` and `guide/client.md`
cards in `snapback4-lang`. Distinct watch keys do not isolate live reads from
authority evidence; the key-isolation fixture must not inject unrelated refusals.

The repeated full suite exposed `keep-reset.test.mjs` as well. Read LLP 3000.029
§8 and the real server `QueryReply`: missing dependencies are unknown, whereas
explicit `tables: []` certifies a literal query. Its synthetic query responses
now carry that evidence and the fixture's sequence, with all assertions and
ordering preserved. A remount-barrier hypothesis was rejected before editing
the checked-out fixture; FAILURES.md preserves the unsuccessful candidate.
