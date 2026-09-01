# snapback2: nested operation modules pass checks but disappear from the API

**Status:** Closed
**Resolution:** Diagnosed every recursively discovered nested operation module in project.ts; added omitted-module project regression.
**Systems:** snapback2, compiler
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/compiler/src/project.ts:37-50. A project containing `functions/top.ts` and `functions/admin/users.ts` can pass the project check, but only top-level files are collected, so the nested operation is absent from generated API declarations and cannot be invoked. Project discovery reads a single directory level without either recursively compiling subdirectories or rejecting them, leaving valid-looking source silently unused. Recursively discover supported operation modules with deterministic naming, or emit a clear diagnostic for every nested source file so a successful check cannot omit authored operations.
