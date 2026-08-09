# P0: no end-to-end deploy path for a user app on any target — and no page states it

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P0 (posture statement) / P1-P2 (companions) · **Area:** guide/deploying / hosted-control / cloudflare deploy.sh / publish script

From the 2026-08-08 agentic surface audit (LLP 0202 P0 #2 and theme 8).

**The P0 is the missing statement, not the missing capability.** Each deploy
surface stops short honestly in its own corner, but the aggregate — *no
target can host an agent's own app end to end today* — is stated nowhere, so
an agent burns a session discovering it by exhaustion:

- `snapback deploy build` produces a target-neutral, deliberately
  activation-ineligible closure (`guide/deploying/releases.md:19-21`;
  `buildRelease` always `ok: true` with a `gaps` list).
- `deploy plan/apply` requires an adapter qualification the guide itself
  says cannot be produced today (`releases.md:255-259`).
- All 17 `snapback hosted lifecycle` verbs refuse up front with
  `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`
  (`packages/snapback-cli/hosted-control.mjs:96-97`, `:654-667`).
- `cloudflare/deploy.sh` deploys only the two hardcoded in-repo demos
  (`SNAPBACK_CF_APP` ∈ `notes|all-aboard`, `deploy.sh:19-37`) from a source
  checkout.

Fix: one `guide/deploying/index.md` (or a `deploy.hosting` GAP row) stating,
per target, the exact current stopping point and its tracking ticket
(`issues/20260726-0072-fly-adapter-remaining-surface.md`,
`issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md`), linked from
`guide/index.md#deploying`.

Companions in the same lane:

1. **`snapback hosted` is undocumented in the guide** — the disabled gate is
   discoverable only via `--help`; the sole guide mention is one line in
   `guide/getting-started/the-authoring-loop.md:200`. Add a short
   `guide/deploying/hosted-control.md` (maturity: partial) enumerating the
   closed verb registry, the blocker code, and the ticket.
2. **The hosted-lifecycle refusal has no next move** — code + message only
   (`hosted-control.mjs:653-667`). Add `recommendedNext` naming the ticket,
   matching the catalog's `unavailableReason` shape.
3. **`cloudflare/deploy.sh` emits no receipt and no codes** — all failures
   are prose with exit 1/2 (`deploy.sh:35-568`, eleven sites). Emit one
   `snapback.cloudflare-deploy-receipt.v1` JSON line (worker names,
   activated versions, probe URL, health code, actions taken) plus stable
   `SNAPBACK_CF_DEPLOY_*` codes; commit the schema.
4. **The script prints a placeholder it already resolved** — final
   instructions hardcode `<subdomain>` (`deploy.sh:578,582`) although
   `probe_url` holds the real origin (`:365-367`); following them verbatim
   hits DNS failure. Interpolate `$probe_url`.
5. **Publishing refusals are uncoded** — `scripts/snapback-publish.mjs`
   `fail()` prints prose with no code (`:71-74`) despite the
   `/^SNAPBACK_[A-Z0-9_]+$/` convention enforced in the same subsystem
   (`snapback-publish-core.mjs:1504`). Route through a coded envelope.

## Resolution (2026-08-08)

Resolved the posture statement and all five companions:

- `guide/deploying/index.md` now states the exact local, Fly, Cloudflare, and
  hosted-lifecycle stopping points with their open tracking tickets, and the
  Deploying section of `guide/index.md` routes agents to it.
- `guide/deploying/hosted-control.md` documents the three closed read commands,
  the separate operator transport, all 17 lifecycle verbs, the disabled
  availability contract, `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`, and
  the carrier/custody ticket.
- `packages/snapback-cli/hosted-control.mjs` now includes a catalog-shaped
  `recommendedNext` (`owner`, `ticketOrDesignPointer`, `note`) on the lifecycle
  refusal, with package-level coverage.
- `cloudflare/deploy.sh` now gives all eleven explicit refusal sites stable
  `SNAPBACK_CF_DEPLOY_*` codes, attests final active Worker versions, and emits
  one `snapback.cloudflare-deploy-receipt.v1` JSON line containing Worker
  names/versions, probe URL, health code, and actions taken. The closed schema
  is `schemas/cloudflare.deploy-receipt-v1.schema.json`, the deploy harness
  covers both proof profiles and the receipt, and final instructions use the
  resolved probe URL.
- `scripts/snapback-publish.mjs` now emits the standard `{ok:false,
  diagnostics:[...]}` JSON envelope with `SNAPBACK_PUBLISH_ARGUMENT_INVALID`
  or `SNAPBACK_PUBLISH_REFUSED` while preserving its exit-status distinction.

The Guide manifest and flat projection were regenerated, and the affected
Guide, inventory, deployment, hosted-control, publication, schema, shell,
JavaScript, and LLP-reference checks pass.
