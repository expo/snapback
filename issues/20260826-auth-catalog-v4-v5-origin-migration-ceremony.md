# Auth catalog v4→v5 origin migration needs an operator ceremony

**Status:** Open
**Systems:** Auth, Storage, CLI, Backup/restore
**Related:** LLP 0057, LLP 0214 §3.1 and §24, LLP 0303 revision (v)

Catalog v5 roots email-code challenge authority in a keyring commitment stored
during fresh catalog creation. Exact v1–v4 catalogs predate that fact. Runtime
first-writer installation cannot manufacture it without recreating the Round 4
authorization defect.

Design and implement an explicit operator-authorized migration that:

- previews the exact source catalog and candidate keyring without mutating;
- requires quiescence and a validated physical backup unit;
- makes the chosen keyring origin, v5 provenance table, and marker one atomic
  crash-safe transition with marker last;
- defines treatment of every retained pre-v5 verification challenge (the safe
  default is deletion rather than invented provenance);
- refuses missing, corrupt, replaced, or ambiguous keyring custody;
- includes fail-first, crash-matrix, restore, and wrong-keyring evidence.

Until this ceremony exists, predecessor catalogs remain readable but email-code
challenge and step-up operations report provider unavailable.
