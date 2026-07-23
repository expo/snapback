# CC-8.5: epoch-scoped uniqueness / version-skew seam design (LLP 0003)

**Status:** Open
**Severity:** P3
**Systems:** Runtime, Storage
**Author:** Claude (Fable), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0086 CC-8 row 5, LLP 0083, LLP 0003
**Marker:** llp-0086-execution
Record in LLP 0003 the seam-design rule: no continuous global uniqueness, no same-version Worker-to-DO call assumption; design for epoch-scoped uniqueness and version skew.
