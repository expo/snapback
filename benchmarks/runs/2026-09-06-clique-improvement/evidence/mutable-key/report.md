# Mutated key loses its appended component

Root read both exact `tuple-push` records from the private compiler harness.
The selected records retain authored source, full IR and pure execution output;
their original complete-file hashes are included. Exact base e6c46a2 and the
R4 candidate both accept a key initialized to `["x"]` and then pushed with
`"y"`. Both return `["x","y"]` while scanning only scalar `"x"`.

This is a private lowering-harness counterexample. It proves emitted key/value
inconsistency, not public Quarry reachability or native database behavior.
Original scripts, schema and full outputs remain under
`/Users/ccheever/clique-improvement/revisions/search-compiler-r4/`.
The immutable-capture repair does not resolve this separate mutation defect.
Root requires a coherent repair before final compiler clearance: supported
key mutations must use their actual components; unsupported dynamic key forms
must be diagnosed without narrowing valid immutable captures.
