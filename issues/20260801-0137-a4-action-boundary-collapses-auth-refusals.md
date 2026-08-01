# A4 sweep: nested-mutation auth denials collapse to SNAPBACK_HANDLER_FAILED through the action boundary

**Opened:** 2026-08-01
**Systems:** Actions, Auth, Diagnostics
**Related:** LLP 0137 (A4 arm), demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f5-action-boundary-collapses-auth-refusals.json, issues/20260801-0137-a3-no-structured-app-refusal-codes.md

When a nested mutation inside an action refuses with
`SNAPBACK_AUTH_PERMISSION_DENIED` (outsider driving the reminder action;
guest driving the notification action), the caller receives only
`SNAPBACK_HANDLER_FAILED`. The denial holds (nothing committed), but the
platform auth code does not survive the boundary, so a client cannot
distinguish "not allowed" from "handler crashed" — the uniform-denial
diagnostic property every direct surface upholds is lost one hop into the
action lane. Distinct from 0137-a3-f3 (app-thrown Errors collapsing):
this leg loses a PLATFORM code.

Fix shape: propagate the platform diagnostic class through the action's
structured error envelope with uniform, non-disclosing bytes. Witness:
an unauthorized action invocation whose nested mutation requireRole-
refuses surfaces SNAPBACK_AUTH_PERMISSION_DENIED byte-uniform with the
direct-mutation denial.
