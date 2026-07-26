# Partitime Web Citizenship Matrix

Authority: Snapback LLP 0063 Step 4 and Exact LLP 0211 §4.3.

This is a strict release gate, not a compatibility estimate. Missing rows are
red. Chromium emulation and synthetic composition events do not substitute for
the named browser, OS version, real IME, password manager, or bfcache behavior.

## Required matrix

| Environment | Required behaviors |
| --- | --- |
| iOS Safari current | IME composition, autofill/password manager, focus trap/restore, bfcache restore, find-on-page |
| iOS Safari current−1 | IME composition, autofill/password manager, focus trap/restore, bfcache restore, find-on-page |
| Android Chrome current | IME composition, autofill/password manager, focus trap/restore, bfcache restore, find-on-page |
| Desktop Safari | focus trap/restore, find-on-page |
| Desktop Chrome | focus trap/restore, find-on-page |
| Desktop Firefox | focus trap/restore, find-on-page |

The executable inventory is available with:

```sh
node demos/partiful-matrix/tests/acceptance/step4-browser-citizenship.mjs \
  --list-required-results
```

## Fixtures and observations

Start a production Contract × Snapback build on an origin reachable from the
device. Use the create-event form/dialog on `/partitime/`, the canonical
`Sunset Supper Club` feed copy, and the feed → event → back traversal.

- IME: enter composing text in title and description using a real target IME.
  Intermediate composition must not publish as committed form state; the final
  string must commit once and remain visible.
- Autofill/password manager: let the target browser or named manager populate
  eligible native controls. Values, validation linkage, and dialog state must
  remain intact.
- Focus: Tab/Shift-Tab must remain inside the open dialog; Escape must close it
  and restore focus to `new-event`.
- Bfcache: change authored state, navigate feed → event, leave the document,
  and return with browser back. Record the `pageshow.persisted` observation;
  the restored route must retain state and remain interactive.
- Find: use the browser's actual find UI for `Sunset Supper Club`; visible copy
  must be found and the event must still open afterward.

Record the exact browser and OS versions, a short observation, and at least one
durable screenshot, video, device-lab log, or session URL for every row.

## Evidence input

Supply a JSON file with schema
`partitime.web-citizenship-evidence.v1`, run metadata (`id`, `operator`,
`baseCommit`, `startedAt`, `completedAt`), and one passed row per required
environment/behavior. Each row contains `environment`, `assertion`, `fixture`,
`status: "pass"`, `notes`, `browser: {name, version}`,
`os: {name, version}`, and `evidence: [{kind, ref}]`. Mobile rows also record
`channel: "current"` or `"current-1"` as required by their environment.

Generate and validate the cumulative receipt with:

```sh
node demos/partiful-matrix/tests/acceptance/step4-browser-citizenship.mjs \
  --manual-evidence /path/to/device-matrix.json \
  --out demos/partiful-matrix/acceptance/results/step4-web-citizenship.json
```

The command exits nonzero unless all 21 required rows pass. For a diagnostic
receipt that deliberately records remaining red rows, add `--allow-red`.

## Local Chrome partial

The deterministic desktop Chrome slice proves only its two rows. Focus comes
from the existing product-UI acceptance run; find-on-page has a separate
live Contract product probe so the frozen Step 0 browser harness stays unchanged:

```sh
node demos/partiful-matrix/tests/acceptance/step4-desktop-chrome-find.mjs \
  --receipt demos/partiful-matrix/acceptance/results/step4-web-citizenship-desktop-chrome-find.json

node demos/partiful-matrix/tests/acceptance/step4-browser-citizenship.mjs \
  --allow-red
```

That partial run must never be described as satisfying the mobile, Safari, or
Firefox rows.

## Desktop Safari and Firefox

The named-engine WebDriver probe exercises real Tab/Shift-Tab/Escape focus
behavior and each browser's native find implementation. Firefox requires
`geckodriver`; its privileged context is used only to invoke and inspect the
native Firefox FindBar, not to search DOM text directly.

```sh
node demos/partiful-matrix/tests/acceptance/step4-desktop-webdriver-citizenship.mjs \
  --browser firefox \
  --receipt demos/partiful-matrix/acceptance/results/step4-web-citizenship-desktop-firefox.json

node demos/partiful-matrix/tests/acceptance/step4-desktop-webdriver-citizenship.mjs \
  --browser safari \
  --receipt demos/partiful-matrix/acceptance/results/step4-web-citizenship-desktop-safari.json
```

The collector records the resolved Exact package manifests and the direct-host
source used by the candidate. A registry install is bound by those installed
artifact digests. When the packages are linked to an Exact source checkout,
pass `--exact-root /path/to/exact`; the receipt is claim-eligible only when
both linked package roots belong to that clean, revision-identified checkout.

Safari must have Develop → Allow Remote Automation enabled by the machine
owner. `safaridriver --enable` requests an administrator password; the gate
does not bypass that setting or convert its absence into a skip. Because Safari
does not focus buttons on mouse click, its focus probe explicitly focuses the
opener before WebDriver's native click, then tests trap, wrap, Escape, and
restoration with WebDriver key actions. Safari disables its native Find command
inside a WebDriver-owned window, so the collector closes that bounded session
and relaunches the same candidate in an ordinary Safari process for the Find
half. It invokes the native Find bar with the macOS keyboard path, reads the
browser chrome through Accessibility APIs, and activates the matched event
through the same accessibility surface; it does not substitute a DOM text
search for Safari's browser UI.

Desktop receipts must be complete, clean-checkout, zero-skip, zero-cleanup
runs matching the currently installed browser version. The cumulative
collector admits each passing check independently from such a receipt and
keeps every failed or missing check red. A passing Safari focus result therefore
cannot conceal a failing Safari native-find result.

## Physical iOS text supplement for the OQ9 UI matrix

This is a separate Phase-4 UI-claim carrier, not a web-citizenship importer.
The iOS Simulator remains the complete `safari-ios-latest` engine cell. When
its WebDriver value command cannot deliver text, an attended physical-iPhone
run may replace only the failed `STEP4.UI.KEYBOARD` and
`STEP4.UI.REDUCED-MOTION` outcomes. It does not satisfy any of the five
current-iOS citizenship rows, current−1 iOS, Android Chrome, visual approval,
or released-package provenance.

Prerequisites:

- the Mac and unlocked iPhone are paired, trusted, and on a network from which
  the phone can reach the Mac's selected private address;
- `safaridriver --enable` has run on the Mac;
- Settings → Apps → Safari → Advanced → Remote Automation is enabled on the
  iPhone;
- the Contract surface resolves the Exact package closure identified by the
  pinned visual fixture revision.

Run both React and Contract text-dependent claims with:

```sh
bun demos/partiful-matrix/tests/acceptance/step4-ui-claims.mjs \
  --browser ios-safari-device \
  --exact-revision 5ea17e8772d9f2c36b5e9cb9af412baf33cfe9a3 \
  --ios-device-udid 00008150-00120CEE3E40401C \
  --physical-network-host 192.168.1.13 \
  --attended-operator "Charlie Cheever" \
  --attended
```

The carrier starts fresh in-memory Snapback, gateway, Vite, and physical
SafariDriver sessions for each arm × claim cell. The plaintext test services
bind only to the explicitly supplied private device-network address. When
prompted, the operator types the exact requested value using the iPhone soft
keyboard and does not paste or press Return. The harness polls the resulting
DOM value, retains a hash-bound screenshot, and then continues the ordinary
key-action and semantic outcome oracle. It never calls WebDriver's
element-value command in this lane.

For the reduced-motion cells, enable Settings → Accessibility → Motion →
Reduce Motion when prompted. The harness proves Safari's media query observes
the setting, but cannot restore a physical device preference; restore the
owner's prior setting after the run.

`step4-ui-matrix.mjs` admits the supplement only when all four raw runs pass,
the device and operator identities agree, every screenshot digest resolves,
the Contract Exact package manifests match the pinned simulator fixture, and
the current product source bytes match the visual fixture's Snapback revision.
Missing or malformed supplemental evidence remains red.
