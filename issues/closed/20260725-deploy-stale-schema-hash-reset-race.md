# deploy.sh: stale-schema-hash refusal is only escapable by racing the rollback

**Opened:** 2026-07-25
**Systems:** Cloudflare arm, deploy.sh, coordinator deployment identity

When a deploy changes the schema hash over non-empty persisted state, the
new version's `/health` refuses with `SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH`
and `deploy.sh` rolls back, pointing at "the documented migration/reset
path". But that path is a chicken-and-egg on the hosted proofs:

- `/reset` on the **old** live version rebuilds and stamps the **old**
  hashes (`writeDeploymentMetadata()` uses the running code's expected
  metadata), so pre-resetting does not help — observed live 2026-07-25:
  reset returned `{"reset":true,"seeded":true}` and the next deploy still
  refused.
- `/reset` on the **new** version stamps the new hashes (exactly what
  `coordinator.js` `initializeSchema()`'s two-phase startup exists to
  allow), but the new version is only live during `deploy.sh`'s brief
  probe window before the automatic rollback.

The working procedure for the 2026-07-25 redeploy was to arm a 1s-interval
background loop POSTing `/_snapback/api/app/reset` (admin-gated) and run
`deploy.sh` so the reset lands inside the probe window — on all-aboard the
reset landed *after* the probe's verdict (needing one more deploy run); on
notes it landed *inside* the window and the same run went healthy. That is
a race, not a procedure.

## Proposed fix

An explicit opt-in knob, e.g. `SNAPBACK_DEPLOY_RESET_ON_STALE=1`: when the
health probe answers a `SNAPBACK_STALE_CLOUDFLARE_*` refusal and an admin
token is configured, `deploy.sh` invokes the authenticated
`/_snapback/api/app/reset` against the just-activated version and re-probes
before deciding failure/rollback. Without the knob, current fail-closed
behavior is unchanged (a stale refusal on a production-like target should
stay a stop). Document the knob next to the existing
"migration/reset path" message so the operator learns the escape hatch at
the moment they need it.

## Resolution (2026-07-25)

Implemented as proposed in `cloudflare/deploy.sh`, hooked into the first
health verdict (after `probe_gateway_bindings` succeeds but the probed body
answers `ok !== true`, before the failure/rollback `exit 1`):

- `SNAPBACK_DEPLOY_RESET_ON_STALE=1` + a `SNAPBACK_STALE_CLOUDFLARE_*`
  refusal code + `SNAPBACK_ADMIN_TOKEN` in the environment → deploy.sh POSTs
  `/_snapback/api/app/reset` with `x-snapback-admin-token` against the same
  base URL the health probe used (the just-activated version), bounded to
  `SNAPBACK_DEPLOY_RESET_ATTEMPTS` (default 6) tries at
  `SNAPBACK_DEPLOY_RESET_DELAY_SECONDS` (default 5s) apart — ~30s max.
- A response containing `"reset":true` triggers a full bindings + health
  re-probe; if it now passes, the deploy continues down the normal healthy
  path (admin-secret handling, post-secret deploy, final verification).
- Any other outcome — knob unset, non-stale code, missing token, reset never
  confirming, or health still refusing after reset — falls through to the
  unchanged fail-closed failure/rollback path. The refusal message now names
  `SNAPBACK_DEPLOY_RESET_ON_STALE=1` as the sanctioned escape hatch for
  proof/demo targets whose persisted state is disposable.

The reset authenticates against the admin secret a previous deploy already
configured on the Worker (this run's secret handling comes later), which is
exactly what the 2026-07-25 manual race proved works. Covered by new
`stale-health-reset-knob*` cases in `cloudflare/test/deploy-script.mjs`
(curl fake models the admin-gated reset endpoint); documented in
`cloudflare/README.md`.
