# Snapback2 compiler silently truncates a mutated array key

Status: Closed
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

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed as obsolete private-authoring-path
behavior; this is not a claim that the retired mutable-array lowering was
repaired.

Commit `090bb82bc` deleted the TypeScript data compiler and its mutable
collection/scan-key lowering. Supported backend authoring is direct Quarry,
which has no `push`, mutable array alias, or helper-escape expression surface;
`project.ts::lowerProject` refuses TypeScript data modules. The 2026-09-11
compiler suite passed `Successor guide fill recipe is the compiled fixture and
mutable keys refuse at check` plus the TypeScript-data refusal check.

The named compiler checks passed within a run that finished 297 passed /
1 failed (`JourneyEffects.provider` declaration mismatch); this is not a
complete compiler-suite pass.

The report's exact `const key = ['x']; key.push('y')` path is unreachable. A
new public Quarry key-mutation or aliasing reproduction would be a new ticket.
