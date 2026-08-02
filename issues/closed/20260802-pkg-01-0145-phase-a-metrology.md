# PKG-01: LLP 0145 Phase A/B — closure metrology ratchet + low-risk packaging savings

**Status:** Closed
**Systems:** Packaging, Client SDK, Testing
**Related:** LLP 0145 (Research — its §Status authorizes exactly this),
LLP 0063 WS8 (vite-cost-attribution machinery to extend), LLP 0147
(Accepted — consumes these numbers)

The work LLP 0145 itself authorizes, independent of everything else:

- **Phase A — size ratchet:** attribute the shipped client closure
  (bundle bytes by package/module, per profile), freeze the absolute
  baselines at first run (D-B ruling), and install the gate-13 relative
  threshold so regressions fail visibly.
- **Phase B — low-risk savings:** the packaging hygiene items 0145
  identifies that change no semantics (dead exports, duplicate deps,
  boundary cleanups). Land only what needs no wire/API decision.

Explicitly NOT here (0145's own nonclaims): no wire-protocol change, no
default-profile migration, no LLP 0114 seam amendment, no browser-default
change. The thin-profile spike itself is PKG-02's (0147's Phases A–B).

**Exit:** the attribution report is reproducible (script + committed
baseline), the ratchet gate runs in the proof lane, and the savings are
each individually measured in the report.

## Running log

### 2026-08-02 — Phase A baseline and ratchet

- Added `scripts/client-bundle-metrology.mjs`, eight named application/API
  profiles, and automatic coverage for all sixteen public JavaScript
  subpaths. Each profile records minified, gzip-9, and Brotli-11 bytes plus
  package/module attribution and the normalized esbuild metafile.
- Froze the pre-optimization baseline at main revision
  `f3ceb9258c4c1fe757bf59e5fa7150886ec5edc1`. The receipt records and verifies
  that commit's exact client, contract, and React package tree objects. It also
  pins Node 24.18.0, zlib 1.3.1-e00f703, Brotli 1.2.0, esbuild 0.28.1, the root
  lock digest, fixture digest, conditions, target, and compression settings.
- Installed the non-growth check in `scripts/verify-local-proof`. A valid
  baseline cannot be overwritten; new profiles must be added prospectively.
- This is a package-closure extension of LLP 0063 WS8. The fixture README
  explains why export-map discovery and per-subpath compression need a
  separate runner while retaining WS8's stable attribution boundaries and
  leaving the Partitime four-layer Vite ledger authoritative for applications.

Selected frozen Full ceilings, in minified / gzip / Brotli bytes:

| Profile | Frozen baseline |
| --- | ---: |
| operation call | 272,262 / 76,427 / 65,110 |
| operation + live | 272,292 / 76,436 / 65,086 |
| sessions | 272,704 / 76,515 / 65,140 |
| Full public surface | 367,815 / 101,688 / 84,807 |
| React, React external | 45,331 / 14,282 / 12,508 |
| complete React import fixture | 45,502 / 14,333 / 12,558 |

### 2026-08-02 — Phase B experiments stopped at the no-semantics cutline

- A browser-conditioned default-resolver experiment removed 11,431 minified
  bytes and roughly 3.3 kB gzip from the ordinary operation closures. Strict
  import-graph inspection then showed that the root barrel still reached the
  Node file store through its public file/Expo re-exports. Completing the cut
  would require a browser refusal implementation or removal/change of those
  public root exports, which is a semantic/API boundary rather than packaging
  hygiene. The experiment was dropped; no partial reachability claim remains.
- A package-wide `sideEffects: false` experiment was also dropped. It improved
  the main closures but made the standalone file-store gzip receipt four bytes
  worse; the frozen compressed ceiling correctly rejected it.
- No Phase B saving lands in PKG-01. `current.v1.json` is intentionally equal
  to the frozen baseline (zero savings in all profiles), proving the initial
  ratchet reproduces cleanly. The environment split belongs to PKG-02/LLP 0147
  unless a later no-semantics implementation clears every public-subpath and
  behavioral gate. No unrelated micro-edit or threshold exception was used to
  manufacture a nominal saving.

### 2026-08-02 — maintained carrier/application acceptance

- Current-source Expo/Metro closure: installed the locked
  `demos/partiful-matrix/native/react-expo` fixture and ran `expo export
  --platform ios`. Metro bundled 607 modules into a 2,704,748-byte Hermes
  artifact. Its string table contains the native file-store format/lock and
  `no-native-files-registered` branch, proving the `react-native` condition
  retained the existing native resolver and its one-per-launch file-store
  behavior.
- Complete external-package application: the retained Snapback incident-room
  fixture installed its public 0.1.8 lock, regenerated, built a 456.21 kB
  application bundle (132.75 kB Vite gzip), passed static acceptance, and
  passed all seven live scenarios (auth-scoped reads, search partitioning,
  cross-client live delivery, atomic writes, the retained asset GAP witness,
  ephemeral presence, and action/cron behavior).
- The authoritative materialized-tarball release witness remains
  `scripts/snapback-package-cold-install.mjs`; it runs fresh React real-browser
  live acceptance and a packed Expo Metro export. This ticket reuses that
  maintained seam instead of introducing a second cold-install pipeline.

### 2026-08-02 — explicit PKG-02 dependency

LLP 0145 D-B's gate-13 rule remains in force: Micro reconnect bytes,
reconnect latency, and startup must each be no worse than Full on the same
workload. PKG-01 has no Micro runtime and therefore records no comparative
verdict. PKG-02 must run and retain that paired operational workload when its
Micro candidate exists. This is a downstream execution dependency, not a
waiver, and PKG-01 claims only Full closure metrology plus the rejected
experiments recorded above.

### 2026-08-02 — final proof record

- `node scripts/client-bundle-metrology.mjs --check` under the receipt-pinned
  Node 24.18.0: **PASS**, 24 profiles, package/client/browser/React behavior
  smokes green, no ceiling regressions.
- Full `packages/snapback-client` package suite and strict typecheck: **PASS**.
- `./ref-check --verbose`: **PASS**, 158 LLP documents, 2,925 refs, 0 errors.
- `scripts/bootstrap-ibex-runtime`: **PASS**, exact link, launch, and restricted
  handler-VM qualification on `f3ceb925`.
- Full `cargo test --lib`: inherited **FAIL before tests** because main lacks
  the generated Todo/RBAC manifests included by `src/embed.rs`,
  `src/seed_identity.rs`, and `src/storage.rs`. PKG-01 does not generate or
  alter those unrelated demo artifacts.
- Full `packages/snapback-react` suite: all runtime tests **PASS**; inherited
  final strict typecheck **FAILS** because
  `demos/signal-desk/snapback/generated/api.d.ts` is absent, followed by the
  expected `never`-projection errors in `exact-result-types.fixture.ts`.
- `node scripts/check-guide.mjs`: inherited **FAIL** on missing generated
  snippet sources under competitive-checkpoint and todo-v2 plus the resulting
  stale guide manifest. PKG-01 changes no guide authoring surface and does not
  regenerate unrelated demo/guide artifacts.

## Resolution

Resolved by `a2f658a2` on 2026-08-02. The landing freezes the machine-verifiable
24-profile pre-optimization baseline, installs its non-growth gate in the local
proof, records the maintained Metro and complete external-application evidence,
and stops both packaging experiments at the no-semantics/ratchet cutlines. No
Micro operational verdict or browser file-store extraction is claimed; those
remain explicit PKG-02 dependencies above.
