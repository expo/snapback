---
title: "Recipe: install sessions fixtures with profiles and avatars"
id: recipes.sessions-fixture-install
order: 9
audience: agent-first
capabilities: [auth.passwords, backend.assets]
authorities: [llp/0057-auth-provider-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0266-coterie-exact-contract-benchmark.plan.md, demos/coterie/snapback/schema.mjs, demos/coterie/snapback/functions.mjs, demos/coterie/snapback/seed-m1.mjs]
examples: [demos/coterie]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-17
reviewed-authorities-digest: sha256:31512f6cc26158c28004237b72dafe2261f13253628e5a1675164ebfb29caae7
---

# Recipe: install sessions fixtures with profiles and avatars

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe when one deterministic fixture in a sessions-mode app must
include a real password account, a principal-owned application profile, and
typed media. A [versioned seed](../backend/versioned-seeds.md) cannot contain
captured principal ids, and a raw seed asset id would bypass the ordinary
asset lifecycle. The paved composition is therefore one app-owned,
idempotent installer that uses an ordinary session for every fixture identity.

This is one **logical install**, not one database transaction. Account signup,
profile mutation, upload finalization, and typed attachment settle at their
ordinary boundaries. If a run stops midway, the same installer resumes through
its match-or-repair checks.

## Give each fixture its own ordinary session

Read personas and media digests from committed fixture inputs. For each
persona, create a client with its own custody partition, then close that auth
context before advancing. Coterie uses the same `AuthCoordinator` and
`SnapbackClient` path as application auth; no admin impersonation or seeded
principal id enters the flow:

```js source=demos/coterie/snapback/seed-m1.mjs
function createPasswordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
  return { client, coordinator };
}
```

The backend profile shape must bind ownership to `ctx.auth.userId`, expose an
owner-scoped lookup with no caller-supplied owner argument, and attach avatars
through a restricted `v.assetRef`. Coterie's `ensureMyProfile` derives
`ownerId` from server authority, while `attachMyAvatar` rechecks profile
ownership and calls `ctx.assets.attach(..., { upload: 'avatarUpload' })`.

## Verify fixture media before reporting a match

Pin a fixture-source digest independently of Snapback's asset record. Coterie
loads the expected SHA-256 from the committed media manifest, hashes the local
bytes before any request, and later requires the profile's
`avatarSourceDigest` to equal that value:

```js source=demos/coterie/snapback/seed-m1.mjs
function expectedAvatarDigest(persona) {
  const filename = basename(persona.profile.avatar);
  const digest = mediaManifest.artifacts?.[filename]?.sha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`fixture ${persona.id} has no expected avatar digest for ${filename}`);
  }
  const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
  const observed = createHash('sha256').update(bytes).digest('hex');
  if (observed !== digest) {
    throw new Error(`fixture ${persona.id} avatar bytes do not match ${digest}`);
  }
  return digest;
}
```

A match also requires a ready, end-to-end-verified asset record. Do not call an
account a match merely because its email already exists, or because the
profile carries some nonempty asset id.

## Sign up first; on existence, sign in and prove the whole fixture

Attempt password signup on the first install. If it succeeds, the client owns
the new ordinary session and proceeds to application writes. The only
duplicate-account branch accepted is `SNAPBACK_AUTH_PASSWORD_EXISTS`; on that
code, sign in with the fixture password and inspect the owner-scoped profile:

```js source=demos/coterie/snapback/seed-m1.mjs
      let accountDisposition = 'created';
      let rows = [];
      try {
        await fixture.client.authPasswordSignup({
          email: persona.email,
          password: persona.password,
        });
      } catch (error) {
        if (diagnosticCode(error) !== 'SNAPBACK_AUTH_PASSWORD_EXISTS') throw error;
        const signin = await fixture.client.authPasswordSignIn({
          email: persona.email,
          password: persona.password,
        });
        rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
        const current = rows[0];
        const fixtureMatches = rows.length === 1
          && current
          && current.ownerId === signin.session.userId
          && current.fixtureId === persona.id
          && current.handle === persona.profile.handle
          && current.displayName === persona.profile.displayName
          && current.bio === persona.profile.bio
          && current.location === persona.profile.location
          && current.link === persona.profile.link
          && await avatarMatchesFixture(fixture.client, current, avatarDigest);
        if (fixtureMatches) {
          accounts.push({ id: persona.id, email: persona.email, disposition: 'matched' });
          profiles.push(profileSnapshot(current));
          continue;
        }
        accountDisposition = 'repaired';
      }
```

The `continue` is the idempotence boundary: a matched repeat performs the
password sign-in and read-only verification, then performs **no asset upload
and no application write**. Wrong passwords, multiple owner rows, owner
mismatch, fixture-field drift, missing media, or digest drift never report
`matched`; they fail or enter the explicit repair path.

## Create or repair the profile, then upload and attach ordinarily

Use one server-authorized ensure mutation for the application row. Re-read the
owner-scoped profile and confirm the returned id. Upload only when the current
typed avatar does not already match the fixture digest; require the upload task
to reach `ready`, then attach the asset through the application mutation:

```js source=demos/coterie/snapback/seed-m1.mjs
      const profileId = (await fixture.client.mutate(api.ensureMyProfile, {
        args: {
          fixtureId: persona.id,
          handle: persona.profile.handle,
          displayName: persona.profile.displayName,
          bio: persona.profile.bio,
          location: persona.profile.location,
          link: persona.profile.link,
        },
      })).result;

      rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
      if (rows.length !== 1 || rows[0]._id !== profileId) {
        throw new Error(`fixture ${persona.id} did not resolve its own profile`);
      }
      if (!await avatarMatchesFixture(fixture.client, rows[0], avatarDigest)) {
        const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
        const assets = createAssetClient(fixture.client);
        const upload = assets.start({
          upload: api.avatarUpload,
          file: new Blob([bytes], { type: 'image/png' }),
          declaredFilename: `${persona.id}-avatar.png`,
          declaredContentType: 'image/png',
        });
        const terminal = await upload.done;
        if (terminal.status !== 'ready') {
          throw new Error(`fixture ${persona.id} avatar failed: ${JSON.stringify(terminal.diagnostic ?? terminal)}`);
        }
        await fixture.client.mutate(api.attachMyAvatar, {
          args: {
            profileId,
            assetId: terminal.assetId,
            sourceDigest: avatarDigest,
          },
        });
        rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
      }
```

Finish by repeating the whole avatar match predicate before emitting the
report. Use `created`, `repaired`, and `matched` as distinct dispositions;
only `matched` promises the no-write repeat path.

## Anti-patterns

- **Do not seed captured principal ids.** Install real accounts through
  password signup and let server-derived session authority own the profile.
- **Do not treat `SNAPBACK_AUTH_PASSWORD_EXISTS` as success by itself.** Sign
  in and verify owner, fixture fields, source digest, and asset readiness.
- **Do not upload before the match check.** A matched repeat must perform no
  upload and no application mutation after sign-in.
- **Do not store a raw asset id in the profile.** Finalize through the ordinary
  asset client and attach through the typed, owner-authorized mutation.
- **Do not call this atomic.** It is restart-safe application installation;
  each account, mutation, upload, and attach keeps its own settlement boundary.
