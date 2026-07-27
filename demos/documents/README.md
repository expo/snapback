# documents

`documents` is an off-main exploratory kernel for the Notion/Docs pressure
slice in LLP 0063. It tests a candidate subset of Draft LLP 0068's canonical
operation reducer without claiming that Snapback supports collaborative
documents.

Run the retained corpus:

```sh
node demos/documents/tests/acceptance/reducer.mjs
```

The current reducer covers closed operation objects, canonical JSON and
domain-separated hashes, operation-scoped atom identities, dependency
buffering, block insert/delete/move/attributes, text insert/delete, duplicate
delivery, deterministic placement-cycle breaking, and restart reconstruction.

[`pressure-profile.v1.json`](./pressure-profile.v1.json) is the fail-closed
ledger. Marks, editor behavior, durable admission and settlement, offline
custody, authorization, history/comments, presence, compaction, large-document
windowing, resource budgets, and every required cross-platform tuple remain
red. LLP 0068 itself remains Draft; this code is evidence for reviewing its
reducer choices, not a substitute for independent review and ratification.
