-- Confirmed against the wave-16 specification for this repaired copy.
invariant vehicles.liftHold only exists roster[principal = viewer, role = 'liaison']
invariant vehicles always .photos != null

-- Current role revokes former ownership grants, including placed proof assets.
invariant claims.read only (.claimant = viewer and exists roster[viewer, role = 'owner']) or exists roster[viewer, role = 'clerk'] or exists roster[viewer, role = 'manager']
