# Snapback4: typed record-list operation arguments

Status: Open
Date: 2026-10-26
Source: Wave30 lane004R; DX14 item11.

Quarry operation arguments currently use the scalar wire model and bounded
scalar/media lists. A parameter such as `items: [{name: text <=80}] <=12`
requires new record argument types through the core IR, decoder, native path,
binder and TypeScript emitter; it is not a parser-only spelling change.

DX14 now refuses the record parameter at its source with an explicit bounded
parallel-list alternative and a length guard. That removes syntax guessing but
does not implement record-list arguments. Existing child tables remain the
stored-record form. Follow up with a scoped design/implementation for record
argument values and an actual004R multi-room atomic-input replay; preserve one
transaction and per-element validation. No new format/capability is claimed by
DX14's compiler refusal.

Related: LLP 3000.037.000 §6; `WORKSTREAM-REPORT.md` in the DX14 worktree.
