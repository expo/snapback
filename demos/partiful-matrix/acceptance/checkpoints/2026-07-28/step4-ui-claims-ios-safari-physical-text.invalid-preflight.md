# Physical iOS text supplement — invalid preflight attempts

- Snapback fixture revision:
  `dc29282023a8fe9b8c9f0ecf0578ba0bda4b86e8`
- Exact fixture revision:
  `4290bacbe2d42ee848b849439654c89665c65c9f`
- Device: `00008150-00120CEE3E40401C` (iPhone 17 Pro Max,
  iOS 26.5.2 build 23F84)
- Host: Apple M5 Max, macOS/Darwin 25.5.0, SafariDriver 26.5.2
- Operator: Charlie Cheever
- Outcome: invalid before browser launch; zero qualifying checks ran.

## Retained attempts

1. The first clean-worktree attempt stopped during package-identity
   construction because the React surface's nested install was absent
   (`@supabase/supabase-js/package.json` could not be read). Its aggregate is
   retained under
   `../../results/phase4-ui-claims/invalid/2026-07-28-missing-react-surface-dependencies/`.
2. After the React and Contract frozen installs were restored, the second
   attempt stopped during the same identity phase because the Vanilla
   control's Vite install was absent. Its aggregate is retained under
   `../../results/phase4-ui-claims/invalid/2026-07-28-missing-vanilla-surface-dependencies/`.
3. After all three surface package identities resolved, the third attempt
   failed closed because `target/debug/snapback` was absent. Its aggregate is
   retained under
   `../../results/phase4-ui-claims/invalid/2026-07-28-missing-snapback-server/`.
4. The governed Snapback bootstrap then initialized the pinned Ibex
   submodule, reused the prepared Hermes artifacts, built the server, and
   passed its launch smoke. A consolidated preflight confirmed the server,
   all three surface installations, SafariDriver, the device-facing host
   address, and a paired connected phone. SafariDriver nevertheless rejected
   the first WebDriver session because the phone's Safari **Remote
   Automation** setting was disabled. The harness was stopped after the
   resulting setup-only receipts; they are retained under
   `../../results/phase4-ui-claims/invalid/2026-07-28-remote-automation-disabled/raw/`.

## Disposition

These attempts are environment/bootstrap failures, not React or Contract
product verdicts. They contribute no sample and do not alter any claim,
fixture, oracle, threshold, or invalid-run rule.

Repeat the unchanged complete four-cell attended run only after Safari Remote
Automation is enabled on the same unlocked, paired physical phone. Preserve
the pinned Snapback and Exact revisions and the existing package, harness,
device, and network identity fields.
