# RT6 context and predictions (before implementation)

Scope: Postgres serving transport, read access planning and commit framing.

Governing LLPs: LLP 3000 (candidate fence); LLP 3000.009 §4.1–4.4
(one Rust executor, bounded speculative access, shared commit order);
LLP 3000.009.001.000 §3.4, §5.1–5.4, §8, §9.1 (opaque port,
owner-first ordering, unknown COMMIT, session affinity and parity);
LLP 3000.009.001.000.001 §3.5–3.6, §4–6 (ordered flights and ratchet).
The store port is linked in the current working set; the budget child is
read at its numbered corpus path (it has no current/foundation link). The RT5 report supplies the
qualified encoder and the real-path mechanism choice. Orientation used the
pinned llp-orient skill, read from upstream because vendor/llp is empty;
no submodule registration or Git configuration change was made.

Constraints: LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place;
LLP 3000.009.001.000.001#36-how-a-flight-is-sent-is-decided-by-measurement;
LLP 3000.009.001.000#91-adapter-parity-rules. COMMIT remains separate.
Cold preparation and connection qualification remain explicitly counted.
No SQLite change, authority policy in SQL, public ceiling change or publication.

Risks: snapshot freshness after head waits; terminal pre-send failures;
physical scratch amplification; premature release/COMMIT; planner fallback.
Docs to update: this report, RFC RT6 note, parent rule 5, JOURNAL.
Hand-off: none.

| Class | Previous PG | Predicted PG |
| --- | ---: | ---: |
| w1_point / account_w1 | 6 | 3 |
| w2_newest20 | 6 | 2 |
| unkeyed_increment / account_unkeyed_increment | 16 | 8 |
| one_membership | 17 | 9 |
| keyed_first | 24 | 9 |
| replay_hit | 5 | 2 |
| action_session_w1 | 19 | at most 19 (complete resolver retained) |
| unknown_operation / narrowed_argument | 4 | 2 |
| unknown_token | 1 | 1 |
| unauthenticated / rate_limited | 0 | 0 |

W1: ingress; BEGIN + authority + row; membership + ROLLBACK.
W2: ingress; BEGIN + authority + membership + page + ROLLBACK.
Increment: ingress; BEGIN + owner; head + generation + authority +
savepoints; read; UPDATE; read; releases + receipts + tail + settings,
with client validation; COMMIT. Keyed first adds unfenced preflight and
includes a distinct post-lock receipt re-check command in writer setup.
Replay: ingress; unfenced BEGIN + authority + receipt + ROLLBACK.
