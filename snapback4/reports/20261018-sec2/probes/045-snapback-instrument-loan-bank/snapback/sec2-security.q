-- Confirmed against the wave-16 specification for this repaired copy.
invariant repairNotes.read only exists roles[viewer, role = 'librarian'] or exists roles[viewer, role = 'manager']
invariant loans always .checkoutPhoto != null
