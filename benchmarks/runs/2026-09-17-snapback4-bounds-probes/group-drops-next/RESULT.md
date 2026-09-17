# `group(page, …)` drops the page's continuation (published 0.2.27)

Run: `SB=/path/to/snapback4 node measure.mjs` (dev --memory, `POST /seed`, `POST /q/<op>`).

```
10 messages in 2 rooms; page size 4; more rows remain after every first page
  plain          complete=true  cut=null  next=PRESENT  top-level items=4
  grouped        complete=false cut=null  next=absent   top-level items=2
  groupedDirect  complete=false cut=null  next=absent   top-level items=1
  both           complete=true  cut=null  next=PRESENT  top-level items=4
  sorted         complete=false cut=null  next=absent   top-level items=4
  shaped         complete=true  cut=null  next=PRESENT  top-level items=4
```

`check` on this project: `check: ok — 2 tables (0 synced), 6 operations, no problems`.
See `../RESULTS.md` for the reading.
