# Lane B — Quarry

Work in progress. Base: `3062777ab`. No commits or branch changes.

## Orientation

Scope: Quarry grammar, typed binder/lowering, engine/twin maintain-read parity, generated API types, all `.q` sources and guide grammar. Governing constraints: LLP 1000 (Snapback 2 fence), LLP 1010#A2 (total equality), LLP 1011#B4 (binding-identity narrowing), LLP 1018.005#2 (helper scopes), with the commissioned 2026-09-08 §B rulings superseding older spellings. No additional design decision or hand-off needed.

## Base word inventory

`after`, `allow`, `and`, `at`, `before`, `bool`, `by`, `byId`, `byPrincipal`, `bytes`, `cap`, `channel`, `chunk`, `commit`, `connected`, `count`, `created`, `cursor`, `d`, `decimal`, `delete`, `delivered-history`, `deny`, `depth`, `device`, `divmod`, `duration`, `effect`, `else`, `emit`, `enum`, `every`, `exists`, `false`, `first`, `fn`, `for`, `format`, `from`, `guests`, `h`, `handle`, `height`, `id`, `identity`, `if`, `image`, `immutable`, `in`, `index`, `insert`, `int`, `job`, `json`, `last`, `length`, `m`, `maintain`, `match`, `max`, `merge`, `min`, `money`, `mutation`, `new`, `none`, `not`, `now`, `oblivious`, `of`, `on`, `once`, `or`, `password`, `principal`, `proc`, `public`, `publish`, `query`, `quotient`, `range`, `read`, `readable`, `remainder`, `require`, `retain`, `return`, `s`, `schedule`, `shape`, `share`, `some`, `sorted`, `subscribe`, `sum`, `system`, `table`, `text`, `time`, `tokens`, `tombstones`, `true`, `ttl`, `unique`, `until-revoked`, `up`, `update`, `upsert`, `url`, `use`, `value`, `video`, `viewer`, `walk`, `where`, `while`, `width`, `wordPrefixes`, `words`.

Includes contextual words, implicit fields/indexes, duration units and refused words; punctuation (`#`, `!`, `??`, etc.) is separate. Final runtime-derived test inventory and migration counts follow when verification finishes.
