# Maintains — E_MAINTAINED_COLUMN

The other form is `total: sum source of .amount where .selected by .parentId`.
The predicate has the aggregate grammar above. The one grouping column must
reference this parent table; optional null references contribute nothing.
The source is ordinary and cannot expire. Tables a timeline maps are
ordinary here: `likeCount` on the posts a Following timeline maps is the
Trending form beside it. Tables the timeline owns refuse E_MAINTAINED_COLUMN.
The parent may expire; the mirror
leaves expired rows and their stored values untouched. Zero-like parents are
included in its indexes, and ties can use the parent's time.
A deleted parent can be recreated with the current total. A missing field
reads as 0. E_MAINTAINED_COLUMN refuses an application assignment, including
an explicitly submitted 0, because the engine owns the field. Write the source
rows instead.
Rules, constraints, defaults, expiry, sync audiences and horizons, word
tokenization and other aggregates cannot depend on it. Ordinary reads and ordered
pages can. A cursor remains in the same generation across ordinary writes;
counts can move a row across the cursor, so paging a moving ranking is not a
snapshot and can repeat or miss rows.

Maintained columns put an aggregate on the row it describes. Their source
is ordinary and non-expiring. Omit `by` when exactly one source column references
the parent; otherwise name that reference explicitly. The
engine owns the column; a write result omits it. Read the row for its value.
Adding or redefining it recounts existing sources in atomic activation.
The event-free generation barrier makes devices reacquire; a missing stored
field reads 0 without an authored literal default. See `guide maintains`
for disclosure and stream cost, and `guide feeds` for Trending.
