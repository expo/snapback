# snapback2: journey cleanup follows the project output symlink

**Status:** Closed
**Resolution:** Refused symlinked/escaping journey output components and atomically replaced staged output in project.ts; added external-sentinel regression.
**Systems:** snapback2, compiler, security
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/project.ts:248-260. If a project attacker replaces `.snapback` with a symlink to an external writable directory, running journey preparation recursively removes that external directory contents and then writes generated files through the link. Cleanup uses path-based recursive removal and recreation without an `lstat`/no-follow or canonical-containment check, so the project boundary is not enforced before destructive output handling. Refuse symlinked output components, resolve and verify the parent/project containment, and use no-follow/atomic directory replacement for generated journey artifacts.
