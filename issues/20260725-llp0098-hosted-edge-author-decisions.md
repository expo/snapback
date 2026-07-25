# LLP 0098 hosted-edge adapter — author decisions

**Status:** Open (awaiting author)
**Severity:** P2
**Systems:** Auth, Security, Deployment, Control plane
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0098, LLP 0060, LLP 0072, LLP 0074, LLP 0077
**Marker:** author-decision, hosted-edge, llp-0098

The adapter is built and admits on a real served origin
(`demos/competitive-checkpoint/acceptance/results/hosted-edge-admission.v0.json`).
Three questions are the author's, not the implementer's. Each records the
**conservative default already in force**, so nothing is blocked waiting on an
answer — a decision only ever relaxes or ratifies what is shipped.

## D1. Is the operator-inside-the-trust-boundary residual acceptable?

LLP 0098 §2.1 authenticates the control plane to the deployment with an Ed25519
key whose private half never enters the machine. That stops drift, staleness,
rollback, and foreign snapshots — the realistic failure modes. It does **not**
stop an operator who deliberately signs false facts: in a single-tenant profile
the operator owns the deployment, and a fully malicious operator can substitute
both the verification key and a self-signed envelope (the key is inside its own
`configurationSha256`, so substituting only one fails).

**Conservative default in force:** the residual is stated plainly in LLP 0098 §7
and the Summary, and no marketing-grade word is attached to it. `hostedAuthCapable`
is not claimed.

**The decision:** whether "attestation" is an acceptable public word for a fact
that binds an assertion to an identity without making the asserter honest, or
whether Snapback should use narrower language externally. This is an LLP 0074
no-overclaim judgement.

## D2. Which renewal mechanism does a production profile use?

An admission lives at most five minutes (LLP 0060 D5), so serving needs a stream
of snapshots. LLP 0098 §2.4 admits two modes with materially different
withdrawal properties:

- `online` — the control plane delivers each successor; withdrawal latency is
  bounded by the remaining lifetime (≤5 min).
- `presignedWindow` — a bounded chain is signed once; **the control plane cannot
  withdraw inside the window.**

**Conservative default in force:** the drill runs `presignedWindow` over a
four-hour chain, the mode is recorded in the receipt, and the deployment is
never described as having control-plane withdrawal. There is no hot-swap
renewal loop, so serving withdraws when the window ends.

**Correction (observed in production 2026-07-25T15:25Z):** the chain supplies
only the snapshot covering the *boot* instant — the origin installs one
authority at startup and never advances through the chain. The real serving
window is **one snapshot lifetime (5 minutes) from boot**, not the chain span.
The deployment duly withdrew with `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`.

That promotes this from a preference to a **blocking implementation item**: a
hot-swap renewal loop is required before the LLP 0077 matrix can run against the
served origin at all, unless the whole matrix completes inside five minutes.

**The decision:** whether production requires `online` (which forces the
deployment to make outbound control-plane connections, or the control plane to
reach a loopback admission socket), and what the maximum acceptable
`presignedWindow` is for non-production. LLP 0098 open question 1.

## D3. Does `globallyFenced` on a single instance need a stronger guard?

`sessionInvalidation = globallyFenced` is true for this profile only while
exactly one process serves. The invariant rests on the platform running one
instance, the database instance lock refusing a second opener, and the
`deploymentId` binding. **A platform that silently starts a second instance
during a deploy breaks the guarantee without breaking any check in §3.1** — the
lock would refuse the second opener, but that is a crash, not a fenced handoff.

**Conservative default in force:** LLP 0098 §7 records the invariant as
load-bearing and states that an operator MUST NOT configure rolling deploys for
this profile. The drill accepts bounded downtime on every deploy.

**The decision:** whether the profile should *enforce* single-instance rather
than document it (e.g. refuse to install an admission when the platform reports
more than one running instance), or whether a documented handoff with bounded
downtime is sufficient. LLP 0098 open question 3.

## D4. A persistent volume for certificate storage (new Fly resource)

The hosted-edge machine has no volume, so every redeploy wipes Caddy's
certificate storage and forces a fresh Let's Encrypt issuance. That limit has
now been hit: the public TLS leg is down until the duplicate-certificate window
clears, which blocks served-origin reruns (LLP 0098 §8.3).

**Conservative default in force:** no new Fly resource was created. The drill
runs `auto_stop_machines = "off"` with one always-on machine, which avoids
stop/start cert loss but not redeploy cert loss.

**The decision:** whether to create a small persistent Fly volume for
`/data/caddy` (the durable fix). It is a **new Fly resource**, which this lane
was scoped not to create, so it is Charlie's call. The alternative — keeping
cert material in a Fly secret — trades the rate limit for holding a private key
in platform secret storage, which is a custody change and should not be adopted
silently.

## Not an author decision — tracked as work

- Plaintext credential-bearing paths currently 308-redirect rather than refuse
  (LLP 0060 D2). This is a defect with a known fix, not a judgement call. It is
  **not** the same seam as D-1: the redirect is issued by the Caddy terminator
  before the origin sees the request, so it is a terminator-configuration fix,
  not a request-ordering one. It gets its own change.
- D-1 (unauthenticated caller reaches the JSON parser) needs the function-level
  authentication requirement hoisted into route policy — a codegen/route-policy
  design change, not the reorder it first looked like. See the 0077 index.
- The LLP 0077 matrix has not run on the served origin because the deployment's
  active auth mode is `dev`; staging a sessions carrier is implementation work.
- A method-mismatched probe of a disabled operator route returns 405 before the
  disablement gate runs.
