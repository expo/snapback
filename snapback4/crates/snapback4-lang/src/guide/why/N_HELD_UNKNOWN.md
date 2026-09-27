# Sync — N_HELD_UNKNOWN

N_HELD_UNKNOWN means a held query may read a table or view with no `sync`. That read is unavailable
on a device, and `held` prevents server fallback. The note names the source
and read site, including reads inside helpers, shapes, conditions and nested
expressions. It is conservative: the branch need not run on every call.

Move the read to its own query, or drop `held`. Keep a thread's history as an
ordinary bare message page and render receipts, profiles, quotes and reactions
from separate queries. Keep `held` for a read the server cannot answer, such
as word search over every chat held on the device. A horizon or a word index
alone does not cause this note. This advice changes neither rules nor routing;
the server still refuses a held query with E_QUERY_HELD.

Run `snapback4 guide sync` for the history and retention recipe.
