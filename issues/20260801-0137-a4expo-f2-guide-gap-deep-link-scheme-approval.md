# A4 Expo sweep guide-gap: the mobile acceptance recipe has no deep-link leg, and the headless path dies silently on the iOS scheme-confirmation dialog

**Opened:** 2026-08-01
**Systems:** Guide, Acceptance, React/Expo
**Related:** LLP 0137 (Track B A4 Expo iOS arm), LLP 0061 §5, demos/improvement-sweep/arms/a4-snapback-expo-ios/findings/0137-a4expo-f2-deep-link-acceptance-scheme-approval-guide-gap.json

The Track B receipt requires "native auth entry and deep-link return where
the app requires it", and an invitation product's deep link is exactly that.
The sanctioned mobile acceptance recipe (guide clients/react-expo.md's
director/witness loop) has no deep-link leg, and the naive headless path
fails with zero diagnostics: `simctl openurl` on a custom scheme's first
open raises the iOS 'Open in "<app>"?' confirmation dialog, which no
headless simctl surface can answer — the URL event never reaches the app and
the run times out silently.

Working recipe the arm had to discover (knowledge the guide should carry):
pre-approve the scheme in the simulator's
`data/Library/Preferences/com.apple.launchservices.schemeapproval.plist`
(key `com.apple.CoreSimulator.CoreSimulatorBridge-->{scheme}` → bundle id,
written while the device is shut down), after which `openurl` delivers and
the React Native `Linking` listener fires. The dialog itself is an OS
product fact — a real user answers it once per scheme — worth stating on the
same page.

Fix shape: a deep-link section on the Expo guide page (or the acceptance
page's mobile appendix): scheme registration recap, the one-time OS
confirmation fact, the schemeapproval pre-authorization recipe for headless
simulator runs, and a witnessed redeem-from-URL example.

Witness: a guide snippet-check (or the next Expo arm) drives an OS-level
deep link through simctl into a witnessed in-app redemption using only
guide-documented steps.
