# Snapback 4: Route admission regression races its 50 ms deadline

Status: Open
Priority: P3
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)

## Evidence

Untouched a0d48a4 baseline on Linux: scripts/test.sh failed serve::tests::route_tests::route_development_exception_does_not_expose_core_doors_or_personas: expected one admitted request after real bearer, got zero. Test host budget is 50 ms while the complete suite runs concurrent work. Product versus fixture cause remains to be established.

## Acceptance

Trace deadline/admission ordering. Remove a wall-clock race from the authority assertion without weakening forbidden-door/persona coverage or route deadlines. Run the affected test with the full HTTP test group. Preserve evidence if the product is wrong; do not merely increase a global product ceiling.
