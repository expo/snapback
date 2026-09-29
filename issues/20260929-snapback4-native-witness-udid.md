# Native witness: consider requiring an explicit `--udid`

Status: Open
Date: 2026-09-29
Systems: Snapback 4 `witness ios --build` (lane NP-mac, merged 2026-09-29; LLP 3000.030)

Grok's review of NP-mac round 5 (`~/sb4-intent/reviews/npmac-r5.grok.md` on eb1000) suggested
requiring an explicit `--udid` instead of choosing a booted or available simulator. That would
make the smoke target unambiguous on hosts shared with other sessions' simulators. The trade-off
is one more required argument on the paved path, which builders run cold.

Round 7 fixed the round-6 review's other items: resolving output paths in filesystem order, the
snapshot-custody regression, and the stated threat model.

Decide:
- whether selection stays automatic, with the chosen device printed and recorded in the receipt;
- or whether `--udid` becomes required when more than one simulator is booted.
