# Physical iOS text supplement — invalid attempt

- Attempt revision: `4f88f323f082a7a07ded58bf341c56bd3564be32`
- Exact fixture revision: `4290bacbe2d42ee848b849439654c89665c65c9f`
- Device: `00008150-00120CEE3E40401C` (iPhone 17 Pro Max, iOS 26.5.2)
- Outcome: invalid before browser launch; zero checks ran.
- Recorded failure: the physical-only non-loopback Snapback spawn passed
  `--allow-insecure-dev-auth` but did not set the required non-production
  `SNAPBACK_PROFILE=test`, so the server failed closed with
  `SNAPBACK_AUTH_TRANSPORT_INSECURE`.
- Disposition: retain the raw and aggregate receipts, make the physical-only
  test profile explicit without changing the claim oracle or gate, rebuild the
  server from the committed source, and repeat the complete four-cell run.

The aggregate receipt is
`step4-ui-claims-ios-safari-physical-text.invalid-pre-test-profile.json`.
Raw receipts are retained under
`../../results/phase4-ui-claims/invalid/2026-07-26-pre-test-profile/raw/`.
