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

## Not an author decision — tracked as work

- Plaintext credential-bearing paths currently 308-redirect rather than refuse
  (LLP 0060 D2). This is a defect with a known fix, not a judgement call.
- The LLP 0077 matrix has not run on the served origin because the deployment's
  active auth mode is `dev`; staging a sessions carrier is implementation work.
- A method-mismatched probe of a disabled operator route returns 405 before the
  disablement gate runs.
