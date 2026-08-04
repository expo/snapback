# Admin console: one-time operator claim links (`snapback admin link`)

**Date:** 2026-08-03
**Status:** Open
**Area:** Admin console / operator auth (LLP 0017)

## Problem

`snapback admin` and the device-approval flow (landed via
`issues/closed/20260803-admin-console-access-convenience.md`) both assume the
human can either share the terminal's filesystem or run a command in a
token-holding terminal. In remote development — the master-holding terminal is
a cloud box, frequently driven by an agent session — neither is convenient.
The agent has the ready file; the human just wants a link.

## Design (authoritative)

LLP 0017 §Security Defaults, paragraph "The reverse handoff — terminal to
browser — is the **one-time operator claim link**", plus the new design
principle "Only ephemeral authority transits the human." The design was
amendment-delta-reviewed by two model families before this ticket was filed;
review artifacts under `llp/reviews/0017-*`. Summary:

- `snapback admin link --ready-file P` proves master access exactly like
  `snapback admin`, then mints a **claim code**: single-use, unguessable,
  **thirty-minute TTL**, digest-only, **process-ephemeral** (restart
  invalidates unredeemed codes). Master-proven mints get their own pending budget; claim
  creation, claim-exchange attempts, and total pending claims are rate/cap
  bounded alongside the device flow's operations.
- Prints `<console>/#claim=<code>`; `--url-base` substitutes a tunnel or
  reverse-proxy origin for the bind address.
- Opening the link exchanges the claim **atomically** (exactly one winner
  under concurrent redemption) for one newly derived `sbcc_` credential via
  the ordinary credential path (`no-store`, fragment stripped before boot,
  standard client storage rules). Reuse/expiry/invalid share one refusal —
  one status, one body.
- The claim-derived credential carries distinct provenance, grants ordinary
  `AdminRead`/`AdminWrite` only (never `AdminSecretRead`, never
  impersonation), and renews via the ordinary sliding mechanism under a
  **ninety-minute absolute cap** (author ruling 2026-08-03; not the ordinary
  eight-hour cap). Active use lasts up to 90 minutes on one link; an idle or
  stolen-and-idle credential dies ten idle minutes after last use.
- Redemption is recorded atomically against the claim digest: time, direct
  transport-peer address, issued credential digest. Readable only via
  master-bearer status; the master can revoke the bound credential. By
  default the CLI stays attached and reports redemption/expiry/revocation;
  `--no-wait` prints and exits; a status query can reattach. Peer address is
  best-effort behind tunnels; forwarding headers only from explicitly
  configured trusted proxies, labeled.
- **Loopback-only**, like every other credential flow; hosted and
  non-loopback targets refuse claim mint and exchange. Remote posture =
  tunnel terminating on loopback + `--url-base`.
- Rationale to preserve in code comments: a claimed or expired link is inert,
  so it is safe for agent transcripts/scrollback/chat logs after redemption —
  unlike the master token, which never enters those channels.

## Work items

1. Server: claim registry (mint under `authorize_master`, atomic single-use
   exchange, digest storage, 30-min TTL, own mint budget + bounded exchange
   attempts), provenance-marked credential issuance whose renewal is capped
   at ninety minutes absolute, redemption record + master revocation of the
   bound credential, with stable `SNAPBACK_*` diagnostics consistent with the
   approval flow's.
2. CLI: `snapback admin link` (attached-by-default wait reporting
   redemption/expiry/revocation, `--no-wait`, a reattach/status query,
   `--url-base` with origin sanity-check).
3. Console client: handle `#claim=` on boot — disambiguate from the existing
   `sbcc_` fragment format, exchange via `POST` body, strip fragment, store
   the derived credential through the existing path; surface the shared
   refusal cleanly.
4. Docs: LLP 0017 implementation-status flip when landed; guide
   `operating/admin-console.md` section for the remote/agent handoff recipe.
5. Tests (the LLP's validation rows plus codex round's acceptance cases):
   route-policy parity for new endpoints; single-use race — two concurrent
   exchanges, exactly one wins; uniform status+body across
   invalid/expired/consumed; code only ever in a `POST` body, never URL or
   logs; constant-time digest compare; `no-store` on exchange; TTL expiry;
   restart invalidates unredeemed claims; claim-derived renewal slides but
   refuses to cross the ninety-minute absolute cap (and never inherits the
   eight-hour cap); master revocation; mint-budget isolation from unauthenticated
   device-approval floods; non-loopback and hosted refusals;
   fragment-stripping; and a planted-link end-to-end proof.

## References

- LLP 0017 §Security Defaults (claim-link paragraph) and §Design Principles
  ("Only ephemeral authority transits the human") — the governing text.
- LLP 0150 — the complementary invariant for durable agent credentials.
- `src/admin.rs` — `ConsoleApprovalRegistry` (the substrate: single-use codes,
  TTL, rate windows, pending caps, atomic consumption).
- `packages/snapback-admin-client/index.mjs`, `admin-ui/main.ts` — fragment
  handling from the `snapback admin` handoff to extend.
