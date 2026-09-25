# Reads — N_OPTIONAL_FILTER_LIMIT

Optional filters `(status = null or .status = status)` (also `==`, either order)
choose an indexed plan for each presence combination; reset the cursor when
filters change, and inspect each variant with `check --cost`.
At most three optional inputs expand; N_OPTIONAL_FILTER_LIMIT names any extra
residual filters, which can stay metered or move into separate queries.
For mutation population loops and top-level job sweeps, put the optional
condition inside an ordinary capped loop or stable sweep; a presence-selected
read cannot supply that loop domain.
