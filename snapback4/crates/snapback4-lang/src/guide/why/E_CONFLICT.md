# Writes — E_CONFLICT

E_CONFLICT means a conditional update found that the row changed.
The refusal carries the current row only when its read rule admits the viewer.
Read it and retry with a fresh edit.

`old` in a rule and the conditional update's `if` are evaluated inside the
engine. An update/upsert result and conflict `current` are read-rule gets,
never the merged patch image: null or withheld when hidden at that read.
A patch can grant read authority and then return its row. Omitted asset columns
keep their placement. An explicit asset id on a row you cannot read must be your
own upload, even if it equals the retained id. Update authority is checked
before asset diagnostics. A readable aggregate view is an explicit delta read channel;
`N_MAINTAIN_DELTA` notes potentially wider source update authority.
