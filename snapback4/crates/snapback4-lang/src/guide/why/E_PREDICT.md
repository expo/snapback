# Prediction — E_PREDICT

E_PREDICT means the device cannot establish this call's prediction from
its held facts or submission IDs. For example, an `upsert` missing beyond
a sync horizon cannot assume the target is absent. The local client keeps
the write queued without predicted rows and lets the server judge it;
observe its pending/failed/sent state instead of treating missing local
rows as success. Inspect `snapback4 why <op>` and the named site. Acquire
the required partition, or redesign the read to need held facts; never
invent an empty row or mint different IDs on replay.

`upsert` set-state writes (likes, reactions and votes) predict updates of
rows the device holds. A missing row predicts an insert only when its synced
group is held with no horizon, both the key and the materialized insert image
prove readability, and the device holds every row that can collide on a
secondary unique index or count toward an affected cap. Defaults are part of
that image. Otherwise it queues without a predicted row, including in a left
group. See `guide prediction` for the conditions and a set-membership recipe.
An expiring cap counts unswept physical rows, which live snapshots omit.
Occupancy-increasing writes queue without predicted rows and settle on the
server even after full acquisition; updates within a cap group can still predict.
Replacing an expired same-id row also queues: the server may have swept it and
refilled the cap before sync reaches the device. A held live row can still
support an update within its cap group.
