# G5R context pack

Scope: Postgres revision-result cache, independent reader transport and serving configuration.

Governing current LLPs: 3000 (fence and scope); 2000.000 (one semantics);
3000.009.001.000 (owner fence and snapshot port); 3000.009.001.000.002
§§4.1–4.5 and §6 (complete revisions, exact reuse, identity, authority,
resource exclusions and qualified G5/G6 baseline). One-hop related:
3000.009.001.000.000.002 §§3.8–3.9 (D-certified reads),
3000.009.001.000.000.003 §§4.5–4.6/5 (W and two-image Stage R reads).
The root's foundation contains incumbent Snapback design; the Snapback 4
fence selects 3000 and its current descendants for this implementation.

Active constraints: exact revision equality, no retained authority without
proof, fresh independent snapshot after each enrolled invocation, complete
producer coverage, unchanged cache/worker/30-reader/32-total bounds; G6
remains opt-in. See LLP 3000.009.001.000.002 §§4.1–4.5. Stage E/R require
publication proof beyond physical visibility; this prototype keeps E on G5
and does not implement R. The release-json compiler guide records the paved
configuration, rather than the incumbent guide corpus. Rust execution,
authority and logical meters stay shared (LLP 2000.000).

Rationale: the S1 read report's 5,656/s highest passing rung is environmental,
not a universal intrinsic capacity. The subsequent diagnosis's 8,000/s
G5 W2 replay passes; failing G5 W2 has PG CPU pressure and HTTP queueing
with negligible pipeline permit wait. Reduce actual statements, then measure
worker occupancy and payload CPU. W1's nonrepeating million-key stream
should not benefit. W2's cache pressure remains an independent limit.

Risks: incomplete revision producer coverage would invalidate frozen
authority; round enrollment after send is a stale-read bug; R's H is not W;
extra two-flight waiting can consume 30 workers. Likely doc updates: existing
§4.2 Review subsection, guide flag, journal and aggregates. Hand-off: none;
no acceptance, publication or fleet qualification is implied. Snapback 4's
own workspace has no Ibex dependency, so no root Ibex bootstrap is needed.
