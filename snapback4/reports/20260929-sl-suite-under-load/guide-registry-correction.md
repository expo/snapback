# Guide registry correction

The first complete corrected-guard no-load run found one introduced documentation
fixture drift: `familiar::every_moved_fact_has_its_why_or_details_home` reported
`reads-11 lost its Details home`. The guide's expiry wording had been revised,
but its 133-fact registry still contained the old “within a frame” claim.

The correction updates only `reads-11` to the same current deadline/scheduling
wording. Its ID, Details home, full paragraph and all other 132 facts remain.
The test's inventory count, reachability and exact normalized-text assertions
remain unchanged. This is classified **ours**, not environmental or baseline.
The failed whole run completed with no other failure: `== 1 failure(s) in 1728 s`.
The correction was then applied before the remaining matrix.
