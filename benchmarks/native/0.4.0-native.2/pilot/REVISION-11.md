# Revision 11 — operator-owned Xcode environment

Authority: Lane P3 Round 2 user ruling, 2026-10-07. CocoaPods generates
`ios/.xcode.env.local` from its machine's Node resolution. This is an environment
leak into custody, not authored content. Convex attempt-01 is superseded by the
sealed `harness-defect-environment-leak` record: no product outcome, zero setup
reruns consumed. Original attempts, builder logs, custody and applications stay
intact. Resume Convex once through both audits, semantic validation, a fresh
Release build, M6 and M8. Snapback 4's measurements stand.

Both backends now record the local file's original bytes, hash and mode before
regenerating it in the operator work copy with the exact Node 24.18.0 binary.
Normalization runs before the first audit, after the builder's preparation and
before compilation. The audits receive this operator ownership explicitly;
authored `.xcode.env` and all other build substitutions remain audited.

The entrypoint's PATH pin did not survive builder login shells: macOS
`/etc/zprofile` invokes `path_helper`, putting Homebrew ahead of the inherited
pin. The old mandated `.snapback-env.sh` then put a Volta shim first, not the
exact binary. Both builders recorded Node 26 even after sourcing that file.
The shim's historical resolution is not fully recoverable from those logs.
The operator environment now puts the exact binary first, and future builders
receive private `.zshenv`/`.zprofile` startup files that restore that pin for
non-login and login commands. The global zsh profiles are unchanged. The
original environment file and targeted shell probes are retained with revision
preparation evidence. This changes no builder task, aid, app or product pin.

Symmetry: both custody files contain
`export NODE_BINARY=/opt/homebrew/Cellar/node/26.9.0/bin/node`.
Snapback 4's unchanged `expo prebuild --clean` recipe regenerated that file;
its prepared file and all 16 `Node found at:` records in the measured Release
build resolve to Node 24.18.0. Convex's non-clean prebuild preserved the old file.
The prepared file and Release-log excerpts are retained; no claim of a Node 26
Snapback 4 measurement is warranted.

The qualified native.2 driver, helper, UI, schemas, runner and instrument seal
are unchanged. Admission remains Charlie's decision after the independent-app
inspection; no scores are authorized. Only the Apartment mini and dedicated
simulator are used. Never black M5 or office M1.
