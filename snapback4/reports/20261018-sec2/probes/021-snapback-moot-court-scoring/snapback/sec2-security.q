-- Confirmed against the wave-16 specification for this repaired copy.
invariant directors.createTournament only exists directors[viewer] or viewer = 'service:ops'
