# N_LOOKUP_HIDDEN

A mutation finds a row under its read rule before the write rule runs. `check` notes N_LOOKUP_HIDDEN when an update or delete rule admits a role (`exists drivers[viewer]`) that no read-rule disjunct uses, and a mutation writes that table by key: a holder who reads the row no other way gets NOT_FOUND. Let the role read the rows it acts on (`read <- … or .status = 'requested' and exists drivers[viewer]`). If the holders always read the row another way, the role only widens the write rule for them and nothing changes.
