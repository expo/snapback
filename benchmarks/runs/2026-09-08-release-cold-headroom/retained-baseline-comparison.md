# Retained Convex baseline comparison

This comparison reuses the retained Astra/medium Convex run. It does not rerun
or independently regrade that baseline. The separate Snapback M7 sessions are
outside both continuous intervals below.

| Recorded observation | Convex 1.45.0 | Snapback2 0.0.19 |
| --- | --- | --- |
| Builder | Astra / medium | Sol / xhigh |
| Host | Apple M5 Max | Apple M1 Max |
| Expo | 55.0.31 | 54.0.37 |
| Gross milestone boundary interval | 5,643 seconds | 22,655 seconds |
| Replay execution, overlapping that interval | 884 seconds | 1,255 seconds |
| Reported settled replay actions | 167,157 | 167,157 |
| Qualifying native M6/M8 behavioral evidence | Absent | Absent |

Convex's replay runs inside its recorded milestone interval: do not add 884
seconds to 5,643, or subtract replay only from Snapback's interval. Concurrent
work, different terminal boundaries, and different first-green times prevent
an exclusive authoring-time comparison. Final administration lies outside both
intervals. See the [Snapback clock corrections](continuous-closeout.md).

Convex reports green local web suites and implemented choreography, but its
M3 result uses an Alice/Bob/Carol adapter after the default Erin case was skipped.
It is not a passing default four-member fixture. Snapback retained M3 at 6/7
and continued diagnostically after that abort; its other six continuous
milestones have local passing receipts. Neither record establishes the complete
frozen protocol under matched conditions.

Replay verification also differs. Convex's author describes entity/relationship
and twelve media-byte checks; Snapback's audited record establishes named
checkpoint checks. Convex retains a failed strict Trending midpoint author
probe. Those limited probes are not a matched, preregistered comparative
campaign. The baseline's correction classifications are author judgments, not
a normalized causal comparison. Different models, hosts, Expo versions,
instrument adaptations and evidence scopes support no overall winner or
backend speedup percentage.

The read-only audit independently matched these retained private baseline
artifacts on 2026-09-08:

| Artifact | SHA-256 |
| --- | --- |
| final-report.md | `f7131ef9f3e627cdfd3e5f6e52cf8ba0679a478d2375dcd17ee71e85ce2dac94` |
| run-log.md | `24b667891c1009a42091b0df92a524bc48c36167ed779e892ce31cc8d5edbe81` |
| run-record.json | `e8f04eca4933a67afb8cfde9af93909b0a29d2cb8d21d2003b0e3de624764d89` |

The original baseline narratives and records remain preserved privately.
This comparison does not replace or silently correct their bytes.
