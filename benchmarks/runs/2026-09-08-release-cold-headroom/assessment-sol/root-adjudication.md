# Root adjudication of the fallback

The original report is preserved, including conclusions not accepted here.
Independent read-only audits checked its source mappings and actual completed
command outputs. No additional app execution is represented by those audits.

## Supported findings and corrections

- The duplicate-handle browser test reached authenticated navigation without a
  visible auth error after 12 seconds; see [actual DOM observation](evidence/browser-ui.json).
  A separate API test proved duplicate-handle refusal. The browser's own
  profile-mutation response was not captured, so the report's “despite the
  backend constraint rejection” wording combines two distinct observations.
  Source sequencing offers an explanation, not a captured same-flow refusal.
- The reported major M3 app defect is not established. Its evidence is the
  historical choreography that never exercised seeded recipient Erin. Preserve
  the failed receipt and qualify `m3-a09` as instrument-confounded/unresolved;
  the [existing instrument issue](../../../../issues/shelved/20260906-clique-m3-group-receipt-missing-seeded-actor.md)
  remains open. No corrected all-recipient run was supplied.
- Coverage mismatches are supported: several mapped tests exercise API flags,
  subsets, local arrays or synthetic filtered objects instead of the declared
  UI, pagination or backend observable. “Dishonest” is the frozen schema's
  mapping verdict, not an inference about author intent.
- Source inspection identifies an omitted feed URL-open callback: the app's
  FeedCard call supplies no `onPressLink`, and the kit supplies neither an
  `onPress` without that callback nor an `href`. The combined URL/avatar browser
  check does not isolate the link failure; retain its not-run scope.
- [Server expiry evidence](evidence/disappearing-api.json) covers 185,085 ms with
  clients closed, subsequent thread/replay absence and a refused late edit.
  It does not prove persisted-cache purge or offline search. Native M6/M8
  process-kill/recording evidence is still missing; not-run is appropriate.

## Runtime isolation and completion limits

During this assessment, the separate M7 web export embedded the assessor's
53126 endpoint in its ClientProvider while its direct helpers used53130.
M7 actually rendered this assessor's diagnostic posts. Its browser logged in
as Alice and opened feeds, Weekend Plans and settings. No explicit post, vote,
message-send or settings-save action was found in the inspected commands.
However, the app automatically handles delivered/read receipts and connected
presence. Exact committed effects were not measured; request logging filtered
only53130 and cannot establish absence of53126 traffic.

The assessor's own final bundle consistently uses53126, but that does not prove
exclusive database custody. Qualify exclusivity-dependent Alice presence,
receipt, unread and digest conclusions. No corresponding causal interference
was established for the duplicate-handle UI observation, controlled post/ranking
checks or source-coverage findings. Historical continuous receipts remain
separate from this later overlap. See [the incident record](../m7-aborted.md).

The assessor reports completion with no grader-abort. Its support record also
retains a browser-observe timeout with no retry; the affected observables remain
missing/not-run. This is useful partial evidence, not a protocol-complete or
clean-isolation qualification. There is no third continuous regrade in this
bounded program. O dimensions remain null and no comparative claim is made.
