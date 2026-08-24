# First-party headless replay/seed helper (`snapback replay`)

**Status:** Open
**Opened:** 2026-08-24
**Systems:** CLI, Client integration, Offline sync, Benchmarks, Testing
**Related:** LLP 0043, LLP 0201, LLP 0306 (chip-away E36, idea 3),
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`,
`guide/testing/large-fixtures.md`

## Problem

There is no supported way to drive a large volume of mutations at a Snapback
app from a headless process. Every benchmark lane and every load/fixture
consumer reinvents the same adapter, and reinvents the same bugs:

- `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` at 1,024 retained results on
  one-shot sequential replay (0.1.24 hit it near 8k actions, the 0.1.25 pair
  at 8,873) until the lane discovers `clientMutationId: null` /
  acknowledge-or-drop custody;
- `SNAPBACK_AUTH_STALE_RESULT` from binding transport `clientMutationId` to
  session vs fixture identity;
- `SNAPBACK_OUTBOX_NOT_WRITER` until multi-persona `clientStoreId` +
  `rqsStore: null` is discovered;
- the auth-client protocol header `x-snapback-auth-client-protocol: 1`
  missed in hand-rolled clients;
- a growing synchronized public replica per actor when live queries are not
  suppressed (the 0.1.25 Familiar scale stop at 2,620/167,157 actions,
  ~759 MB across ~116 retained clients).

Verified on main at `9a782983d` (2026-08-24): no `replay`/`seed`/`bulk` verb
in the CLI verb table (`crates/snapback-cli/src/cli.rs`);
`@expo/snapback-acceptance` exports only the starter-acceptance surface;
`guide/testing/large-fixtures.md` explicitly instructs an app-authored
batch-ingest mutation driven by a hand-written loader script and does not
address retention custody, client disposal, live-query suppression, or keyset
paging. Explicit's scale babysitting was 11,314s of an 18,766s session in the
0.1.25 pair — the single largest cost in the run.

## Direction

Ship the adapter as a product so benchmark lanes and app authors are
customers, not inventors. Contract sketch (from LLP 0306 idea 3):

- one client or a small pool; dispose/re-auth on actor switch;
- no live queries; paged keyset reads for lookups;
- `clientMutationId: null` (or acknowledge-and-drop) transport custody while
  preserving application intent IDs, minted by default so custom callers
  cannot rediscover `SNAPBACK_AUTH_STALE_RESULT`;
- settle-before-next pacing with JSONL receipts;
- runs detached with a small watcher surface so a supervising agent does not
  babysit it in-context.

**Needs a Spec before implementation.** The open design question (LLP 0306
open question 2) is packaging: a `snapback replay` CLI verb, a published
`@expo/snapback-acceptance` helper, or both (verb wrapping helper). LLP 0043
owns replay/retention semantics; LLP 0201 is the first consumer. The Spec
should also rule whether generated headless clients mint transport identity
by default (LLP 0306 idea 13) independently of the helper.

## Acceptance

- A packed-package headless consumer replays ≥100k mutations across multiple
  personas with bounded memory, no retention-ceiling failure, and no live
  replica growth, using only documented surface.
- The 1,024 retention and `.take()` ceilings are either respected by
  construction or named pre-flight by the helper.
- The guide's large-fixtures page routes to the helper instead of an
  app-authored loader pattern for the bulk case.
- The next Clique full pin's scale segment runs through it.
