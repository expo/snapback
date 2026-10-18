-- Confirmed against the wave-16 specification for this repaired copy.
invariant hives.read only .landOwner = viewer or (exists routes[inspector = viewer, route = .route] and exists roles[viewer, role = 'inspector']) or exists roles[viewer, role = 'lead']
