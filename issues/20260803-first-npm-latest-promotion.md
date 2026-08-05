# First npm `latest` promotion of the nine-package surface

**Status:** Open — authorized, sequenced as the wave capstone
**Opened:** 2026-08-03 (Charlie: "pull the trigger", follow-on ratification
in `issues/20260802-author-decision-packet.md`)
**Systems:** Packaging, Deployment, Testing
**Related:** LLP 0074 (parallel npm gate — the authorizing ruling), LLP 0134
(maturity promotion machinery — the qualification bar), LLP 0122 (nine-package
closure and packaging facets), LLP 0145 (client bundle metrology), LLP 0148
(id registry — `@expo/snapback-*` scope facts)

## Running log

- **2026-08-05 — green source proof and qualified staging complete; two
  fail-closed production gaps stop publication.** Candidate source
  `4c8245a1a05e4f5f724771e7557f9a583bac2410` has green main local-proof run
  `31035872210`: the structured artifact contains 119 `PASS`, the two expected
  `NOT_SELECTED` gates (`cargo-test-profile-clean`, `swift-client`), and zero
  failed or blocked gates; JSONL SHA-256
  `8cdba690c1870d9bb56d63cd5d63259ff91bfb503ef82864e3bae2cfe4108a12`.
  Qualified EAS staging run `019fd366-7f4c-7998-a1ff-1c4382ac338d` is green
  for `0.1.9` at that exact source: both runtime builds, nine-package
  assembly, both staged cold installs, and final retention succeeded. The
  retained release archive SHA-256 is
  `feea37839dfd2e426eab0b1376886fe8972a86af20d98c6b166a348e77249b81`;
  qualified ledger file SHA-256
  `f1501bd223eea5f69366624177e6c2530d900657ebc820d7c6e1940bab0b41cd`
  (self-digest
  `8a4a171700087032bab5cf780f3769678d9ba9a219583e955d5fdd8c46ed8b29`);
  macOS/Linux receipt SHA-256 values
  `99f491e231109c37492d419366275cfc21577774598395ad10c6a7e9e7f0db6f`
  and
  `464fed1f7ad6c5ace22805bdc58abf9284c21e240017e27de7af3cd289ff7b80`.
  First production use then stopped before npm mutation for two recorded
  reasons: the instruction names no capability transition from which LLP
  0134 can honestly construct its required maturity receipt
  (`issues/20260805-0134-npm-promotion-route-undefined.md`), and the real
  publication validator rejects the EAS receipts because it still requires
  GitHub-hosted provenance
  (`issues/20260805-eas-qualified-receipts-rejected-by-publish-validator.md`).
  No candidate tag or `latest` tag was changed; the nine-package public vector
  remains `latest: 0.1.8`.

- **2026-08-03 — PUSH-01 is closed and no longer caps promotion.** The local
  `notifications.expoPushSeam` surface has its packaged fake-provider kit and
  a retained physical iOS development-build ticket/receipt witness with both
  statuses `ok`. The scoped guide row is shipped. The broader first-class
  `notifications` capability correctly remains false under LLP 0045, and the
  complete hosted push conjunction remains Missing. PUSH-01 therefore
  unblocks this npm-promotion capstone without widening the package claims.

Execute the first real promotion of the locally-provable nine-package
surface to npm `latest`, under the 0134 evidence bar — not judgment:

1. **Preconditions (all must hold at execution time):** a green local-proof
   run on the promotion's `candidateSourceSha`; the wave's feature landings
   complete and the closing greening batch pass done; the staged-registry
   cold-install rehearsal green (the qualified staging lane).
2. **Run the LLP 0134 machinery for real:** per-route soak witnesses with
   digest-bound `soakEvidence`, a promotion receipt pinned to
   `candidateSourceSha`/`stagedTreeManifestSha256`, records under
   `tests/acceptance/maturity/`. This is the machinery's first production
   use — expect and file honest gaps.
3. **Honesty sweep before publish:** capability index and package READMEs
   claim only what the local surface proves; hosted-dependent capabilities
   stay gated (ruling 1); `notifications` reflects push-01's actual state
   at publish time.
4. **Publish** the nine-package closure to npm `latest` under the
   `@expo/snapback-*` scope, then verify a from-scratch
   `npm install`/cold-start against the published artifacts (not the staged
   registry) and record the receipt here.
5. Dated implementation-record notes on LLP 0074 and LLP 0122; LLP 0115
   board row updated.

Per Charlie's standing release-cadence guidance (packet ratification,
2026-08-02): pre-release, aggressive repeated releasing is intended —
subsequent promotions should get cheaper and more frequent, not rarer.

**Exit:** packages live on npm `latest` with the promotion receipt recorded
here and the cold-install-from-npm verification green; ticket closes citing
the published versions.
