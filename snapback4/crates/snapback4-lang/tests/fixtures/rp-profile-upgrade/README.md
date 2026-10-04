# Authentic calibration profile upgrades

The two complete app sources are the unchanged `rp-calibrations/0411` and
`0412` Quarry modules. Astra compiled them with unmodified **a8c20c40e9** on
eb1000 and acquired seven-member groups using the actual old wasm. These
backends and acquired persistence records come verbatim from
`/tmp/rp-r5-astra-evidence/authentic-{0411,0412}-kept.json`. No stamp, price,
operation fact, or generation is edited to simulate an old version.

The first `device:backend` value is split immediately before `,"programs":`
into `backend-schema.part` and `backend-programs.part`, solely to keep every
file below 256 KB. Joining their UTF-8 bytes restores the original value.
`acquired.json` contains all remaining old persistence changes in order.

`generate.mjs` opens that old kept image with the actual **a8c20c40e9 wasm**,
admits `profile-before-upgrade`, asserts a predicted profile row and writes
`pending.json`, the exact old persistence delta. It validates the old wasm SHA
`1fd8cd3fdef29bc5038a642e10ba0eb22df841b44ca704d1f0d2d4f5decf0e74`.
Both generations were run on eb1000. To verify byte-equivalent JSON records:

```sh
node generate.mjs /path/to/a8c20c40e9/snapback4/packages/snapback4/src/wasm
# To regenerate only the pending batch: UPDATE_RP_OLD_PROFILES=1 node ...
```

Native tests load the concatenated changes directly into memory. The SQLite
case transplants those exact records through the store adapter, including old
backend metadata, queue and prediction bases; it is not presented as an old
SQLite binary fixture. The original receipt upgrade still tests actual old
SQLite/server database files and delivery debt. The wasm test uses the SDK's
real `openLocalDevice` with the current bundle supplied but no adoption,
persists/reopens offline, then adopts. All three runtimes retain both the old
pending save and a new offline queued save. Adoption restores prediction.

`settlement.json` is re-executed by the current Rust server on every suite: its
three acknowledgments and final acquisition pages prove all saves commit and
converge to the final profile without provisional rows. Regenerate that oracle
with `UPDATE_RP_PROFILE_CASES=1 cargo test -p snapback4-lang --test
reservation_app_headroom authentic_profile`. Existing old fixtures remain
immutable; the generator needs neither a capability rename nor a new compiler.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| 0411/acquired.json | 10307 | a46b725ccc789e9c17c454814790fd20835e3aef8ba20c3e26e29479c27ad6c0 |
| 0411/backend-programs.part | 133758 | bb9542c70792ad9972538af34be88530d6685f2947efb05eeb1a05560b7ca94c |
| 0411/backend-schema.part | 127683 | f4e05b9b8e042da52225a4b6efe4c4fb8a438f43598f9714d2bd12f7d6745800 |
| 0411/pending.json | 1305 | 944b71751f922a140a785bcde247a25da4befaf36f3278f2e853503a4c495333 |
| 0411/settlement.json | 30252 | 643b289cb6db0476505734d81606ea22c370bc2336664bb269721034be2e8d67 |
| 0412/acquired.json | 9917 | 7c093c0d40ea7b639f67c215c307880090a0bc8184abebac0ee1384c685d8f8c |
| 0412/backend-programs.part | 123254 | b6e58a7a778401bbcf2b0e1c783f240b86b3df8a2cb2c735aa98a07261e8fbb6 |
| 0412/backend-schema.part | 127140 | a46f3ec193b2030da9874029c380682776c01e912f3c78f23dd865f4f5884f2e |
| 0412/pending.json | 1305 | 944b71751f922a140a785bcde247a25da4befaf36f3278f2e853503a4c495333 |
| 0412/settlement.json | 29727 | 840647a22d4de0de52d98a4cff8cf03448427bbbe5c8d0ad4814f72d912d1fae |
