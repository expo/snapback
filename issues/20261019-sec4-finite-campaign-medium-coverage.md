# SEC4: four medium finding gaps in finite generated campaigns

Status: Open
Owner: SEC4
Date: 2026-10-19
Scope: checker/test campaign coverage; no engine authorization change

The frozen `c4a21db85a` build catches all seven calibrated wave18 high findings
with independent spec intent, but does not earn actual authored-operation
credit for four calibrated mediums. Stricter creator/guard admissibility means
the earlier loose generated-state evidence cannot be carried forward.

- 015 F1: clearance equipment/title intents remain unproved; initialization
  does not populate a suitable authored clearance state.
- 021 F2: inventory intent has only a synthetic direct-table observation;
  `audit` correctly exits0. Do not count that as an inventoryFor campaign catch.
- 033 F2: upheld-appeal score intents remain unproved; no required authored
  decision/correction combination was selected within the finite frontier.
- 041 F2: users.building update intent remains unproved. The independently
  caught self-role setProfile escalation does not establish the building grant.

Extend creator goals and fair argument/history selection while honoring actual
requires, copied fields, immutable/defaulted values and ordinary field-owner
admission. Add positive/negative controls and replay the exact source hashes.
Never repair coverage by inventing an inadmissible initial payload or by
promoting synthetic writes. Preserve explicit unproved/coverage-gap output.

Evidence: `snapback4/reports/20261019-sec4-wave19/` shipping-c4a high-lane
JSON plus compressed check/audit outputs and harnesses (retained in final evidence).
Governing contract: LLP3000.036.004 §13.7. QRY owns partial-return/hidden-lookup
semantics; this ticket changes campaign search only. Frozen bakeoff inputs are
read-only; use disposable copies.
