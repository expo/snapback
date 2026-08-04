# Admin console: claim-link reachability affordances (--qr, --tailscale, --lan)

**Date:** 2026-08-03
**Status:** Resolved (2026-08-03)
**Area:** Admin console / operator auth (LLP 0017)

## Problem

`snapback admin link` (landed via
`issues/closed/20260803-admin-console-claim-links.md`) prints a loopback URL.
That covers a browser on the same machine, and `--url-base` covers an
operator who already runs a tunnel — but the two commonest real postures
still need manual plumbing: a phone on the same Wi-Fi, and a device on the
operator's tailnet. And a phone wants a QR code, not a URL to retype.

## Design (authoritative)

LLP 0017 §Security Defaults, the "reachability affordances" passage, plus the
reachability row in §Validation Requirements. The design went through a
dual-family delta review round (both families NOT READY on the first draft;
the LLP text incorporates every fix — see `llp/reviews/0017-*` 2026-08-03
reachability sections for the WHY behind each constraint). Read the LLP
passage in full before building; the summary here is not a substitute.

Key structure:

- The affordances are honestly **delegated ingress**: a Snapback-owned front
  makes the loopback exchange reachable elsewhere for a bounded lifetime.
  `--url-base`/`--tailscale`/`--lan` are mutually exclusive; `--qr` composes
  with any (byte-identical encoding; loopback-QR prints a reachability hint).
- **Origin contract**: the CLI registers the published origin
  master-authenticated for exactly the affordance's lifetime; teardown drops
  it. The front never rewrites Origin/Host toward loopback; the relay
  accepts only its generated Host and absent-or-registered Origin on writes
  and WS upgrades.
- **`--tailscale`**: serve proxy path-scoped to `/_snapback`; HTTPS via
  tailscale; tagged mappings + owner-only reference-counted receipts;
  last-out compare-and-delete cleanup; stale-sweep on next invocation after
  a crash (residue window accepted in the LLP); never touch operator-made
  mappings; conflicts with `--no-wait`; absent tailscaled = stable refusal.
- **`--lan`**: `--lan[=<addr|interface>]`; no-arg binds the single up
  non-loopback non-virtual interface or refuses listing candidates; no
  wildcard binds; no-TTY ambiguity refuses. Plain HTTP is an **explicit
  ruled posture** with a mandatory mint-time warning naming the exposure and
  compensating controls, steering hostile-network use to `--tailscale`.
- **Relay discipline**: sole request parser per connection; origin-form
  targets only; canonicalize before prefix match; refuse conflicting
  CL/TE, CONNECT, pipelined follow-ons, absolute-form, spoofed forwarding
  headers; strip hop-by-hop; WS upgrade only after path+Origin policy.
  Forwards ONLY console shell/assets + claim exchange +
  credential-authenticated `/_snapback/api/*`; categorically refuses the
  master-exchange route and any request bearing `x-snapback-admin-token`.
- **Fail-closed lifetime**: server-issued lease bound to claim digest then
  credential digest, renewed over the attached observation channel; listener
  closes within one lease interval of revocation/expiry/observation
  loss/startup-nonce change; dies with the CLI; conflicts with `--no-wait`;
  concurrent claims never share relays.
- **Storage**: reachability-session credentials live in tab-scoped
  `sessionStorage` keyed to session + instance identity; never restored
  against a mismatched backend; CLI revokes the bound credential on early
  front termination; client clears on observed expiry/revocation.
- **Settled-text rider**: master-exchange attempts join the rate/cap-bounded
  operations.

## Work items

1. Server: lifetime-scoped registered-origin admission (master-gated
   register/drop), relay lease issue/renew bound to claim→credential digest,
   master-exchange rate bound, stable `SNAPBACK_*` diagnostics.
2. CLI `--qr`: QR encoding (small vetted crate), unicode half-block render,
   byte-identity, loopback-reachability hint.
3. CLI `--tailscale`: tailscaled detection, path-scoped serve
   mapping create/reuse via tagged receipts, last-out cleanup, crash sweep,
   `--no-wait` conflict, refusal diagnostics.
4. CLI `--lan`: interface enumeration/selection contract, sole-parser relay
   (canonicalization, framing refusals, header stripping, WS-after-policy),
   console-slice-only forwarding with master-route/master-header refusal,
   lease-driven fail-closed teardown, cleartext warning, relay-observed peer
   labeling, `--no-wait` conflict, origin-selector mutual exclusion.
5. Console client: tab-scoped `sessionStorage` for reachability sessions,
   instance-identity match before restore, clear on observed
   expiry/revocation.
6. Docs: LLP 0017 implementation-status flip; guide phone/tailnet recipes.
7. Tests — the LLP validation row is the checklist; highlights: adversarial
   framing corpus (absolute-form, encoded separators/dot segments, CL/TE
   conflicts, CONNECT, pipelining, forwarding-header spoofing, out-of-
   namespace upgrades); master-route and master-header refusal through the
   relay; origin registration lifetime (admitted during, refused after);
   Host/Origin enforcement incl. hostile values, preflights, WS handshakes;
   lease-driven teardown under unredeemed/redeemed restart, observer
   failure, revocation race, concurrent claims, graceful exit, SIGKILL;
   tailscale receipt lifecycle with a stubbed tailscale binary (create,
   reuse, concurrent owners, external mutation, crash sweep, operator-made
   untouched); interface-selection refusals; QR byte-identity; storage
   semantics on origin reuse/backend remap; end-to-end phone-shaped
   planted-link proof through a real relay.

## Landing decisions / deliberate non-goals

- Reattach (`--status`) remains observe-only. It does not recreate an
  invocation-owned listener or tailscaled mapping after that owner exits.
- Tab-scoped records are pruned lazily when the shared client starts or
  observes expiry, revocation, or an identity mismatch; no cross-origin
  browser-storage sweeper is added.

## Resolution (2026-08-03)

Implemented all seven work items in `1fa04da9a`, hardened the final
security/audit edges in `c4325a058`, and `38ce3c5fc` kept tailscaled
calls bounded while tolerating a heavily scheduled host and made early test
process exits report their stable diagnostic:

- added exact master-gated origin sessions and three-second claim-to-credential
  leases bound to the server startup identity, including opaque fail-closed
  handling when redemption races a dead lease and a pre-auth master-exchange
  attempt budget;
- added byte-identical half-block terminal QR output, receipt-owned
  path-scoped tailscaled serve publication, and the explicit-interface
  ephemeral LAN relay with the ruled-cleartext warning;
- made the relay the sole parser and serializer for its connection, with the
  canonical-path/framing/header/Host/Origin checks and narrow console slice
  required by LLP 0017; the master route and carriers never transit it;
- added last-out compare-and-delete tailscale cleanup, owner locks, stale
  crash sweeping, operator-mapping preservation, and bounded daemon calls;
- added tab-only session/instance-bound credential restore with public identity
  probes, no localStorage fallback, and clearing on terminal observations;
- updated LLP 0017 plus the admin-console phone/tailnet guide and route surface
  map; and
- added the real non-loopback planted-link test, adversarial framing corpus,
  graceful/SIGKILL/observer-loss/restart/concurrency lease cases, fake-tailscale
  lifecycle matrix, QR identity proof, and browser-storage/backend-remap tests.

After current main established its own pending-family diagnostic inventory,
`430ca7793` removed the superseded local fallback classifications so the
newer reviewed result-transform HTTP families remain authoritative.

Verification completed cleanly:

- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo build`
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test` (full suite;
  the ignored worktree-local remote-service cache was regenerated first with
  the repository codegen command so it matched the committed wire schemas)
- `bun run test` and `bun run build` in `admin-ui/`
- `node scripts/check-guide.mjs`
- `./ref-check --verbose` (168 LLP documents, 3,773 refs, zero errors or
  unchecked references)

## References

- LLP 0017 §Security Defaults (reachability passage) and §Validation
  Requirements (reachability row) — the governing text.
- `llp/reviews/0017-*` 2026-08-03 reachability round sections — rationale.
- `src/cli.rs` — `snapback admin link` attached observation loop (the relay's
  lifetime driver).
