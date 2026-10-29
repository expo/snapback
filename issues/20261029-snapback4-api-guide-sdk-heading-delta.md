# App guide deltas can repeat a changed SDK signature after an operation change

Status: Open
Date: 2026-10-29
Scope: Snapback 4 guide API reading history, LLP 3000.037.000 §18.

Fresh Codex review of eafcd61d87 identified a nonblocking emit-context mismatch:
after an initial app-bound api client read, change an operation fact and a
complementary SDK declaration. The operation delta carries its heading; the
previously seen Additional client signatures heading is omitted. The new SDK
fence can inherit the operation context when hashing visible blocks, so it is
printed again on a subsequent lookup. Content is never hidden and --repeat
restores the complete selection.

Carry the applicable non-operation heading when emitting a new SDK block and
add a source-level delta regression. This is a later SDK-upgrade case, outside
the frozen same-SDK day-one dollar comparison. Generic/non-app guide history's
inherited outer-budget behavior is separate and is not changed by TOK6.
