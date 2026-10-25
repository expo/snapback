# Fresh extraction declarations use the wrong role-probe context

Status: Resolved
Date: 2026-10-25
Systems: Snapback 4 extraction adoption
Related: LLP 3000.000.000 §21

Integration 25's fresh-schema survey found E_ADOPT in wave-27 028
(chandelier restorations) and 032 (service-dog placements), before and after
test. Both extraction parents were newly declared. The parent definition came
from the current schema while probe validation used the empty historical table
map, falsely diagnosing changed role-index meaning.

The correction selects the definition and context together. Historical or
restored definitions keep their historical context and all existing row/payload
inclusion guards; a newly declared definition uses the current schema. No
historical audience check is skipped based on an empty row population.

The valid fresh/new-parent regression fails before the fix with E_ADOPT. Its
paired historical-parent control continues refusing changed role-probe meaning
and preserves the generation. Scope includes direct fresh deployment and adding
new extraction tables to an existing application. Full results and copied-app
replays are recorded in the Integration 25 report.
