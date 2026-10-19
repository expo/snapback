# N_LOOKUP_FILTERED

N_LOOKUP_FILTERED: An optional mutation lookup of a private side table lacks proved read authority.

Hidden, missing and expired rows all return null. A later field/default or require may mask this cause. Review a minimal readable projection or deliberately handle null; do not widen private rows blindly. Exact key/guard proofs, direct asserted reads and lookups of written tables keep their existing diagnostics. Blind writes are not lookups. This is a source-only missing-proof note, not evidence that a stored row exists. Guide rules.
