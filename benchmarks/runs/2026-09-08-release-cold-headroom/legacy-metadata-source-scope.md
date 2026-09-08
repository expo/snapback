# Historical plain-root metadata scope

Root accepts the first-write finding and rejects arbitrary handcrafted legacy
root names as a release blocker. The raw Sol review remains CHANGES REQUIRED;
this is Root’s separate scope adjudication after source inspection.

The plain-root producer at `d7f49f6ffa902b79209578a3015978a95072c34d`
stores object-valued internal metadata fields as whole JSON values under their
field names. At the0.0.18 checkpoint `7b947aa4def19d51ea786783625fb023f3bc891d`,
`store/projection.ts:18–26` contains that producer, `store/range-store.ts:328`
declares the closed `PersistedRangeState`, and line262 declares the closed
`StoreSwap`. `src/client.ts:86–100` exports the public RangeStore/Factory/Swap
surface, not the backend or persisted-state internals; package export entries
likewise expose no backend/test subpath.

The [source checkpoint record](legacy-metadata-source-scope.json) preserves15
version checkpoints, per-interface hashes and extracted field names. The
implementer inspected this ancestry; Root repeated the field extraction and
independently inspected the0.0.18 producer and public exports. All22 observed
internal field names are ordinary identifiers. Application-controlled names
are inside those maps and do not become physical metadata root keys.
This is a source audit, not historical npm-artifact qualification;0.0.11 is
not a listed ancestry checkpoint.

`799ba19a694b8d14246e4533071f20086ee3a877` introduced encoded child keys
before the0.0.19 release source `c170e53f9b78e7fae6d26f4c7aa92ff5265ea799`.
The0.0.19 shared-header/tuple layout and proposed per-root layout support
special own JSON names through their encoded representation.

The older layout never provided a general arbitrary-root namespace: literal
`state` collides with its scalar header, and a literal `["future","child"]`
is byte-identical to an encoded child. Parse-and-shape fallback cannot resolve
that ambiguity. The compatibility statement now covers released internal
plain roots and their arbitrary nested map keys, not fabricated legacy roots
outside that state interface. No heuristic decoder, new discriminator or
compatibility subsystem was added.

The third candidate remains rejected for missing its first durable metadata
baseline. This scope adjudication does not turn any failed qualification or
review into a pass. A fixture derived from the actual0.0.18 field set is useful
additional coverage if a further repair round is authorized.
