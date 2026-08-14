# Tiny data surface A1 fixture

This deliberately small app consumes the published-shape data entrypoints.
Its acceptance test generates the backend, starts the local target, signs in,
commits one three-chunk transaction, and reads the resulting rows across two
bounded pages. It is an acceptance fixture, not a timed LLP 0256 evaluation.
