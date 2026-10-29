# Fresh check rejects a singleton enum-value alias

Status: Open
Date: 2026-10-29
Area: Snapback 4 language / release alias lowering (REL4 follow-up)
Found by: DX17 guide consolidation, outside DX17 implementation ownership

On 0.4.48 native, a fresh schema check rejects this alias:

```quarry
table records:
  status: enum('ready') default 'ready'
  public 'records'
  online only
alias records.status 'paused' = 'ready'
```

Observed:

```text
schema.q:5:1 — E_QUARRY_TYPE: backfill records.status returns enum('ready', 'paused'), expected enum('ready')
```

The three-state form `enum('open', 'ready', 'closed') default 'open'` with
that alias compiles. A fresh temporary project reproduced both outcomes using
the same optimized static 0.4.48 binary. This looks like narrowing of the
generated enum-alias backfill, not a need to fabricate extra application states.
DX17's compiling guide example uses a real three-state domain; no language,
release or refusal semantics were changed to work around this issue.
