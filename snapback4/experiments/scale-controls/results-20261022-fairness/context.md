# S1-FR orientation context

Scope: the isolated `scale-controls` harness, raw-PG HTTP authentication,
matched controls, evidence and the scale RFC. No product engine changes.
Read-only llp-orient workflow used the installed v0.5.2 skill at
`/home/ccheever/lanes/assetrow/vendor/llp/skills/llp-orient/SKILL.md`;
this worktree's vendor submodules were not initialized or cloned.

Governing documents (all in `llp/current/`, none in `llp/foundation/`):

- [LLP 3000 §4](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing): Snapback 4 fence.
- [LLP 3000.009.001.002 §4](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#4-controls): same semantics, durable controls, published configurations, labelled authorization omissions.
- [LLP 3000.009.001.002 §5](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#5-workloads): W1–W5 workloads, exact and nominal 1% contention.
- [LLP 3000.009.001.002 §6](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#6-method-and-metrics): intended-arrival timing, SLOs, resource evidence and three repetitions.
- [LLP 3000.009.001.002 §7](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#7-the-limits-ledger): matched authorization before semantic-cost comparisons.
- [LLP 3000.009.001.002 §10](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#10-non-claims-and-risks): shared-host runs do not qualify product ceilings.

The active constraints and rationale are those cited sections, plus the
user's explicit S1-FR scope: a 10 s warm-up / 20 s window, fresh service per
cell, three repetitions, 1M messages, C=32 / pool cap 32, natural / +0.5 ms.
The existing controls' source @refs resolve to §§4–6 above.

Open risks: shared hosts, two-host topology, proxy rather than netem,
background sharing of Convex's pool, native cache differences, and the
PostgREST-only Supabase scope. The inherited one-second slices group by
intended arrival; they do not count wall-clock completions in each second.

Likely doc updates: harness README, the matched report, RFC §§7/9 and its
single Revised line, plus an append-only Snapback 4 journal entry.
Hand-off: none; this is the user-commissioned implementation/evidence pass.
