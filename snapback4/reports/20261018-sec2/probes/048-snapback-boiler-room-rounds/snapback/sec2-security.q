-- Confirmed against the wave-16 specification for this repaired copy.
invariant gauges.read only exists roles[viewer, role = 'chief'] or exists roles[viewer, role = 'engineer'] or (exists assignments[.id, viewer] and exists roles[viewer, role = 'contractor'])
