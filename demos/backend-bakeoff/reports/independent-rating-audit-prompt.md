# Independent LLP 0102 subjective-rating audit

You are the independent reviewer required by LLP 0102. You did not build these
arms. Review the frozen repository evidence and produce your own ratings
before any builder ratings exist or are shown to you.

## Scope and method

- Rate all 35 provider/application pairs: providers `snapback`, `convex`,
  `supabase`, `firebase`, `instantdb`, `spacetimedb`, `appwrite`; applications
  `todo`, `chat`, `linear`, `partiful`, `research-room`.
- Use integer ratings from 0 through 5 for every frozen category:
  `authoring`, `modeling`, `correctness`, `realtimeOffline`, `auth`,
  `completeness`, `deploymentOperations`, `testingDocsAgent`,
  `performanceCost`, `maturityControl`.
- Interpret the scale exactly as LLP 0102 §4: 0 unsupported/no credible path;
  1 unsafe or largely custom external system; 2 major glue/caveats/recurring
  uncertainty; 3 ordinary competent; 4 notably strong/low-friction; 5
  exceptional and preference-shaping.
- Do not compute or optimize for the weighted total. Architectural potential
  contributes zero points. Score the tested product today.
- Cite at least one repository-relative diary or machine-evidence path for
  every provider/application rating.
- Distinguish product defects, explicit product gaps, unavailable hosted
  credentials, builder mistakes, and evidence weakness. Do not turn a GAP or
  unavailable target into a pass.
- Preserve the Convex Research Room provider Stop in `stopDefects`. Supabase's
  Research Room redaction incidents were builder evidence Stops, not provider
  data disclosure; nevertheless its credential-bearing CLI and containment
  burden may inform operations, diagnostics, and agent-usability ratings.
- Final Snapback package confirmations supersede the old product-result rows
  for today's outcome, while the original time, failures, interventions, and
  friction remain part of authoring/operations evidence:
  Todo 11 PASS/3 GAP/0 FAIL; Chat 14/1/0; Linear 10/4/0; Partiful 12/3/0;
  Research Room 13/2/0.
- The Snapback package closure was staged/dry-run only, not publicly published.
  Do not award public distribution or hosted-deployment credit.
- Todo/Chat final Linux performance receipts contain a contradicted hardcoded
  Mac profile. Use their companion machine-context corrections and do not make
  cross-machine performance comparisons from those samples.
- Current provider refreshes are additive. Research Room/Supabase 2.111.0 is
  15/15 locally with hosted deployment unsampled. Chat/Firebase and
  Linear/Firebase use Admin 14.2.0 and Functions 7.3.2; consult their final
  handoffs for the terminal outcome.

## Evidence index

Read these first:

- `llp/0102-seven-backend-five-app-bakeoff.plan.md`
- `demos/backend-bakeoff/protocol/scoring.v1.json`
- `demos/backend-bakeoff/reports/calibration-report.md`
- `demos/backend-bakeoff/reports/deep-round-report.md`
- `demos/backend-bakeoff/reports/deep-round-evidence-audit.md`
- `demos/backend-bakeoff/reports/remediation-1-report.md`
- `demos/backend-bakeoff/reports/remediation-2-report.md`
- `demos/backend-bakeoff/reports/provider-refresh-audit.md`
- `diaries/0027-todo-backend-bakeoff.diary.md`
- `diaries/0028-chat-backend-bakeoff.diary.md`
- `diaries/0029-linear-backend-bakeoff.diary.md`
- `diaries/0030-partiful-backend-bakeoff.diary.md`
- `diaries/0031-research-room-backend-bakeoff.diary.md`

Use arm `run-capsule.v1.json` files and their cited evidence to resolve any
ambiguity. Also inspect:

- `demos/backend-bakeoff/reports/final-confirmation/package/`
- every Snapback `final-confirmation-handoff/`
- Research Room/Supabase `final-refresh-second-attempt-handoff/`
- Chat/Firebase and Linear/Firebase final refresh handoffs
- `demos/backend-bakeoff/reports/deep-remediation.v1.json`

## Required output

Return strict JSON matching the supplied schema. Keep each rationale concise
but specific. `warnings` should identify evidence limitations or ratings where
reasonable reviewers could differ by at least one point. Give an overall and
per-app go-to recommendation based on your ratings, but do not invent a
builder consensus.
