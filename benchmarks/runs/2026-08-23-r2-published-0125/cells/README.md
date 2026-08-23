# Per-cell records

Every child directory is preregistered by `harness-config.json`. `cell.json`
is only the immutable run-slot identity; no completed `record.json` exists
until that cold cell actually runs. The final record and its evidence layout
are specified in the parent README.

Cell directories are never implementation-sharing directories. Private lane
work lives in a fresh external directory, and only the retained evidence named
by the D2 record is copied into its cell directory after validation.
