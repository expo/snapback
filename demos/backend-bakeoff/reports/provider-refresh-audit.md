# LLP 0102 Stage 5 provider refresh audit

**Observed:** 2026-07-29

**Mode:** read-only official documentation, release, registry, and recommended-path check

**Decision rule:** live-refresh only when the provider version, recommended
path, or evidence-bearing behavior changed materially

## Result

Three competitor arms require a live Stage 5 refresh:

1. Research Room / Supabase;
2. Chat / Firebase; and
3. Linear / Firebase.

Every other competitor arm retains its acceptance evidence. Retention is not a
claim that every package stayed byte-identical; it means the observed version
or path change does not affect the exercised outcome.

| Provider | Frozen/tested state | Current official state | Stage 5 verdict |
| --- | --- | --- | --- |
| Convex | Client/CLI 1.42.3; local backend `precompiled-2026-07-21-82d5e9f` | npm remains 1.42.3 and the official version endpoint still selects the tested backend | Retain. Current CLI source still passes `--instance-secret`; Research Room Stop remains current. |
| Supabase | JS 2.111.0 except Research Room, which actually pins 2.57.4; CLI 2.110.0 | JS 2.111.0; CLI 2.110.0 | Refresh Research Room end to end. |
| Firebase | Web 12.16.0; CLI 15.24.0; Chat/Linear Admin 13.5.0 + Functions 6.4.0 | Web 12.16.0; CLI 15.24.0; Admin 14.2.0; Functions 7.3.2 | Refresh Chat and Linear end to end. |
| InstantDB | React/Core/Admin/CLI 1.0.52 | 1.0.53; code delta is a caught/logged rejected persisted-object GC promise | Retain; update final version note. |
| SpacetimeDB | npm 2.7.0; CLI/backend 2.7.0 or exact 2.7.0-hotfix3 | same release line, with hotfix3 latest | Retain. |
| Appwrite | Server 1.9.6, Web 26.2.0, Node 27.1.0, CLI 23.2.0; self-hosted targets | server and SDKs unchanged; CLI 24.0.0 changes Cloud login | Retain self-hosted arms. Any future hosted run must use the current Cloud login path. |

## Material refreshes

### Research Room / Supabase

The lockfile installs `@supabase/supabase-js` 2.57.4, published 2025-09-09,
while the frozen inventory and current registry state are 2.111.0, published
2026-07-28. The client is on the acceptance-critical path for Auth, PostgREST,
Realtime, Storage, session behavior, and Function invocation. A metadata edit
would be invalid; the complete arm must rerun on a fresh isolated target with
new cleanup and confidence evidence.

Primary sources:

- [Supabase JS registry](https://registry.npmjs.org/@supabase%2fsupabase-js/latest)
- [Supabase CLI registry](https://registry.npmjs.org/supabase/latest)
- [Supabase CLI 2.110.0 release](https://github.com/supabase/cli/releases/tag/v2.110.0)
- [Official local CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Official local setup](https://supabase.com/docs/guides/local-development/cli/getting-started)

### Chat and Linear / Firebase

Both arms pin `firebase-admin` 13.5.0 and `firebase-functions` 6.4.0, and their
retained emulator logs warn that Functions is outdated. Current versions are
Admin 14.2.0 and Functions 7.3.2. These are major upgrades: Admin 14 removes
older Node/legacy namespace support and changes dependencies/errors; Functions
7 requires the newer TypeScript/Node surface and removes `functions.config()`.

The arm code already uses modular imports and compatible Node versions, but
live proof is required because callable Functions implement Chat's
authenticated transactional send and Linear's move/comment transaction,
conflict, activity, and settlement paths. Todo needs no refresh because it
already uses Admin 14.2.0 and no Functions package. Partiful and Research Room
already use Admin 14.2.0 plus Functions 7.3.2.

Primary sources:

- [Firebase web SDK registry](https://registry.npmjs.org/firebase/latest)
- [Firebase CLI registry](https://registry.npmjs.org/firebase-tools/latest)
- [Firebase Admin registry](https://registry.npmjs.org/firebase-admin/latest)
- [Firebase Functions registry](https://registry.npmjs.org/firebase-functions/latest)
- [Admin Node release notes](https://firebase.google.com/support/release-notes/admin/node)
- [Firebase breaking-change notices](https://firebase.google.com/support/releases)
- [Emulator Suite setup](https://firebase.google.com/docs/emulator-suite/install_and_configure)

## Retained paths

Convex's current official local endpoint still selects the tested backend, and
current CLI source still places the local control credential in argv. A newer
standalone GitHub backend artifact is not the artifact the recommended CLI path
selects. The final operations note should update the lowest-cost
production-capable plan from Starter to Professional unless Starter is
separately justified.

InstantDB 1.0.53 is a one-patch update whose material Core delta catches and
logs a persisted-object garbage-collection rejection; the CLI has no functional
source delta. It does not alter the tested auth, transaction, subscription,
offline queue, storage, scheduling, or cleanup paths.

SpacetimeDB's packages and official local/Maincloud paths match the tested
2.7.0-hotfix3 line. Appwrite's server and SDKs match; CLI 24 changes only the
untested Cloud login path. Those arms therefore retain their evidence.

Primary sources:

- [Convex npm registry](https://registry.npmjs.org/convex/latest)
- [Convex local backend version endpoint](https://version.convex.dev/v1/local_backend_version)
- [Convex local deployments](https://docs.convex.dev/cli/local-deployments)
- [InstantDB CLI and temporary apps](https://www.instantdb.com/docs/cli)
- [InstantDB Core registry](https://registry.npmjs.org/@instantdb%2fcore/latest)
- [SpacetimeDB hotfix3 release](https://github.com/clockworklabs/SpacetimeDB/releases/tag/v2.7.0-hotfix3)
- [SpacetimeDB Maincloud deployment](https://spacetimedb.com/docs/how-to/deploy/maincloud/)
- [Appwrite server 1.9.6 release](https://github.com/appwrite/appwrite/releases/tag/1.9.6)
- [Appwrite CLI 24 release](https://github.com/appwrite/sdk-for-cli/releases/tag/24.0.0)
