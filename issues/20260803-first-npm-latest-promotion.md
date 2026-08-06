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

- **2026-08-05 — source-checkout consumer found a non-hermetic local package
  edge.** Relay Room installed `@expo/snapback-client` and
  `@expo/snapback-react` from local `file:` paths, but the client's exact
  `@expo/snapback-contract@0.1.0` dependency still resolved through the
  registry and stopped installation because that version was unavailable.
  The app required both an explicit local Contract dependency and an
  `overrides` entry. This is tracked separately in
  `issues/20260805-local-source-package-closure-needs-contract-override.md`.
  Publishing a coherent closure should make the registry path green, but the
  promotion proof should also cover a source-checkout/file consumer so local
  development cannot silently mix checkout packages with registry packages.

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

- **2026-08-06 — Lane D preflight complete; 0.1.9 goes fast-path; two structural gaps filed.** Full machinery mapping found (a) the qualified `--publish` path is structurally unrunnable — the receipt validator demands GitHub-hosted provenance from the deleted `.github/workflows/qualified-package-staging.yml` while staging now runs on EAS, which mints `githubProof: null` (`issues/20260806-qualified-publish-eas-provenance-blocker.md`); and (b) checklist item 2 (LLP 0134 for real) is not achievable inside this window — E6 requires 14 consecutive same-UTC-day-committed soak observations, and exactly one (now-lapsed) observation exists. Per this ticket's own "expect and file honest gaps" language and LLP 0041's standing pre-consumer fast-path ruling, 0.1.9 executes on the 0.1.8 fast-path shape at candidateSourceSha e32f35eb3, with the local proof, linux-x64 attested fleet build, honesty sweep, publish, ledger retention, public cold-install verification, and same-change guide closure sweep all retained. The 0134 soak window starts as its own 14-day program, decoupled from npm promotion. Also filed: `issues/20260806-linux-runtime-fleet-recipe-unscripted.md`.
