# Round 7 — independent observation review

**diagnostic: operator-patched seed body format; audit-refused; never admissible; no pass claimed**

Reviewer: P2A operator. No verdict was inferred from XCTest's pass/fail banner.
The qualified driver and independent validator ran as separate processes.
All nine named assertions per lane are compared in the Phase-2 report and
[inspection.json](inspection.json), with hashes of the inspected raw records.

Archive root: `eb1000:~/sb5-evidence-archive/20261006-p2/round7/`.
Result prefix for each lane:
`results/<lane>/diagnostic-round7-operator-patched-seed-setup-repair/`.
The committed [archive index](ARCHIVE-INDEX.json) resolves and hashes every path
below; it includes full xcresult bundles and both actual built Release apps.

## Convex M6 and M8

Read both complete XCTest logs, host events, manifests, fixture descriptors,
assertion receipts and independent validations. The seed's body format now
passes, and both OS launch commands execute. Both apps exit before the email
selector can exist. No helper event/launch nonce is received, prime is incomplete,
and zero measured steps are entered. All assertions are null/skipped.

Exported all xcresult attachments with `xcresulttool export attachments`.
Each segment retains two native selector query descriptions; they show only
the query for `sm-auth-email`, with no live row hierarchy. The failure tree and
screenshot cannot be captured after the app exits.

Inspected **every encoded frame**, without sampling, from both complete retained
XCTest videos. `decode-videos.py` verifies decoded count equals declared frame
count and produces contact sheets with original presentation timestamps:

| Segment | Archived video under `inspection/convex/` | Frames | All-frame pages inspected | Visible sequence |
| --- | --- | --- | --- | --- |
| M6 | `m6/attachments/B2B63989-14B0-47FE-939C-F8C534FC349F.mp4` | 58/58 | `m6/all-frames/page-00.jpg` through `page-02.jpg` | Home at 2.518 s; launch animation 3.333 s; black app by 3.39 s; home again 4.795–5.143 s |
| M8 | `m8/attachments/FEE72A4C-80D2-4B27-A62F-87C02F71AC34.mp4` | 59/59 | `m8/all-frames/page-00.jpg` through `page-02.jpg` | Home at 1.193 s; launch animation 2.038 s; black app by 2.11 s; home again 3.462–3.810 s |

`inspection/whole-video-decode.json` binds every decoded frame and video.
These short XCTest launch recordings are the full retained files, not measured
protocol videos: the qualified recorder never starts because prime fails.

Matched crash PIDs 4220 and 5294 to the dedicated simulator, built app UUIDs and
launch times. Both triggered threads begin with UIKit's
`NoSceneLifecycleAdoption` function and terminate with SIGTRAP. The filtered
`inspection/convex/process-log.json` explicitly reports the scene-lifecycle
requirement. `startup-failure.json` extracts those two messages and binds the full
log; `built-info.json` shows SDK 27.0 and no scene manifest. This substantiates
the startup failure beyond the misleading secondary XCTest snapshot exception.

Judgment: null for each functional assertion matches the absent authenticated
application state. The validator's `schema-invalid:run:launches` is a false
rejection of truthful unmeasured evidence. No assertion false pass/fail or
measurable-but-unmeasured functional case is established. Recycled rows,
media/receipt children and Bob's view are absent, not verified.

## Snapback 4 M6 and M8

Inspected each complete `failure.json` tree (**87 nodes each**) and each full
resolution `failure.png`, plus both native journals, receipts, manifests,
XCTest logs and validator outputs. The app renders the sign-in screen. Email
and secure password selectors exist and receive input, and XCTest taps the
sign-in button. Both trees have `sm-auth-error` containing SecureStore's
`getValueWithKeyAsync` failure: “A required entitlement is not present.”
Both screenshots show that same error and the app remaining on sign-in.
One `screen` event per run records route `auth`, empty rows and no conversation;
there is no `ready` event. The driver waits its sign-in bound and returns null.

`inspection/snapback4/signature.json` retains read-only `codesign` output:
linker ad-hoc signature, no bound Info.plist/resources, no entitlements. The
unchanged build wrapper's `CODE_SIGNING_ALLOWED=NO` is also the shared handoff
example's setting. The failure is visible product/build behavior, not merely
a missing observer event. No auth, signing or storage change was made.

Full video is **unavailable for both SB4 segments**. No protocol recorder starts
before prime, and the successful XCTest command loops retained no attachments.
Both `inspection/snapback4/<segment>/attachments/manifest.json` files are empty;
the corresponding export logs explicitly report no matching attachments. The
frame/tree inspection cannot substitute for continuous visual evidence. This
retention gap is an instrument finding and a reason to rerun after changes.

Both full trees contain auth and keyboard nodes, **zero conversation, bubble,
receipt, media or search-result nodes**. There were no recycled/offscreen rows
to inspect. Assertions about those structures remain unverified. Each of M6's
seven and M8's two assertions is null/skipped; both validators return valid/null.
Withholding credit agrees with the observed auth failure. No functional false
pass, false fail or unmeasured-when-measurable case is observed within this
limited coverage.

## Controls and bounds

The incomplete-prime/`wrong-fixture` qualification boundary is relevant to
honest unmeasured results. These runs do not reach the media, receipt, outbox,
ordering, duplicate, Bob-identity or recycled-row conditions of the named
negative controls. The instrument is unchanged and nothing indicates an
existing control lost separation, so none was rerun. No claim about unseen
later application behavior follows from the four startup/priming failures.
