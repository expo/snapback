# Clique assertion summary undercounts the current manifest

Status: Open
Date: 2026-09-12
Scope: benchmarks/schema/social-messenger/assertions.json and its explanatory README files
Found during: Snapback3 full Clique preparation (LLP 2000 section17)

The current manifest contains 119 atomic assertions: M1=13, M2=27, M3=15,
M4=12, M5=12, M6=13, M7=9, M8=18. Its `counts.assertions` summary still says
M2=24 and total=116. `benchmarks/schema/social-messenger/README.md` and
`benchmarks/tools/social-messenger/grader/README.md` also say116.

The difference is the existing `m2-a25`, `m2-a26`, and `m2-a27` self-follow
feed assertions. Their checklist item is already item2, so the51 checklist
items remain correct. This is stale summary metadata, not three new proposed
requirements. The Snapback3 preparation enumerates the actual stable IDs and
keeps all119 in scope; no retained run packet or assertion was altered.

Reproduce by loading the manifest and counting each milestone's `assertions`
array, then comparing with `counts.assertions`. The observed source SHA-256 is
`e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.

Resolve by deriving/correcting the summary counts and explanatory totals while
preserving assertion IDs, text, executor classes and all frozen historical
packets. Check consumers use the enumerated IDs rather than treating the stale
summary as a denominator.
