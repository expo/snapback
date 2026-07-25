# `loopback-terminated-single-instance.v1` hosted-edge deployment

The first deployment that makes `--auth-deployment hosted` **admit**. Governed
by [LLP 0098](../../../../llp/0098-hosted-edge-adapter.spec.md); it owns the
LLP 0060 hosted-edge attestation facts the plaintext drill in `../drill/`
deliberately could not.

## Why the topology looks like this

The origin binds **loopback only**; Caddy terminates the public HTTPS leg
**inside the same network namespace** and reverse-proxies over loopback. Fly's
edge is configured for **raw TCP passthrough** on 443, so the TLS handshake
reaches Caddy rather than terminating at the platform edge.

That arrangement is the security contract, not a deployment preference:

- LLP 0060 D2's "every hop between the TLS-terminating edge and the origin
  process is same-host loopback" holds **literally**.
- The direct-origin bypass class is **empty**. On the plaintext drill any
  co-resident workload on the platform's private network could address the
  origin port directly and supply its own forwarding headers; here there is no
  address to connect to.
- The D1 plaintext fence is satisfied by its **ordinary loopback rule**. This
  profile passes no `--allow-insecure-dev-auth` and invents no sessions
  override. A hosted deployment is not an exemption from the fence; it is a
  deployment that never needed one.

## Runbook

`FLY_API_TOKEN` and `SNAPBACK_DRILL_ADMIN_TOKEN` come from the untracked
`.agent-local-secrets.md`. The control-plane signing seed lives there too and
**never enters the machine, a receipt, a log, or a commit**.

1. **Mint a control-plane keypair** (once). The private half stays with the
   operator; the public half is committed in `hosted-edge.json` and ships inside
   the release image.

   ```sh
   cargo run --bin snapback-hosted-admission -- keygen
   ```

2. **Pre-sign an admission chain.** A snapshot lives at most five minutes and
   the control plane cannot know when the machine boots, so a chain covers the
   declared window and the origin selects the member covering its boot instant.

   ```sh
   cargo run --bin snapback-hosted-admission -- mint \
     --seed "$HOSTED_EDGE_ADMISSION_SEED" \
     --config demos/competitive-checkpoint/acceptance/hosted-edge/hosted-edge.json \
     --admission-epoch 1 --sender-replay-epoch-floor 1 \
     --chain 48 --lifetime-ms 300000 > chain.json
   ```

3. **Deliver it and deploy.** The chain rides as a platform secret rather than
   an image layer, because the machine has no persistent volume.

   ```sh
   fly secrets set SNAPBACK_HOSTED_ADMISSION_B64="$(base64 -i chain.json | tr -d '\n')" \
     -a snapback-drill --stage
   fly deploy . \
     --config demos/competitive-checkpoint/acceptance/hosted-edge/fly.toml \
     --dockerfile demos/competitive-checkpoint/acceptance/hosted-edge/Dockerfile \
     --remote-only --ha=false --yes
   ```

4. **Verify.**

   ```sh
   curl -s https://snapback-drill.fly.dev/health
   curl -s -H "x-snapback-admin-token: $TOKEN" https://snapback-drill.fly.dev/inspect \
     | jq .capabilityManifest.hostedAuth
   ```

## Sharp edges, recorded

- **No persistent volume.** An auto-stop/start cycle wipes the rootfs, taking
  Caddy's certificate storage *and* the delivered chain with it, and forcing a
  fresh Let's Encrypt issuance against the **5-per-week duplicate limit**. Hence
  `auto_stop_machines = "off"` and `min_machines_running = 1`. A volume is the
  production answer; budget issuances while iterating.
- **Serving withdraws when the pre-signed window ends.** There is no renewal
  loop yet (LLP 0098 open question 1). Re-mint and re-deliver to extend.
- **Raw passthrough on the shared IPv4 relies on Fly's SNI-peek routing**, which
  is undocumented for self-managed TLS. The app's dedicated IPv6 routes per-IP
  and does not depend on it.

## What this deployment does NOT yet prove

`hostedAuthCapable` is **not claimed**. See
`../results/hosted-edge-admission.v0.json` and LLP 0098 §8.1:

- `/_snapback/*` answers **503, not the fixed 404** that the attested
  `operatorSurface: "disabled"` requires — an attested fact with no enforcing
  code behind it;
- plaintext **redirects (308) rather than refusing** credential-bearing paths;
  and
- the **LLP 0077 sender-auth matrix has not run** here, because the deployment's
  active auth mode is `dev` (sessions needs a `--startup-artifacts` carrier and
  a two-boot staging transition this deployment does not yet stage).
