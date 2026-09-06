# Snapback 2: nested named-shape collections refuse with generated alias names

**Status:** Open
**Date:** 2026-09-06
**Systems:** Snapback 2 Quarry shapes, collection lowering, diagnostics
**Source:** Astra-medium full Clique M3 on npm `snapback2@0.0.6`

A reusable message shape containing a nested, shaped receipt-target collection
fails with `E_OPAQUE`. The diagnostic refers to the compiler-generated name
`__q_rows_3_178_s41` and says it is aliased under another binding. Its `rewrite`
contains the entire original Quarry module rather than an actionable repair.

The published-only source and complete refusal are retained on the office M1
in `/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/`, especially
`evidence/m3-check.log`, `snapback/chats.q`, and `diaries/run.md`. The log keeps
the original module even though the app subsequently uses separate per-message
live queries for receipt targets.

The relevant authored shape is:

```text
shape target = { recipient, state, active: exists members[.membership] }
shape messageCard = { *, author: profiles[.sender] person,
  quoted: messages[.quote] { id, body, sender },
  targets: targets[.conversation, .id] first 50 by byConversationMessage target }
```

It is used by a 20-message history page and by a nested recent-message shape
in the inbox. The same run separately hit legitimate inbox resource bounds
and reduced that page; do not confuse those explicit bound refusals with this
generated-binding refusal.

## Resolution

Reduce the alias failure and make bounded nested collections in reusable
named shapes compile with correct isolation between expansions/iterations.
Test the same shape used in both a direct page and a nested collection, with
different receipt targets per message. Preserve real collection alias safety;
do not broadly exempt arbitrary generated-looking names. If any authored form
must be refused, report the authored site and a useful local repair without
dumping the entire module. Separate per-message subscriptions are the timed
app's workaround, not the desired product resolution.
