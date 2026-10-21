# N_LOOKUP_FILTERED

N_LOOKUP_FILTERED: A mutation lookup lacks proved read authority.

Hidden, missing and expired rows all return null. A later field/default or require may mask this cause. Review a minimal readable projection or deliberately handle null; do not widen private rows blindly. An assertion uses its own else code for hidden, absent and expired rows alike. Assertions and later writes grant no read authority; exact key/guard proofs suppress this note. Blind writes are not lookups. This is a source-only missing-proof note, not evidence that a stored row exists. Guide rules.
