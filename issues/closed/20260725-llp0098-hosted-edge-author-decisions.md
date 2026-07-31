# LLP 0098 hosted-edge adapter — author decisions

**Status:** Resolved 2026-07-30 — all three decisions made by Charlie
Cheever (in-session, this date) and recorded as dated amendments in
LLP 0098: **D1** — ratify the narrow external language
("control-plane-signed admission"); "attestation" carries no marketing
weight and `hostedAuthCapable` stays unclaimed (§7). **D2** — production
requires `renewal: "online"`; `presignedWindow` is non-production-only,
cap tightened 24h → 4h (§2.4); the poll-vs-push delivery mechanism stays
open question 1's remaining half. **D3** — documented handoff stays
sufficient for the drill; a production `globallyFenced` claim requires
enforced single-instance, commissioned as
`issues/20260730-0098-single-instance-enforcement.md`. D4 was already
resolved 2026-07-25.
**Impact:** 4
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “LLP 0098 hosted-edge adapter — author decisions” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the ticket identifies a narrow, verified change or decision, with a direct reproduction or current implementation proof.
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

**Blocking item closed 2026-07-25 (LLP 0098 §8.3):** the origin now holds a
hot-swappable authority slot (`HostedServingHandle`), re-reads the delivered
admission document every 30 seconds, and swaps in the snapshot covering the
clock only after the identical §3.1 conjunction. What remains here is only the
decision proper below.

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

**RESOLVED 2026-07-25 (Charlie Cheever): create the volume.** Exact scope
authorized and executed the same day: ONE small persistent Fly volume on the
EXISTING machine, mounted at `/data/caddy` for Caddy's certificate storage
only — no other new resource. Identity, pinned here and in the teardown
inventory (`demos/competitive-checkpoint/acceptance/drill/README.md`) and
protocol amendment v0.8 (LLP 0075):

- volume `vol_r6815pkd59o1x614`, name `caddy_storage`, app `snapback-drill`,
  region sjc, 1 GB, encrypted, scheduled snapshots. Attaching it replaced the
  Fly machine (platform behavior, not an extra resource): `819701c927ee68`
  was retired and the app's single machine is now `849764f2e7dd58`.

The Fly-secret alternative was **rejected**: keeping certificate private-key
material in platform secret storage is a key-custody change and must not be
adopted silently. The database and the delivered admission chain deliberately
stay on the rootfs — a redeploy still gets a fresh database (single-boot
sessions staging) and a chain is re-minted per deploy window. Note the volume
does not bypass an already-consumed Let's Encrypt duplicate-certificate
window; it prevents future issuance burn by surviving redeploys.

Original decision record, for context:

The hosted-edge machine had no volume, so every redeploy wiped Caddy's
certificate storage and forced a fresh Let's Encrypt issuance. That limit was
hit: the public TLS leg was down until the duplicate-certificate window
cleared, which blocked served-origin reruns (LLP 0098 §8.3). The conservative
default in force was no new Fly resource, `auto_stop_machines = "off"`, one
always-on machine — which avoids stop/start cert loss but not redeploy cert
loss.

## Not an author decision — tracked as work

- ~~Plaintext credential-bearing paths currently 308-redirect rather than
  refuse (LLP 0060 D2).~~ **Fixed 2026-07-25** with the D4 redeploy: the
  terminator's explicit `http://` site answers a fixed body-free 403 (no
  redirect), witnessed from the public internet; ACME HTTP-01 interception
  proven intact via a successful staging-CA order under the new config
  (LLP 0098 §8.4).
- ~~D-1 (unauthenticated caller reaches the JSON parser).~~ **Fixed
  2026-07-25** — the function-level `authRequirement` route-policy hoist; see
  the 0077 index (matrix 42/42 against the local hosted origin).
- ~~The LLP 0077 matrix has not run on the served origin.~~ **Done
  2026-07-27** — the TLS window cleared, the D4 volume retained the
  certificate, and the served-origin matrix ran for the first time (LLP 0098
  §8.3/§8.5), surfacing and fixing D-2 (bound-key re-exchange 500,
  `2e8815ec`); 43/43 against both the served and local hosted origins.
- A method-mismatched probe of a disabled operator route returns 405 before the
  disablement gate runs.

## Status note (2026-07-30 triage)

All "tracked as work" items are executed (D4 volume, §8.3 hot-swap renewal
loop, plaintext-403 fix, D-1 authRequirement hoist, served-origin LLP 0077
matrix 43/43 with D-2 fixed). Remaining are exactly the three author
decisions D1–D3, plus one minor unexecuted sweep item: a method-mismatched
probe of a disabled operator route returns 405 before the disablement gate
runs — worth folding into whichever change lands D3.
