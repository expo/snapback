# Arg-filtered live queries retain nothing and the retention mechanisms read as a maze

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Systems:** Live queries, Retention, Guide
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Chat's natural query shape (args-filtered by conversation) classifies
retention `none`; single_table_v1 eligibility requires public
authority-independent args-less declarative queries, which the guide's
offline example does not make load-bearing. Lane 1 burned roughly half
its 80-minute build discovering this by experiment, dead-ending through
composition-activation and `registerQuery` (`NOT_WRITER` off-writer,
page-scope shadowing) before pivoting to args-less queries filtered
client-side. Three mechanisms (resume channel, registrations,
materialization store) with different survival rules need one guide page
that routes by workload shape and states the eligibility constraints
up front — and the eligibility rule belongs in the retention fact's
diagnostic, not just prose.
