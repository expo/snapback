# Snapback2 compiler silently truncates a mutated array key

Status: Open
Date: 2026-09-06
Scope: private compiler lowering; public Quarry reachability not yet established

`const key=['x']; key.push('y'); db.scan(people.ordinary,key,{take:2})`
compiles using only `x`, although the returned array contains both components.
Exact base e6c46a2 and the R4 immutable-capture candidate reproduce it.
Source, full emitted IR and pure values are retained under
`benchmarks/runs/2026-09-06-clique-improvement/evidence/mutable-key/`.

The compiler owner is repairing this before final clearance. Supported key
mutations must preserve actual components; a form outside the bounded language
must receive a precise diagnostic, preserving valid immutable captures.
Verify direct and aliased mutation, helper escape and relevant public Quarry
reachability. Close after review and landing, not after filing this ticket.
