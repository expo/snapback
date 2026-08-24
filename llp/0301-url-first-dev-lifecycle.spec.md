# LLP 0301: URL-first dev lifecycle — server, CLI, and wire contract

**Type:** Spec
**Status:** Accepted
**Systems:** Server, CLI, Local server lifecycle, Auth, Templates, Guide,
Diagnostics
**Author:** Claude (Fable 5), commissioned by Charlie Cheever (standing
overnight directive 2026-08-24: RFC → refine → Specs → refine →
implementation)
**Date:** 2026-08-24
**Revised:** 2026-08-24 (g — Review → Accepted; the refine loop never
applies acceptance — this transition is applied by the orchestrator under
the author's standing overnight directive of 2026-08-24, after the
cluster's dual READY per-target and set verdicts)
**Revised:** 2026-08-24 (g — post-freeze implementation correction: the
shipped legacy receipt reader is strict (`exactRecordKeys`), so an
already-shipped CLI refuses ANY receipt carrying the new field with its
existing typed unknown-field error — safe, no adoption. The §3 matrix's
legacy-tolerance cells claimed behavior legacy readers do not have; the
corrected cells: old-CLI x new-supervised and old-CLI x new-plain both
REFUSE via the existing unknown-field refusal; new-CLI cells unchanged.
Cross-version dev attach is resolved by using one CLI version, stated in
the migration text.)
**Revised:** 2026-08-24 (f — punch-list round-4 corrections: `localhost.`
reclassified from the syntax set to the host-policy set (a canonical
trailing-dot origin is admissible in an explicit allowlist); §8.2 worded
against the host-policy accepts)
**Revised:** 2026-08-24 (e — post-freeze corrections from punch-list round
3: vector table split into syntax vectors (all surfaces) vs host-policy
vectors (fixed-set surfaces only); acceptance updated to the six §3 cells)
**Revised:** 2026-08-24 (d — round-2 revision, after which the normative
surface is FROZEN per the Spec-type default: canonicalization split into
syntax vs host policy (tunnel origins admitted in explicit lists); the
mixed-version attach cells rewritten from legacy-CLI behavior with a
stated dev-only safety note; §9 downgraded to an explicitly deferred
non-normative sketch; a diagnostic-code matrix pinning every typed branch;
writer zero-block insert rule; supervised URL print restored; §2 wording
tied to §2b)
**Revised:** 2026-08-24 (c — round-1 revision: `startupNonce` dropped from
the fact; caching rules; posture variable specified as spawn-owned; receipt
writer/reader matrix + attach contract; dev-session full contract on the
existing managed admin token; canonicalization algorithm + shared vectors;
Origin-less rule; writer atomicity/duplicate rules; documentary
deliverables and the nine-row traceability table added; signed discovery
designed at spec altitude, implementation excluded from this set)
**Revised:** 2026-08-24 (b — Draft → Review at loop start)
**Revised:** 2026-08-24 (a — initial draft)
**Related:** LLP 0300 (Accepted — the governing RFC), LLP 0299, LLP 0302
(the client-side sibling), LLP 0010, LLP 0181, LLP 0223

## Summary

> **Scope freeze (2026-08-24).** Per LLP 0010 §2's Spec-type default, the
> normative surface of this Spec froze after the round-2 revision (d):
> subsequent revisions make corrections and restorations only, and any
> demand for new normative closure is recorded as an obligation, never
> folded as new prose.


The server/CLI half of LLP 0300: the identity-discovery wire contract, the
path-split origin-admission implementation, the receipt posture field, URL
printing and the opt-in `.env.local` writer, the explicit dev-session
command, the two-process template flip, and the documentary deliverables.
The client half is LLP 0302; this Spec owns everything the client calls.

## 1. The identity fact

- **Route:** `GET /_snapback/api/app/identity` (unauthenticated; no other
  method; no redirects — a 3xx is never followed by clients and never
  emitted by the server). Served by development-profile servers only; a
  Prod-profile server refuses `404` with body code
  `SNAPBACK_APP_IDENTITY_UNAVAILABLE`.
- **Shape** (`formatVersion: "snapback.app-identity.v1"`) — identity and
  posture only, exactly LLP 0300's ruling:

  ```json
  {
    "formatVersion": "snapback.app-identity.v1",
    "deployment": { "…": "DeploymentIdentity, §2a" },
    "admissionPosture": "loopback-any" | "explicit-list"
  }
  ```

  No `startupNonce`, receipts, tokens, ports, lease or reaper state, or
  foreign-listener facts. Restart/replacement detection is transport-based
  (LLP 0302 §3), not nonce-based.
- **Caching is forbidden:** the response carries
  `Cache-Control: no-store` and no validator headers (no ETag /
  Last-Modified); clients fetch with cache bypass (LLP 0302). A cached
  identity would defeat mix-up detection across a same-origin process
  replacement.
- CORS: the route follows §2's admission; **Origin-less** requests
  (headless Node, curl — non-browser callers that send no `Origin`) are
  admitted on the dev surface under both postures, per the existing
  non-CORS rule: the origin check governs browser-origin-bearing requests
  only. This is stated, tested (§8), and is the same same-machine trust
  the bearer model already assumes.

### 2a. DeploymentIdentity — the one comparator

The fact's `deployment` is the active `DeploymentIdentity` exactly as the
operational-readiness fact serializes it today (camelCase JSON of the Rust
type — the Spec pins the *existing* schema, not a new one). Equality —
used by the wire gate (LLP 0302 §3) and by generation-provenance matching
(LLP 0302 §1) — is **field-wise strict string equality of that type's
digest-bearing fields after JSON parse**; never object reference equality.
An unknown `formatVersion`, or a `deployment` missing a digest field, is a
malformed fact (connect refusal naming what was malformed). Mismatch
diagnostics carry both serialized identities.

## 2. Origin admission — the path split, implemented

One server-side input decides posture: `SNAPBACK_DEV_ADMISSION_POSTURE`.

**Trust boundary, specified:** `runDev` **constructs** the backend child's
environment and **always overwrites** this variable — it is never inherited
from the caller's environment. `loopback-any` is set iff the spawn has no
explicit origin declarations; otherwise `explicit-list` plus the union
allowlist. The server may trust the variable because it is spawn-owned,
not because it is secret; setting it by hand is unsupported and equivalent
to replacing the lifecycle owner. A value that is missing, unrecognized,
or inconsistent with its accompanying list (the posture × list pairs
below) **refuses startup** with `SNAPBACK_DEV_ADMISSION_POSTURE_INVALID` —
never a silent downgrade in either direction.

Posture × list pairs (exhaustive):

| Posture | `SNAPBACK_DEV_AUTH_ORIGINS` (as passed to the child) | Meaning |
| --- | --- | --- |
| `loopback-any` | unset/empty | plain profile, no declarations: admit any literal loopback origin |
| `loopback-any` | non-empty | **invalid** — refuse startup |
| `explicit-list` | non-empty | the complete allowlist (plain: union of declarations; supervised: merged exact origins) |
| `explicit-list` | unset/empty | **invalid** — refuse startup |

- **Literal loopback matcher:** after §2b canonicalization, hostname
  string-equal to `localhost`, `127.0.0.1`, or `[::1]`, any port, via a
  new shared normalizer `canonical_dev_client_origin` that **extends**
  today's `canonical_loopback_http_origin` — named honestly as an
  extension, with no DNS resolution ever performed.
- **Plain profile:** no declarations → `loopback-any`. Declarations
  (`SNAPBACK_DEV_AUTH_ORIGINS` and/or `--external-client-origin`) →
  `explicit-list` with the union; flag-only is the singleton complete
  allowlist. The flag keeps its `--port` requirement and `--expo` refusal.
- **Supervised `--expo`: unchanged.** Injected exact origins; caller env
  merges and never drops injected origins; the child receives
  `explicit-list` + the merged list.
- Note: `10.0.2.2` is the Android emulator's NAT alias for host loopback —
  it is a *URL host* (LLP 0302 §2), never an Origin-allowlist entry here
  (the browser never runs at a `10.0.2.2` origin).

### 2b. Origin canonicalization and host policy — separated

**Syntax (all surfaces):** parse with the WHATWG URL parser; refuse on
parse failure, credentials, non-empty path (other than `/`), query, or
fragment; require scheme `http`/`https`; lowercase the hostname; the
canonical form is the parser's `origin` serialization. This syntactic rule
alone governs entries in an **explicit allowlist**
(`SNAPBACK_DEV_AUTH_ORIGINS` / `--external-client-origin`): a declared
origin may be any canonical HTTP(S) origin, tunnels included —
`https://lane.trycloudflare.com` is a valid explicit entry (LLP 0300 P2 /
Acceptance 3).

**Host policy (fixed-set surfaces):** after canonicalization, the
post-parse hostname must be **string-equal** to the surface's literal set:
the `loopback-any` matcher admits `localhost`, `127.0.0.1`, `[::1]`;
LLP 0302's URL admission adds `10.0.2.2`.
Parser normalization is the canonicalizer: `127.1` normalizes to
`127.0.0.1` and is thereby admitted; `localhost.` (trailing dot) does not
normalize away and is refused; default ports normalize to none; the
canonical form is the parser's `origin` serialization. **Shared vectors, in two sets.**
*Syntax vectors (every consumer, every surface):* accept →
`http://127.0.0.1:4287`; `http://localhost:5173/`; `https://[::1]:8443`;
`http://127.1:4287` (→ `127.0.0.1`); `HTTP://LOCALHOST:80` (→
`http://localhost`); `https://lane.trycloudflare.com`; refuse (syntax):
`http://127.0.0.1:4287/path`, `http://user@127.0.0.1`, `http://127.0.0.1?x`,
`ws://127.0.0.1`, and any parse failure. *Host-policy vectors (fixed-set surfaces only —
`loopback-any` matcher and the LLP 0302 URL surface):* additionally refuse
`http://localhost.` (the parse-preserved trailing dot is not a fixed-set
literal, though it is a canonical origin admissible in an explicit
allowlist), `http://attacker.dev` (even if DNS-loopback),
`http://0.0.0.0`, `http://192.168.1.10:4287`,
`https://lane.trycloudflare.com`; the LLP 0302
URL surface alone accepts `http://10.0.2.2:4287`. An explicit allowlist
applies the syntax vectors only.

## 3. Receipt posture — writer matrix, reader rule, attach contract

`snapback.application-ready.v1` gains one optional field
`admissionPosture`:

| Run | Writes |
| --- | --- |
| Plain, no declarations | `admissionPosture: "loopback-any"`, `clientOrigins: []` |
| Plain, with declarations | `admissionPosture: "explicit-list"`, `clientOrigins` = the complete union |
| Supervised | `admissionPosture: "explicit-list"`, `clientOrigins` = merged exact origins (unchanged bytes plus the new field) |
| Legacy receipt (field missing) | read as `explicit-list` |

**Reader rule:** under `loopback-any`, `clientOrigins` is
declarations-only and MAY be empty — it is **never** the allowlist; a
reader must not interpret empty as "admit nobody".

**Attach contract:** an attaching CLI cannot change a running server's
posture. A **new** CLI compares the *requested* admission contract
(posture + declarations) against the *recorded* one; on mismatch it
refuses with `SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH` naming both (no
adoption, no restart side-effect). A **legacy** CLI runs only the
comparison it already ships — requested-vs-recorded origin *lists* — and
the cells below claim nothing a legacy CLI cannot execute:

| CLI | Receipt | Attach outcome |
| --- | --- | --- |
| old | old | today's behavior |
| old | new supervised | **refuses** — the shipped legacy reader is strict (`exactRecordKeys`) and rejects the unknown `admissionPosture` field with its existing typed error; safe, no adoption (corrected, revision g) |
| old | new plain | **refuses** — same strict-reader refusal (corrected, revision g) |
| new, no declarations (requests `loopback-any`) | old (`explicit-list`) | refuses (`SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH`); deliberate restart is the operator's move |
| new, declarations matching the recorded list | old | succeeds |

Readers ship before writers within one publication.

## 4. `snapback dev` prints the URL; the opt-in writer

- On every `ready`/attach/rebind of a plain-profile backend the CLI prints
  the human line `SNAPBACK_URL=http://127.0.0.1:<port>` plus an
  Android-emulator note, and emits `--json` fields `snapbackUrl` and
  `androidEmulatorUrl` (camelCase; the human line keeps the env spelling).
- The backend-origin line prints on the supervised profile too (additive
  to its readiness output), so both profiles expose the same fact.
- `--write-env [path]` (default `./.env.local`; opt-in only): writes
  `EXPO_PUBLIC_SNAPBACK_URL`, `VITE_SNAPBACK_URL`, `SNAPBACK_URL`, each
  byte-equal to the printed `snapbackUrl`, inside exactly one marker block
  (`# >>> snapback dev >>>` … `# <<< snapback dev <<<`). Rules: atomic
  replace (temp file + rename) preserving unrelated bytes and file mode;
  refresh after every ready/attach/rebind that changes the origin, with
  the bundler-must-restart caveat printed on rewrite; a missing file or zero
  snapback blocks means **insert** (first write); refusal —
  `SNAPBACK_DEV_ENV_WRITER_CONFLICT` — is for duplicate or malformed
  blocks, a managed key present *outside* the block, or a manually
  uncommented Android line; an Android `10.0.2.2` line may be written **commented**
  inside the block; a manually uncommented value is never silently
  overwritten (the writer refuses as above). No credential bytes ever (LLP 0300 P4); unignored
  target file → warn.
- Android-emulator teaching (start packets): paste `androidEmulatorUrl` by
  hand; the writer's block is the host-loopback value.

## 5. `snapback auth dev-session`

- **Target resolution:** `--ready-file <path>` wins; otherwise the
  conventional plain-profile ready file the current directory's project
  writes (the same default path `runDev` uses). Ambiguity (no file, stale
  receipt, dead pid) refuses `SNAPBACK_DEV_SESSION_TARGET_MISSING` with
  the path(s) tried; the descriptor is verified with the existing
  ready-receipt validation before use.
- **Admin capability:** the store's **existing** managed admin artifacts
  (the ready descriptor + the managed admin token the store already
  maintains — the same seam the supervised mint uses today). This command
  adds **no new on-disk credential**; it reads what `runDev`-managed
  stores already hold.
- **Semantics:** `--email` defaults to the existing supervised-mint
  default identity; mints an ordinary session; prints to stdout only —
  human form `bearer` + `expiresAt`, `--json` form
  `{ "formatVersion": "snapback.dev-session.v1", "email", "bearer",
  "expiresAt" }`; stderr carries diagnostics only. Mint-mode refusals
  reuse the existing supervised-mint refusal codes verbatim.
- Plain `snapback dev` prints the instruction naming this command; it
  never runs it. `--expo` issuance is unchanged.

## 6. Templates go two-process

As before (expo-chat/react/crud-dashboard: `"dev"` = backend +
`--write-env`; `"dev:client"` = bundler; `"dev:supervised"` on expo-chat;
media-feed follows), plus: `--client <dir> --client-command <cmd>` remains
a non-allocating child launcher and is not the template shape; migration
text names the leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT` footgun.

## 7a. Diagnostic-code matrix (pinned before the freeze)

| Branch | Code |
| --- | --- |
| Posture/list invalid at startup | `SNAPBACK_DEV_ADMISSION_POSTURE_INVALID` (new, Rust) |
| Identity route on Prod | `SNAPBACK_APP_IDENTITY_UNAVAILABLE` (new, Rust) |
| Attach admission mismatch (new CLI) | `SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH` (new, JS) |
| Writer structural conflict | `SNAPBACK_DEV_ENV_WRITER_CONFLICT` (new, JS) |
| dev-session target missing/stale | `SNAPBACK_DEV_SESSION_TARGET_MISSING` (new, JS) |
| dev-session mint-mode refusals | existing supervised-mint codes, verbatim |
| Malformed identity fact (client) | `SNAPBACK_APP_IDENTITY_FACT_INVALID` (new, JS — LLP 0302 §3) |
| declared-dev URL refused | `SNAPBACK_APP_BINDING_URL_INVALID` (new, JS — LLP 0302 §2) |
| Unbranded / generation-mismatch declared-dev candidate | `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED` (new, JS — LLP 0302 §1) |

All new codes are s5_d10-classified with the landing.

## 7. Documentary deliverables (owned here)

- `guide/clients/react-expo.md`: restructured URL-first-first (two-process
  bring-up, one env var, bundler restart caveat, native bundler pinning
  for persistence-sensitive lanes), supervised path demoted to the
  appendix section.
- Start packets (`guide/start/expo-chat.md`, `react.md`,
  `crud-dashboard.md`, `media-feed.md`): two-terminal shape first;
  Android-emulator manual paste; supervised appendix pointer.
- LLP 0181 and LLP 0223 dated amendment notes (supervised baseline → one
  of two admitted dev sources; client process ordinarily caller-owned),
  per LLP 0300 migration step 4. LLP 0299's own amendment is already
  landed.
- Diagnostics: the new codes here and in LLP 0302 are Rust/JS-classified
  per the s5_d10 table as part of the landing (registry + classification
  updated together).

## 8. Acceptance (server/CLI half) + set-level traceability

1. Identity fact: dev serves the v1 three-field shape with
   `Cache-Control: no-store` and no validators; Prod refuses typed; an
   Origin-less GET succeeds under both postures.
2. Admission: loopback-any admits the host-policy accepts on any port and
   refuses every syntax refusal and every host-policy refusal (rebinding
   hostname and trailing-dot included); an explicit allowlist admits its
   syntax-canonical entries, tunnel origins included;
   tunnel-only explicit list refuses loopback unless restated; flag-only
   equals singleton list; supervised merge never drops injected origins;
   an SSH/devcontainer-forwarded literal-loopback URL works end-to-end
   (LLP 0300 row 3); posture×list invalid pairs refuse startup.
3. Receipt: the six §3 CLI×receipt cells land on the §3 outcomes; attach
   posture-mismatch refuses; supervised battery green with the additive
   field.
4. Writer: refresh-on-rebind; no-clobber; single-block enforcement;
   outside-duplicate refusal; atomicity (kill mid-write leaves old or new,
   never a torn file); byte-equality with the printed URL; no credential
   bytes; warn-on-unignored; Android commented-line rules.
5. dev-session: mints against a running plain backend; typed refusals
   (missing/stale/dead target, mint-mode); stdout-only; a filesystem sweep
   of the project and store shows no new credential artifact.
6. Hostile-origin boundary (LLP 0300 row 9, server side): second-origin
   signup succeeds as a new principal under loopback-any; that origin
   cannot obtain the first origin's bearer (one custody assertion); an
   explicit list excluding it refuses even signup.
7. Template cold bring-up (row 1): two terminals, one env var, logged-out
   boot, ordinary signup, per template.

**Set-level traceability (jointly with LLP 0302 §8):** LLP 0300 rows →
batteries: 1 → 0301.7 + 0302.5; 2 → 0302.5; 3 → 0301.2 (forward + tunnel
+ rebinding); 4 → 0302.2; 5 → 0302.1 (successful release matrix, URL set);
6 → 0301.3 (+ existing supervised battery); 7 → 0302.5; 8 → 0302.6 (incl.
backend-data preservation and ordinary re-sign-in); 9 → 0301.6 + 0302.5.
Every row names at least one executable battery; the implementation ships
this table as a checked test-inventory comment.

## 9. Signed discovery — explicitly deferred (non-normative sketch)

The normative design is **deferred to a future Spec** and is not part of
this implementation set (tracked by an issue filed at landing). The
non-normative sketch — a store-minted dev-identity key signing the fact,
a fingerprint delivered out-of-band, refusal when configured — carries
known open problems a future Spec must solve before anything freezes:
public-key carriage (a fingerprint alone verifies nothing), replay by a
replacement listener (freshness/transport binding), and rotation. Nothing
in this set's wire contract precludes the future additive
`identitySignature` field. Shared-host lanes are the trigger audience.

## 10. Out of scope

The client gate, source arms, generated-kind mechanics, per-bundler
consumers (LLP 0302); implementing §9.
