# Physical iOS text supplement — invalid device attempt

- Attempt revision: `ecac9d9be7637b2f52dbba48ca40f70d45330440`
- Exact fixture revision: `4290bacbe2d42ee848b849439654c89665c65c9f`
- Requested device: `00008150-00120CEE3E40401C` (iPhone 17 Pro Max,
  iOS 26.5.2)
- Outcome: invalid before browser launch; zero checks ran.
- Recorded failures across the four isolated session attempts: SafariDriver
  reported the requested phone as disconnected, locked, or not paired.
- Independent diagnosis: CoreDevice and `xctrace` could inventory the paired
  phone over the local network, but macOS USB inventory did not contain it.
- Disposition: retain the raw and aggregate receipts and repeat the complete
  four-cell run only after the phone is physically connected with a
  data-capable cable, unlocked, awake, and reachable by SafariDriver.

The aggregate receipt is
`step4-ui-claims-ios-safari-physical-text.invalid-device-unavailable.json`.
Raw receipts are retained under
`../../results/phase4-ui-claims/invalid/2026-07-26-device-unavailable/raw/`.
