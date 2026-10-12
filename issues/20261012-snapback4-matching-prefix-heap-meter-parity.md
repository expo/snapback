# Snapback 4: scoped matching reserves prefix-key heap on the server and none on a trusted device

**Opened:** 2026-10-12 (CUT's fresh gpt-6.1-sol review, finding 2)

A held-group `matching` query skips the server's `key_verdict_heap` charge on
a trusted device in `engine/read.rs::prepare_words`. This predates CUT; the
matching discovery meter already documented server/device differences in
LLP 3000.007 §20.24.1. CUT is scoped to ordinary uniform page verdicts
(§20.24.6) and keeps matching's existing charge/cut behavior.

The review (`llp/reviews/3000.007-cut-page-meter.r1.gpt.md`) independently
reproduced it with `cut/groups.q` plus `body: text <=20`, a searchable body,
member `(1, alice)`, and one item containing `coffee`:

```quarry
query search(q: text <=20, c: cursor ?):
  return items where .bucket = 1 matching q last 1 by .score after c
```

On the initial CUT snapshot (which briefly charged matching probes too),
default heap was 17,056 server versus 15,912 device; at heap ceiling 28,184
the server returned unavailable with a meter cut and the device returned the
item, complete. The initial matching probe change was removed, leaving the
historical matching meter intact; the heap difference remains a follow-up.

Decide the logical discovery allowance on both hosts, retain preauthorized
attempted-read counts (LLP 3000.007 §20.24.5), sweep its boundaries and
extend the device generator to `matching`. Do not infer matching parity
from ordinary held-group page qualification.
