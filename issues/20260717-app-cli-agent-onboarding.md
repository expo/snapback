# Agent onboarding: credential profile, pair, fence bootstrap, token lifecycle

**Status:** Open
**Severity:** P2
**Systems:** Auth, Tooling
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §4 (Review revision `14f54843…`), LLP 0055 (pairing, mint, rotation; dated-amendment vehicle), demos/_kit/agent-authority*.mjs
**Marker:** app-cli, sub-stage-b, auth

Registration is not the CLI's job; phase 1 assumes a registered,
credentialed agent. Per the final LLP 0062 §4: the **agent lane is
loopback-only** (literal `127.0.0.1`/`[::1]`, direct transport, proxy
env ignored, connected-peer judged; the accepted author decision —
v1 trusts any loopback listener, residual named). **`pair`** carries
both wire halves the implemented `AgentPairRequest` requires: a
non-secret `--request <id>` flag plus the secret code via hidden
prompt/stdin/secure file (never argv); it polls, persists the grant
id, immediately releases the pairing-returned first token, and prints
the exact next command. The **credential profile** is reference-only
(never secret-bearing): profile version, normalized target origin,
app id, grant id, server-derived durable actor/authority tuple, and
the credential by file-path reference or env — with
invalid-never-fallback. **Token lifecycle:** mint per invocation,
short-TTL; exact-token release at invocation end (0055 amendment
primitive); cross-process admission keyed (target, app, grant) with
capacity from the advertised capability fact, crash-safe by lease
expiry, watch/renewal headroom reserved; single-host scope named as
residual. `sbac_` is presented only to the closed non-redirecting
lifecycle routes. The dated LLP 0055 amendment carries: the release
primitive, the throttle floor with its abuse-safety rationale (or
the token broker pulled forward), the server-relative TTL field,
the pairing-prose reconciliation, and pairing-token-id format
compatibility.

**Done when:**

- `pair` end-to-end from a provisioned credential works, including
  restart-from-profile re-attestation, forged actor/effective-user
  substitution refused, and the pairing token's immediate release.
- A public reverse proxy fronting an otherwise-identical local
  sessions server never receives agent credentials; redirect and
  DNS/proxy negative tests pass; `sbac_` appears only in lifecycle
  bodies (planted-secret suite).
- Above-cap concurrent query/mutation/action/watch invocations admit
  in bounded order or refuse typed; kill-after-mint lease expiry,
  failed-release retry-then-TTL, and a hundreds-long sequential
  burst all pass.
- The dated LLP 0055 amendment lands with all five named items.
