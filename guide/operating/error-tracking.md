---
title: Backend error tracking
id: operating.error-tracking
order: 6
audience: agent-first
capabilities: [backend.error-tracking-v1]
authorities: [llp/0156-minimal-error-tracking.rfc.md, llp/0154-minimal-observability.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, crates/snapback-services/src/error_tracking.rs, crates/snapback-services/src/errors_query.rs, crates/snapback-services/src/telemetry.rs, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/host_ops.rs, packages/snapback-cli/mcp-control.mjs, admin-ui/app.contract, admin-ui/admin-boundary.mjs]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:2945c7d8f80d8a41b366ede5aee474f6f9b9e7105918f818896d99a704405709
---

# Backend error tracking

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback groups eligible backend failures into durable-within-retention
issues, keeps occurrence and suppression counts, and remembers whether each
issue is open, resolved, ignored, or regressed. Start with the fixed Errors
console page for triage. Use the typed operations when an agent needs exact
filters, raw exemplars, or compare-and-swap state transitions.

This is LLP 0156's local Phase E0/E1 capability, built on the
[observability substrate](./observability.md). It is partial rather than a
general crash service: grouped state does not ship on the Cloudflare target;
E2 alert delivery is unbuilt; and E3 client crash ingest is unbuilt.
Server-side stacks are raw rather than symbolicated.

When one handler terminal contains multiple ordered unhandled rejections, it
remains one observation. The first ordered rejection supplies the exception
class and normalized message template for one fingerprint and one exemplar;
the terminal increments that group's occurrence count once. The complete
ordered carrier vector remains in the raw telemetry event's
`details.rejectionCarriers` facts, within the ordinary bounded-details and
truncation rules. Snapback neither creates one group per rejection nor invents
an aggregate fingerprint.

## Triage open and regressed issues in the console

Open the admin console and select **Errors**. The list combines open and
regressed issues in last-seen order, with occurrence, release, and suppression
counts. Resolve or ignore an issue from its row. Each action sends the row's
current `stateSeq`, so another actor's intervening transition produces a
visible conflict instead of overwriting it.

Raw templates and stack heads are absent from list rows. Select the explicit
detail action to acquire the scoped raw-read lease and load one issue's
retained exemplars. Normal console bootstrap and Health polling never load raw
detail. Health's Errors tile is only a link-out count derived from the same
structural issue reads; it is not a second query path.

## Ask the release-first questions from the CLI

Address the server by its readiness descriptor so the CLI can resolve the
server, admin credential, and—only for raw issue detail—the short-lived scoped
lease:

```sh
snapback errors issues --ready-file .snapback/server-ready.json
snapback errors issues --ready-file .snapback/server-ready.json --since release-a --state regressed
snapback errors issue iss_00000000000000000000000000 --ready-file .snapback/server-ready.json
```

`errors issues` defaults `since` to the newest retained release. Supply
`--state`, `--kind`, `--name`, `--subsystem`, `--failure-disposition`,
`--release`, `--since`, `--from-ms`, `--to-ms`, `--order last-seen|count`,
`--cursor`, or `--limit` to narrow the structural list. An unknown release, or
one older than the visible activation floor, fails closed and reports the
known retained releases.

`errors issue <iss_…>` returns one structural issue plus retained template and
stack-head exemplars, bounded transition history, and a ready-to-run
`telemetry.events` correlation query per exemplar. With `--url` instead of a
readiness file, provide both the admin token and a separately minted
`--secret-read-lease` (minted with `snapback secret-read-mint --errors-issue`
— see [host operations — "Mint a scoped secret-read
lease"](./host-ops.md#mint-a-scoped-secret-read-lease)); an admin token alone
cannot read raw detail.

## Transition state without losing a concurrent update

Read the issue's current `stateSeq`, then supply it as the CAS expectation:

```sh
snapback errors transition iss_00000000000000000000000000 \
  --ready-file .snapback/server-ready.json --to resolved --expect-seq 3
```

The authored targets are `open`, `resolved`, and `ignored`; `regressed` is a
flusher-authored state when a new eligible occurrence is accepted after the
resolve barrier. A stale `expectSeq` returns a conflict with no transition.
Transition history is bounded, so use the group row's current state and
`stateSeq` as authority and read the reported history floor before treating
the visible history as complete.

For a deploy hook, resolve all open or regressed issues last seen before one
retained release activation:

```sh
snapback errors resolve --ready-file .snapback/server-ready.json --open-before release-a
```

The selector and transitions execute in one telemetry-store transaction. The
response reports an applied, skipped, missing, or conflict outcome per issue;
the command does not pretend every selected row was transitionable.

## Use the same operations from an agent tool

The control MCP projects the Rust-owned contract without another issue model:

- `snapback_errors_issues` projects `errors.issues`, the structural list;
- `snapback_errors_issue` projects `errors.issue` and automatically mints the
  bounded `errors-issue` secret-read lease; and
- `snapback_errors_transition` projects either the single CAS form or the
  atomic `openBefore` bulk-resolve form.

List and detail operations report the observability variance envelope plus
error-group facts. Check `groupHorizonStartMs` before assuming an old resolved
issue would still be remembered; `transitionHistoryFloorSeq` and
`transitionHistoryTruncated` before treating history as complete;
`exemplarStale` and exemplar drop counters before assuming raw detail never
existed; and `overflowFoldCount` before treating the visible groups as every
eligible fingerprint. Suppression counts record rollout/cooldown decisions;
they do not imply an alert was delivered, because E2 delivery is not built.

## Understand what survives and what does not

Issue groups, transitions, activations, and raw exemplars live in the same
generation-bound telemetry sibling database. The classification group can
outlive its raw exemplar, but deleting the telemetry file, rotating the app
generation, reaching the group horizon, or setting `maxDays: 0` removes it
from the visible issue surface. This is triage state, not an audit ledger.

Declared application refusals are issue-eligible only when the function
explicitly lists the admitted code in `trackedRefusals`. The private opt-in is
validated as a subset of `refusals` and is never added to public function
introspection. Ordinary caller errors and untracked app refusals remain out of
the issue list; tracking every failed request would erase the distinction
between actionable faults and routine domain outcomes.

## Anti-patterns

- **Do not query `error_groups` directly or build a second grouping store.**
  Use `errors.*`; grouping and raw telemetry share one flush transaction and
  one generation fence.
- **Do not put stack or template text on a structural list or webhook.** Raw
  content requires the scoped detail lease and must remain `no-store` on HTTP.
- **Do not update state without `stateSeq`.** A timestamp is informational;
  the sequence is the concurrency token.
- **Do not infer alert delivery from suppression counters.** E2's outbox,
  retries, webhook, and Sentry-formatted bridge are deferred and unbuilt.
- **Do not send browser or native crashes to the backend issue routes.** E3's
  authority, abuse limits, offline ordering, protocol, and symbolication are
  deferred to a separate RFC and are unbuilt.
