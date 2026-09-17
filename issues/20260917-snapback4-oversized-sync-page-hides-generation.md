# Snapback 4: a sync response that cannot fit hides the generation change — and one undeliverable commit wedges a device

Status: Open
Priority: P3 (needs a single commit, or a page of re-materialized images, above 16 MiB; when it happens the device cannot recover by itself)
Date: 2026-09-17
Systems: `snapback4` `serve.rs` (`respond_with_cors`), `snapback4-core` `partition.rs` (whole-commit stream pages, current-image re-materialization), the client's catch-up loop in `packages/snapback4/src/local.ts`
Observed version: main at `ab061be93` (read from source; not executed)
Evidence status: found by the GPT-family blind review of LLP 3000.007.001, round 2 (finding 1); the two code paths below were then read and match

## Problem

`respond_with_cors` serializes a response and, if it exceeds the HTTP ceiling, **replaces the
whole body** with a fixed refusal:

```rust
let refusal = Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values").guide("reads");
serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal) }))
```

The replacement carries no `generation` and no `store_id`. The client's catch-up loop
(`local.ts`, `responsePageTooLarge`) answers by halving `pageLimit` and retrying the same
position; at `pageLimit == 1` it falls through to a refused session. A stream page
preserves whole commits, so a single commit above the ceiling cannot be split by any limit.
Generation adoption happens only after a page decodes, so a device in this state never
learns that the generation changed and that it should discard its images and snapshot
instead — which would have freed it.

Two things make the oversized page reachable without an enormous mutation: a stream page
re-materializes every `put` from the **current** row (see
`issues/20260917-snapback4-stream-page-serves-images-newer-than-its-watermark.md`), so
widening a table's rows after the fact enlarges old pages; and a derived rebuild at
activation emits one row event per rewritten target row in a single commit.

## Direction (not a design)

- The oversized-response body should carry `generation` and `store_id`, and the client
  should compare them **before** it shrinks or retries: a generation change is handled as
  one, whatever the page's size.
- Better, `/sync` should answer a generation mismatch with a small, bounded response before
  it materializes any page (the request would say which generation the device holds).
- A commit that cannot fit a response at `limit = 1` needs a defined outcome — a snapshot
  instruction — rather than a refused session.

LLP 3000.007.001 (maintained columns) lists this as a prerequisite of its first build: its
activation is a generation barrier, and generation discovery must not depend on a row page
being deliverable.
