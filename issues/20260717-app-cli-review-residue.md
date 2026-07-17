# Fold the LLP 0062 super-refine residue into the amendments and deliverables

**Status:** Open
**Severity:** P2
**Systems:** Docs, Contracts, Auth, API
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 (Status: Review), llp/reviews/0062-generated-app-cli-and-code-mode.{fable,codex}.md (rounds 1–10), LLP 0043 (mutation acknowledgement)
**Marker:** app-cli, docs, review-residue

The /llp-super-refine loop ran ten rounds (2026-07-17): the
Claude-family reviewer was READY for six consecutive revisions; the
GPT/Codex-family reviewer remained NOT READY each round. Per the
author's recorded exit decision, LLP 0062 moved Draft → Review with
the final residue carried here as amendment-phase work — inputs to
the dated amendments and frozen deliverables the RFC already names,
not silently dropped.

**Codex round-10 majors (the substantive residue and owners):**

1. **Mutation settlement acknowledgement (the big one):** adopt
   LLP 0043's protocol — add 0043 to the RFC's Related; define the
   durable client state machine (pending → settlement-received →
   durably consumed → acknowledgement-pending → acknowledged/removed),
   the exact durable-consumption/publication boundary, fsync and ACK ordering
   vs. retention caps (`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`),
   never acknowledging unknown outcomes, and the terminal outcome for
   removed/renamed-function settlements (non-executing lookup vs.
   permanently unknown with a pinned exit/outcome). Home:
   `app-cli-mutation-settlement`, the LLP 0012 amendment, and the
   per-kind mapping deliverable; its document half precedes stage (a).
2. **Stage-(a) capability bootstrap:** stage (a) predates
   `app-cli.target` — pin how the capability-absent pre-flag behaves
   against a descriptor-less dev server. Current §6 chooses the exact
   credential-free dev carve-out; the LLP 0058 amendment must still pin
   descriptor field name/version/closed values/absent behavior before
   credentialed lanes ship. Home: `app-cli-principal-selection`,
   `app-cli-engine-dev-subcommands`, LLP 0058 amendment + §6.
3. **Declaration integrity mechanics:** distinguish the app-only
   envelope bindings from the merged local output; partition
   schema/app-global leaves from function-owned operation-schema and
   callable-binding leaves; pin exact segmentation/hashed bytes and the
   versioned admission/engine grammar. Cover zero-function,
   schema-only, function-only, and forged shared declarations after all
   envelope-local hashes are recomputed. Home:
   `app-cli-envelope-codegen`, `app-cli-envelope-serving-ingestion`,
   LLP 0012 amendment + envelope DTO deliverable.
4. **Session-refresh concurrency vs. coordinator reuse:** the existing
   coordinator releases custody ownership before network refresh, so an
   advisory-lock-spans-refresh claim is false. Choose either existing
   concurrent refresh + CAS/successor observation or a separate bounded
   crash-safe refresh lease; preserve LLP 0059's no-network-under-lock
   rule unless explicitly amended. Home: `app-cli-session-custody-store`.
5. **HEAD/`Content-Digest` mechanics:** pin GET 200 / HEAD 200 / 304 /
   OPTIONS / error headers, never retain a GET-body digest on a
   bodyless response, add `no-transform`, and require identity encoding
   end to end. Home: `app-cli-envelope-serving-ingestion` and the LLP
   0031 route-registration deliverable.

**Codex round-10 minors:**

6. Alias-only fallback applies only to syntactically valid exports that
   are hazardous as object/thenable properties; invalid or reserved
   authoring names remain rejected. Home: `app-cli-envelope-codegen` +
   `app-cli-code-mode-host`.
7. Session challenge codes receive the same hidden-prompt/stdin/secure-
   file, no-argv/no-env, redirect-terminal, and redaction contract as
   pairing codes. Home: `app-cli-session-custody-store`.
8. Unknown diagnostic codes need a stable fallback exit based on wire
   locus/result kind, not only preservation and “not exit 8.” Cover
   non-2xx, action/function `ok:false`, live terminal, and broker paths.
   Home: `app-cli-shared-result-core`.

**Fable round-10 minors:**

9. Give the envelope's app-only bindings and the merged `types` output
   distinct names/DTO roles. Home: `app-cli-envelope-codegen`.
10. Assign the envelope-less sessions redeploy-required refusal a
    frozen exit class/sub-cause (explicitly not exit 8). Home:
    `app-cli-engine-dev-subcommands` + the per-kind mapping.
11. The engine validates served declaration text against the same
    versioned grammar before `types` materializes it; honest server
    admission alone is not a hostile-target parser. Home:
    `app-cli-engine-dev-subcommands`.

**Fable nits that touch frozen behavior:** exit 9 explicitly includes a
per-call broker timeout; the 0060/0058 capability-ownership gloss is
corrected in the amendment; the 500-row acceptance fixture does not
`console.log` its intermediate rows; and the remote-service matrix says
whether descriptor/envelope advertisement is phase 1 or deferred. Homes:
`app-cli-code-mode-host`, the LLP 0058 amendment,
`app-cli-acceptance-fixture`, and `app-cli-principal-selection`.

**Standing earlier residue** (rounds 5–9, already dispositioned in
the RFC but owed follow-through in the amendments): the 0055
amendment's throttle-floor abuse-safety rationale, server-relative
TTL field, exact-token release primitive, pairing-prose
reconciliation, and pairing-token-id format; the 0058 eligibility
descriptor schema; the 0024 shared-core wrapper-to-core mapping and
0037 ownership registration; the 0031 route-class registration; the
ibex 0028+0029 correcting amendments (filing owned by
`app-cli-ibex-contract-corrections`, landing deliberately deferred).

**Done when:**

- Each numbered item (majors and minors) is either applied to LLP 0062
  (with `Revised:` updated) or carried into the named
  amendment/deliverable that owns it, with a disposition note and
  executable acceptance evidence here.
- LLP 0043 appears in LLP 0062's Related with the adopted protocol
  named.
- The five dated Snapback amendments are first-class tracked work and
  the two ibex correction filings have recorded Linear identifiers;
  nothing is considered “filed” solely because a review mentioned it.
- `./ref-check --verbose` passes after each doc change.
