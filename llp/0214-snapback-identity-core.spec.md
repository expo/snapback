# LLP 0214: Snapback identity core

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Identity, Storage, Code generation, Client integration,
Security, Delivery, Testing
**Author:** Charlie Cheever / Codex (gpt-5.6-sol) via Claude orchestration
**Date:** 2026-08-09
**Revised:** 2026-08-09 (v0.1 — initial commissioned Draft)
**Revised:** 2026-08-10 (v0.2 — LLP 0227 reconciliation amendment,
commissioned by the author; see §20)
**Revised:** 2026-08-15 (v0.3 — the 12-byte password minimum remains the
default; `defineAuth` may declare one app-wide 8–128-byte minimum, enforced at
first-boot provider construction and named in policy refusals)
**Revised:** 2026-08-15 (v0.4 — LLP 0258 amendment: `defineAuth` owns the
application-client custody grade and explicit external-session entry seam)
**Related:** LLP 0212, LLP 0011, LLP 0151, LLP 0057, LLP 0055, LLP 0036,
LLP 0045, LLP 0053, LLP 0058, LLP 0215, LLP 0227, LLP 0241, LLP 0252,
LLP 0258

## Summary

This Spec is the identity-core document commissioned by LLP 0212 landing
item 2.

It defines the shared substrate on which Snapback's guest, password,
email-verification, recovery, provider, rehearsal, and future lifecycle
features compose:

1. a declared, versioned `defineAuth(...)` program;
2. catalog version 3 and its principal / identity / credential / assurance
   storage split;
3. the assurance record and requirement-evaluation rules;
4. a sealed verified-provisioning hook;
5. a read-only, server-derived `ctx.auth.claims` projection;
6. the complete wave-1c guest/password/recovery transition floor;
7. deploy-time no-delivery readiness;
8. guest-first template and reaping posture; and
9. typed diagnostics and executable acceptance obligations.

The principal remains the durable root. App data references a
Snapback-issued principal id, never an email, provider subject, credential,
session, or assurance.

Identities, credentials, and assurances are attachments to that principal.
They never substitute for the principal and never share one relation.

Verification upgrades capability through an assurance. It does not globally
gate account creation or login.

The verified-provisioning hook is the paved path for creating an app profile,
identity binding, or initial membership from verified identity evidence.
A client-callable `bindMe({userId})`-style mutation remains an authentication
bypass and remains rejected.

Catalog versions 1 and 2 remain exactly recognizable and usable for the
surfaces they already support. They are never silently migrated. Fresh
identity-core activations install exact catalog version 3.

This Spec does not change LLP 0057's session bearer, token-family, rotation,
expiry, family-alarm, or bulk-revocation protocol.

## 1. Scope and normative language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

This Spec owns:

- auth-program declaration and validation;
- catalog-v3 identity-core shape and recognition;
- the assurance record and admissibility rules;
- assurance requirements on functions;
- verified provisioning;
- the handler claims projection;
- guest creation and floor claiming;
- password creation, authentication, set, and change;
- recovery-code issue, consume, and rotation;
- the floor's session, journal, notification, and last-authenticator rules;
- readiness facts and the no-delivery deployment diagnostic; and
- the identity-core diagnostic and acceptance registers.

This Spec does not own:

- rehearsal grant or window minting;
- effect-budget axes, limits, charging semantics, or refusal envelopes;
- general account merge, `switch_existing`, quarantine, or chunked migration;
- OAuth completion and callback protocols;
- provider-specific token validation;
- passkey ceremony details;
- general MFA composition;
- session/token-family semantics; or
- delivery-vendor drivers.

Those boundaries fail closed. An unavailable dependency is a typed
unavailable or unsupported result, never inferred authority.

All durable timestamps use integer Unix epoch milliseconds in
`0..=9_007_199_254_740_991` and use LLP 0059's durable auth clock floor.

All source, manifest, DTO, and persisted tagged unions in this Spec are
closed. Unknown tags or fields are rejected.

## 2. The declared auth program

### 2.1 One source declaration

An app declares its identity surface once:

```ts
export const auth = defineAuth({
  version: 1,

  mechanisms: {
    guest: {
      kind: 'guest',
    },

    password: {
      kind: 'password',
      identifier: 'username',
      provider: 'localPassword',
      recovery: 'recoveryCodes',
    },

    emailCode: {
      kind: 'email-code',
      identityKind: 'email',
      provider: 'emailCode',
      delivery: 'transactionalEmail',
    },
  },

  providers: {
    localPassword: {
      kind: 'built-in',
      mechanism: 'password',
    },

    emailCode: {
      kind: 'built-in',
      mechanism: 'email-code',
      canonicalization: 'email-v1',
    },
  },

  assuranceRequirements: {
    accountSensitive: {
      allOf: ['email_verified', 'recent_auth'],
    },
  },

  deliveryAdapters: {
    transactionalEmail: {
      channel: 'email',
      kind: 'provider',
      assuranceClass: 'contact-ownership',
      credentialRefs: ['authEmailProvider'],
    },

    capturedEmail: {
      channel: 'email',
      kind: 'capture',
      assuranceClass: 'simulation',
      profiles: ['dev', 'test', 'demo'],
    },
  },

  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },

  guestPolicy: {
    enabled: true,
    claiming: ['emailCode'],
    reaping: {
      afterMs: AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
      cleanup: {
        kind: 'declarative',
        default: 'tombstone',
        tables: {},
      },
    },
  },

  abuseBudgets: {
    guestCreate: 'auth.guest.create',
    accountCreate: 'auth.account.create',
    passwordGuess: 'auth.password.guess',
    passwordHashCpu: 'auth.password.hash-cpu',
    recoveryCodeGuess: 'auth.recovery-code.guess',
    identityEnumeration: 'auth.identity.enumeration',
    sessionMint: 'auth.session.mint',
  },

  secretReferences: {
    authEmailProvider: {
      config: 'authEmailProvider',
    },
  },

  verifiedProvisioning: {
    handler: 'provisionVerifiedIdentity',
    requires: ['email_verified'],
    reads: ['profile'],
    writes: [
      {
        table: 'profile',
        mode: 'ordinary',
      },
      {
        table: 'identityBinding',
        mode: 'identity-binding',
        principalField: 'principalId',
        identityField: 'email',
      },
      {
        table: 'membership',
        mode: 'permission-backing',
        principalField: 'principalId',
      },
    ],
  },
});
```

The syntax above is normative in shape. Internal property ordering is not
significant; generated canonical ordering is.

`defineAuth(...)` is separate from `defineSchema(...)` but is compiled in the
same generation transaction. An app cannot activate a schema/functions bundle
whose referenced auth program is missing, stale, or invalid.

### 2.2 Program fields

The closed version-1 declaration contains exactly:

| Field | Required | Meaning |
| --- | ---: | --- |
| `version` | yes | Auth-program source version; exactly `1` here |
| `custody` | no | Application-client authority custody grade; defaults to `durable-required` |
| `externalSessionEntry` | no | Literal `true` explicitly admits the advanced external-session entry seam |
| `mechanisms` | yes | Named guest, password, email-code, passkey, or future recognized mechanism instances |
| `providers` | yes | Named built-in or external provider installations |
| `assuranceRequirements` | yes | Named conjunctions of assurance kinds; `{}` is valid |
| `deliveryAdapters` | yes | Named delivery or simulation adapters; `{}` is valid |
| `recoveryPolicy` | yes | Recovery-code and last-authenticator policy |
| `guestPolicy` | yes | Guest enablement, claiming mechanisms, retention, and cleanup |
| `abuseBudgets` | yes | References to names owned by the effect-budgets Spec |
| `secretReferences` | yes | References to LLP 0036 configuration entries; never values |
| `verifiedProvisioning` | no | One sealed provisioning-hook declaration |

Mechanism and provider names are app-local identifiers.

A provider installation binds its name immutably to its provider kind,
issuer or local authority, tenant/team where applicable, client-registration
ownership, and canonicalization version.

Changing any of those identity-defining fields requires a new provider
installation name or a first-class identity migration. Reconfiguration never
silently reinterprets existing identity rows.

### 2.3 Mechanism declarations

Version 1 recognizes these mechanism tags:

- `guest`;
- `password`;
- `email-code`; and
- `passkey`, as a declared future-capable slot whose ceremony remains outside
  the wave-1 floor.

Unknown mechanism tags are rejected.

A password mechanism MUST name:

- its identifier class;
- its immutable local provider installation; and
- its recovery policy.

The wave-1 password floor uses `identifier: 'username'`.

An email-code mechanism MUST name:

- `identityKind: 'email'`;
- a provider installation;
- a versioned canonicalization rule; and
- a delivery adapter.

A guest mechanism has no identity or credential provider. It creates a
principal and session directly through the guest transition.

### 2.4 Provider declarations

Version 1 recognizes these provider tags:

- `built-in`;
- `oidc`;
- `oauth2`;
- `external-verified-token`; and
- `import`.

This Spec implements only the identity-core contract shared by those tags.
Provider-specific proof and completion protocols stay with LLP 0151 and its
commissioned implementing Specs.

An OIDC provider installation identifies its external subjects by exact
`(issuer, subject)`.

A provider alias is not itself an issuer. Existing rows remain meaningful
because activation refuses a provider declaration whose identity-defining
binding differs from the active declaration for that name.

### 2.5 Secret references only

`secretReferences` contains reference metadata, never credential values.

A reference names a declared LLP 0036 configuration entry:

```ts
secretReferences: {
  authEmailProvider: {
    config: 'authEmailProvider',
  },
}
```

The auth program, generated manifests, client bundles, registration
instructions, readiness facts, fixtures, diagnostics, and receipts MUST NOT
contain the referenced value.

The referenced LLP 0036 entry remains responsible for:

- value custody;
- no-read-back behavior;
- config generation;
- write/apply status;
- redaction;
- target-specific storage; and
- provider-action `uses` grants.

A literal secret-like field in a provider or delivery declaration is rejected
at generation time. It is not automatically moved into config state.

Missing referenced values appear only as named readiness facts and
operator-locus diagnostics. Public request failures do not disclose config
entry names.

### 2.6 Assurance requirement declarations

The built-in assurance kinds are:

- `authenticated`;
- `email_verified`;
- `phone_verified`;
- `recent_auth`; and
- `phishing_resistant`.

An app may declare a named requirement as an `allOf` conjunction:

```ts
assuranceRequirements: {
  accountSensitive: {
    allOf: ['email_verified', 'recent_auth'],
  },
}
```

Requirement aliases may refer to built-in kinds or earlier aliases after
canonical graph resolution. Cycles are rejected.

The normalized requirement graph is independent of object insertion order.

A function declares requirements in the same source object that carries
`auth`:

```ts
export const createInvoice = defineJsMutation({
  auth: 'authenticated',
  requires: ['email_verified'],
  args: {},
  reads: [],
  writes: ['invoice'],
  handler: async (ctx) => {
    // The shared invocation gate has already admitted email_verified.
  },
});
```

`requires` is a conjunction. Every listed kind or alias must be satisfied.

`requires` does not imply `auth: 'authenticated'`. A function requiring any
assurance other than an explicitly future authority-independent kind MUST also
declare `auth: 'authenticated'`; contradictory combinations fail generation.

Unknown requirement names, duplicate names, cycles, and impossible requirement
combinations are generation errors.

### 2.7 Recovery policy

The recovery policy MUST state:

- whether recovery codes are enabled;
- when they are mandatory;
- whether a successful use rotates the set;
- the plaintext-custody class; and
- whether the last-authenticator rule is enforced.

Version 1 requires:

```text
requiredWhen = no-independent-recovery
rotateAfterUse = true
plaintextCustody = one-time-response
lastAuthenticator = enforce
```

An app cannot weaken those values while claiming the wave-1 floor.

Email-based recovery is a separate optional path and is available only when a
verified email identity and a production-admissible email delivery adapter are
both available.

### 2.8 Guest policy

`guestPolicy.enabled` is explicit. The platform-wide default remains disabled.

The agent-built starter template explicitly enables it.

The policy MUST name:

- mechanisms allowed to claim the guest;
- a retention deadline for unclaimed guests; and
- a cleanup contract.

Cleanup is one of:

```ts
type GuestCleanup =
  | {
      kind: 'declarative'
      default: 'delete' | 'tombstone' | 'retain-anonymized'
      tables: Record<string, {
        principalField: string
        onReap: 'delete' | 'tombstone' | 'retain-anonymized'
      }>
    }
  | {
      kind: 'handler'
      handler: string
      reads: readonly string[]
      writes: readonly string[]
    };
```

The template default is declarative `tombstone`.

Codegen checks every declared app relation known to carry a guest principal
against the cleanup declaration. An unclassified reference is a typed
generation error.

A handler cleanup contract is host-invoked, bounded to declared reads/writes,
idempotent, and external-effect-free.

### 2.9 Abuse-budget references

`abuseBudgets` contains names from the effect-budgets Spec.

This document consumes, and does not redefine, these names:

- `auth.guest.create`;
- `auth.account.create`;
- `auth.password.guess`;
- `auth.password.hash-cpu`;
- `auth.recovery-code.guess`;
- `auth.identity.enumeration`; and
- `auth.session.mint`.

Limits, charge axes, trust tiers, retry-after calculation, idempotency
accounting, and charge-on-denial semantics belong exclusively to the
effect-budgets Spec.

Unknown budget names are generation errors.

A required budget implementation that is absent at activation makes the
mechanism unavailable. It never falls back to an unbudgeted path.

### 2.10 Versioning and validation

Auth-program version and catalog version are separate domains.

Version 1 of `defineAuth(...)` produces catalog-v3 requirements, but a later
auth-program source version need not imply a catalog change.

The declaration validator MUST:

- use closed tagged unions;
- apply `deny_unknown_fields` at every object level;
- reject duplicate JSON or source-object keys after lowering;
- reject references to unknown mechanisms, providers, adapters, budgets,
  secrets, functions, or tables;
- reject unused security-sensitive provider secret references;
- reject provider identity-binding mutation under an existing installation
  name;
- reject requirement cycles;
- reject a delivery adapter whose assurance class conflicts with its kind;
- reject recovery configurations without the last-authenticator rule;
- reject enabled guest policy without cleanup;
- reject provisioning writes outside the declared app schema; and
- produce no generated outputs after any error.

Unknown program versions produce
`SNAPBACK_AUTH_PROGRAM_VERSION_UNSUPPORTED`.

No compatibility parser guesses the meaning of an unknown field or version.

### 2.11 Typed codegen diagnostics

Every generation diagnostic contains:

```ts
type AuthCodegenDiagnostic = {
  code: string
  severity: 'warning' | 'error'
  message: string
  path: readonly (string | number)[]
  sourceSpan?: {
    file: string
    start: number
    end: number
  }
  details: Readonly<Record<string, unknown>>
};
```

Details may name declaration keys, valid tags, functions, tables, adapter
names, budget names, or secret-reference names.

Details never contain secret values, passwords, recovery codes, session
bearers, provider tokens, or full challenge payloads.

The generated summary groups auth diagnostics under `auth`.

### 2.12 Codegen derivations

A valid auth program deterministically derives:

1. **Catalog requirements**
   - required catalog version;
   - exact v3 table/index descriptor;
   - activation and recognition facts.

2. **Request and response schemas**
   - closed JSON schemas for enabled public auth transitions;
   - closed schemas for operator and readiness projections;
   - secret response-sensitivity classifications.

3. **Client state machines**
   - enabled transition states;
   - admissible events;
   - credential-response adoption;
   - session rotation and logout barriers;
   - recovery-code custody prompts;
   - collision and retry outcomes.

4. **Requirement metadata**
   - normalized assurance graph;
   - per-function `requires`;
   - shared-gate admission plans;
   - review projections.

5. **Readiness facts**
   - required assurance producers;
   - declared and available delivery channels;
   - missing configuration references;
   - catalog compatibility;
   - hook availability.

6. **Fixture vocabulary**
   - logical guest, password, verified-email, unverified-email,
     recovery-used, recovery-rotated, and collision scenarios;
   - logical aliases, never raw principal ids;
   - assurance kinds and provenance names;
   - no plaintext credentials in committed fixture artifacts.

7. **Provider-registration instructions**
   - exact callback values;
   - provider installation identity;
   - required scopes;
   - required config-reference names;
   - automated registration steps where an API exists;
   - deterministic human ceremony where one does not.

Registration instructions are generated data, not authority. They cannot write
provider state or LLP 0036 values without a separately authorized operation.

Generated artifacts carry:

- auth-program source version;
- normalized program digest;
- schema/functions bundle digest;
- catalog requirement;
- generator version; and
- deterministic dependency hashes.

A stale artifact pair fails activation.

## 3. Catalog version 3

### 3.1 Version policy

The catalog marker remains:

```text
_snapback_meta['auth_catalog_version']
```

The composed recognition table is:

| Marker / state | Result |
| --- | --- |
| No marker and no auth-reserved collision | `Uninitialized` |
| No marker and an auth-reserved object exists | existing 0057 collision diagnostic |
| `1` plus exact LLP 0057 v1 shape | `ReadyV1` |
| `2` plus exact LLP 0055 v2 shape | `ReadyV2` |
| `3` plus exact v3 shape in this Spec | `ReadyV3` |
| Recognized marker with a changed or extra owned object | `SNAPBACK_AUTH_CATALOG_CORRUPT` |
| Any unrecognized marker | `SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED` |

Recognition is exact in the LLP 0057 sense:

- tables;
- columns;
- declared types;
- nullability;
- primary keys;
- checks;
- foreign keys;
- named indexes;
- uniqueness;
- indexed columns; and
- partial-index predicates.

A current identity-core binary recognizes v1 and v2 exactly.

It MUST NOT alter either catalog during recognition.

A `ReadyV1` catalog retains v1 session and email-code behavior.

A `ReadyV2` catalog retains v2 session, email-code, and agent behavior.

Identity-core surfaces that require v3 refuse on v1/v2 with
`SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3`.

No current activation silently migrates v1 or v2.

A first-class migration requires its own plan, preview, backup rule,
transaction, crash matrix, and acceptance evidence.

Fresh activation creates exact v3 and inserts marker `3` last in the same
`IMMEDIATE` transaction.

Until this Spec is implemented, the shipped binary's fresh-v2 behavior remains
the current implementation fact. Implementation of this Spec changes the fresh
activation target to v3; it does not reinterpret already-created v2 stores.

### 3.2 Reserved namespace

LLP 0057's reservation carries forward unchanged.

An identifier is reserved when its ASCII-lowercased spelling is exactly
`_auth` or begins `_auth_`.

App schema, manifest, `ctx.db`, sync, live queries, direct storage, imports,
admin edits, and generated client types cannot name or expose these objects.

The reservation is a namespace rule, not a fixed table list.

Catalog-v3 additions do not create an exception.

### 3.3 Four storage layers

Catalog v3 has four identity layers:

1. `_auth_users` — principals;
2. `_auth_identities` — identity links;
3. `_auth_credentials` and typed material relations — credentials;
4. `_auth_assurances` — assurance records.

The existing `_auth_users` physical name is retained for catalog and session
compatibility. Its semantic role is principal.

A guest is represented as a human principal with active guest state. Guest
claiming changes that state while preserving the principal id.

An LLP 0055 agent remains an agent principal. This Spec does not add another
service-principal kind or change LLP 0055 grant semantics.

Identities and credentials have no shared material column or polymorphic row.

A password hash cannot appear in `_auth_identities`.

An email, OIDC subject, or provider subject cannot appear as credential
material.

An assurance cannot be represented as a boolean column on either relation.

### 3.4 Principal relation

Catalog v3 replaces the v2 `_auth_users` descriptor with the v2 columns plus
guest lifecycle fields:

```sql
CREATE TABLE "_auth_users" (
  id TEXT NOT NULL PRIMARY KEY,
  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),

  kind TEXT NOT NULL DEFAULT 'human'
    CHECK(kind IN ('human', 'agent')),

  display_name TEXT,
  operator_contact TEXT,
  registration_provenance TEXT,

  deactivated_at_ms INTEGER
    CHECK(deactivated_at_ms IS NULL
      OR deactivated_at_ms BETWEEN 0 AND 9007199254740991),

  owner_user_id TEXT,

  guest_state TEXT NOT NULL DEFAULT 'never'
    CHECK(guest_state IN ('never', 'active', 'claimed', 'reaped')),

  guest_expires_at_ms INTEGER
    CHECK(guest_expires_at_ms IS NULL
      OR guest_expires_at_ms BETWEEN 0 AND 9007199254740991),

  guest_claimed_at_ms INTEGER
    CHECK(guest_claimed_at_ms IS NULL
      OR guest_claimed_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(kind = 'agent' OR registration_provenance IS NULL),
  CHECK(kind = 'human' OR registration_provenance IS NOT NULL),
  CHECK(kind = 'agent' OR deactivated_at_ms IS NULL),
  CHECK(kind = 'agent' OR owner_user_id IS NULL),
  CHECK(owner_user_id IS NULL OR owner_user_id <> id),

  CHECK(kind = 'human' OR guest_state = 'never'),
  CHECK((guest_state = 'active') = (guest_expires_at_ms IS NOT NULL)),
  CHECK((guest_state = 'claimed') = (guest_claimed_at_ms IS NOT NULL)),
  CHECK(guest_claimed_at_ms IS NULL
    OR guest_claimed_at_ms >= created_at_ms),

  FOREIGN KEY(owner_user_id)
    REFERENCES "_auth_users"(id) ON DELETE SET NULL
);
```

The only floor guest-state transitions are:

```text
never   — ordinary non-guest principal
active  — unclaimed guest
claimed — guest claimed without changing id
reaped  — guest lifecycle terminal
```

`active → claimed` and `active → reaped` are allowed.

No transition returns a principal to `active`.

### 3.5 Identity-link relation

```sql
CREATE TABLE "_auth_identities" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,

  kind TEXT NOT NULL
    CHECK(kind IN ('email', 'phone', 'oidc', 'oauth2',
                   'username', 'external')),

  provider TEXT NOT NULL CHECK(length(provider) > 0),
  issuer TEXT,
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  canonical_value TEXT,

  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),

  verified_at_ms INTEGER NOT NULL
    CHECK(verified_at_ms BETWEEN 0 AND 9007199254740991),

  disabled_at_ms INTEGER
    CHECK(disabled_at_ms IS NULL
      OR disabled_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(created_at_ms <= verified_at_ms),
  CHECK(kind = 'oidc' OR issuer IS NULL),
  CHECK(kind <> 'oidc' OR issuer IS NOT NULL),

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX "_auth_identities_provider_subject_uq"
  ON "_auth_identities"(provider, subject);

CREATE UNIQUE INDEX "_auth_identities_id_user_uq"
  ON "_auth_identities"(id, user_id);

CREATE INDEX "_auth_identities_user"
  ON "_auth_identities"(user_id, id);
```

`provider` is the immutable provider-installation name.

For OIDC, `subject` is the exact provider `sub`, and `issuer` is the exact
canonical issuer.

For email-code, `subject` and `canonical_value` are the `email-v1` canonical
address.

For local password, the username identity uses the immutable local-password
provider installation and `username-v1` canonical subject.

Cross-provider email equality never auto-links identities.

### 3.6 Credential relation

```sql
CREATE TABLE "_auth_credentials" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,

  kind TEXT NOT NULL
    CHECK(kind IN ('password', 'passkey', 'recovery-code-set')),

  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),

  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),

  last_used_at_ms INTEGER
    CHECK(last_used_at_ms IS NULL
      OR last_used_at_ms BETWEEN 0 AND 9007199254740991),

  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(last_used_at_ms IS NULL OR created_at_ms <= last_used_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX "_auth_credentials_id_user_uq"
  ON "_auth_credentials"(id, user_id);

CREATE INDEX "_auth_credentials_user_live"
  ON "_auth_credentials"(user_id, kind, id)
  WHERE revoked_at_ms IS NULL;
```

Typed material lives in separate relations.

The base relation does not contain a generic JSON or BLOB material field.

### 3.7 Password material

```sql
CREATE TABLE "_auth_password_credentials" (
  credential_id TEXT NOT NULL PRIMARY KEY,

  algorithm TEXT NOT NULL CHECK(algorithm = 'argon2id'),
  hash_phc TEXT NOT NULL CHECK(length(hash_phc) > 0),
  policy_version INTEGER NOT NULL CHECK(policy_version >= 1),
  common_password_list_version INTEGER NOT NULL
    CHECK(common_password_list_version >= 1),

  changed_at_ms INTEGER NOT NULL
    CHECK(changed_at_ms BETWEEN 0 AND 9007199254740991),

  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
);
```

The application invariant requires the referenced base credential to have
`kind = 'password'`.

At most one live password credential exists per principal:

```sql
CREATE UNIQUE INDEX "_auth_password_one_live_per_user"
  ON "_auth_credentials"(user_id)
  WHERE kind = 'password' AND revoked_at_ms IS NULL;
```

The PHC string is secret-bearing credential state.

It never enters app exports, client types, claims, diagnostics, journals, or
receipts.

### 3.8 Passkey material slots

Catalog v3 reserves the structurally separate passkey material relation:

```sql
CREATE TABLE "_auth_passkey_credentials" (
  credential_id TEXT NOT NULL PRIMARY KEY,

  webauthn_credential_id BLOB NOT NULL
    CHECK(length(webauthn_credential_id) > 0),

  public_key_cose BLOB NOT NULL
    CHECK(length(public_key_cose) > 0),

  sign_count INTEGER NOT NULL CHECK(sign_count >= 0),
  rp_id TEXT NOT NULL CHECK(length(rp_id) > 0),
  user_handle BLOB NOT NULL CHECK(length(user_handle) > 0),
  transports TEXT NOT NULL,

  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX "_auth_passkey_credential_id_uq"
  ON "_auth_passkey_credentials"(webauthn_credential_id);
```

This slot does not implement or promote passkeys.

LLP 0151 retains passkey ceremony, RP-id, and preview-status authority.

### 3.9 Recovery-code state

A recovery-code set is one credential:

```sql
CREATE TABLE "_auth_recovery_code_sets" (
  credential_id TEXT NOT NULL PRIMARY KEY,

  set_generation INTEGER NOT NULL CHECK(set_generation >= 1),

  reason TEXT NOT NULL
    CHECK(reason IN ('initial', 'after-use', 'suspected-disclosure',
                     'operator-recovery')),

  issued_at_ms INTEGER NOT NULL
    CHECK(issued_at_ms BETWEEN 0 AND 9007199254740991),

  replaced_at_ms INTEGER
    CHECK(replaced_at_ms IS NULL
      OR replaced_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(replaced_at_ms IS NULL OR issued_at_ms <= replaced_at_ms),

  FOREIGN KEY(credential_id)
    REFERENCES "_auth_credentials"(id) ON DELETE CASCADE
);
```

Individual recovery codes are digest-only:

```sql
CREATE TABLE "_auth_recovery_codes" (
  set_credential_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),

  code_digest BLOB NOT NULL CHECK(length(code_digest) = 32),
  key_id TEXT NOT NULL CHECK(length(key_id) > 0),

  consumed_at_ms INTEGER
    CHECK(consumed_at_ms IS NULL
      OR consumed_at_ms BETWEEN 0 AND 9007199254740991),

  PRIMARY KEY(set_credential_id, ordinal),

  FOREIGN KEY(set_credential_id)
    REFERENCES "_auth_recovery_code_sets"(credential_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX "_auth_recovery_codes_digest_uq"
  ON "_auth_recovery_codes"(code_digest);
```

The keyed digest uses a distinct, versioned domain from email codes.

Recovery-code plaintext never enters SQLite.

### 3.10 Assurance relation

```sql
CREATE TABLE "_auth_assurances" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,

  session_id TEXT,
  identity_id TEXT,
  credential_id TEXT,

  kind TEXT NOT NULL
    CHECK(kind IN ('authenticated', 'email_verified', 'phone_verified',
                   'recent_auth', 'phishing_resistant')),

  provenance TEXT NOT NULL
    CHECK(provenance IN ('session', 'credential', 'delivery',
                         'federation', 'import', 'rehearsal')),

  issued_at_ms INTEGER NOT NULL
    CHECK(issued_at_ms BETWEEN 0 AND 9007199254740991),

  expires_at_ms INTEGER
    CHECK(expires_at_ms IS NULL
      OR expires_at_ms BETWEEN 0 AND 9007199254740991),

  governing_authority TEXT,

  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(expires_at_ms IS NULL OR issued_at_ms <= expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR issued_at_ms <= revoked_at_ms),

  CHECK(provenance NOT IN ('delivery', 'federation', 'import', 'rehearsal')
    OR governing_authority IS NOT NULL),

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,

  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE,

  FOREIGN KEY(credential_id, user_id)
    REFERENCES "_auth_credentials"(id, user_id) ON DELETE CASCADE,

  FOREIGN KEY(session_id)
    REFERENCES "_auth_sessions"(id) ON DELETE CASCADE
);

CREATE INDEX "_auth_assurances_user_kind"
  ON "_auth_assurances"(user_id, kind, issued_at_ms, id);

CREATE INDEX "_auth_assurances_session"
  ON "_auth_assurances"(session_id, kind, id);
```

The handler-visible assurance record is a projection of this relation, not the
row itself.

### 3.11 Session origin generalization

Catalog v3 generalizes only the authentication-origin foreign keys of
`_auth_sessions`.

It does not change session-token-family semantics.

```sql
CREATE TABLE "_auth_sessions" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,

  identity_id TEXT,
  credential_id TEXT,

  authn_source TEXT NOT NULL
    CHECK(authn_source IN ('guest', 'identity', 'credential')),

  authority_instance_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),

  created_at_ms INTEGER NOT NULL
    CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),

  last_used_at_ms INTEGER NOT NULL
    CHECK(last_used_at_ms BETWEEN 0 AND 9007199254740991),

  expires_at_ms INTEGER NOT NULL
    CHECK(expires_at_ms BETWEEN 0 AND 9007199254740991),

  absolute_expires_at_ms INTEGER NOT NULL
    CHECK(absolute_expires_at_ms BETWEEN 0 AND 9007199254740991),

  revoked_at_ms INTEGER
    CHECK(revoked_at_ms IS NULL
      OR revoked_at_ms BETWEEN 0 AND 9007199254740991),

  CHECK(created_at_ms <= last_used_at_ms),
  CHECK(last_used_at_ms <= expires_at_ms),
  CHECK(expires_at_ms <= absolute_expires_at_ms),
  CHECK(revoked_at_ms IS NULL OR created_at_ms <= revoked_at_ms),

  CHECK(
    (authn_source = 'guest'
      AND identity_id IS NULL AND credential_id IS NULL)
    OR
    (authn_source = 'identity'
      AND identity_id IS NOT NULL AND credential_id IS NULL)
    OR
    (authn_source = 'credential'
      AND identity_id IS NULL AND credential_id IS NOT NULL)
  ),

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,

  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE,

  FOREIGN KEY(credential_id, user_id)
    REFERENCES "_auth_credentials"(id, user_id) ON DELETE CASCADE
);
```

The existing session indexes, `_auth_session_tokens`, bearer spelling,
cross-table digest uniqueness, session cap, rotation, grace, family alarm,
sliding use, bulk revocation, and credential response remain exactly those of
LLP 0057.

A guest session uses `provider: 'guest'` in the public session projection.

A password session uses `provider: 'password'`.

A recovery-code session uses `provider: 'recovery-code'`.

Those provider labels do not become identity or assurance kinds.

### 3.12 Provisioning receipts

```sql
CREATE TABLE "_auth_provisioning_receipts" (
  provisioning_key TEXT NOT NULL PRIMARY KEY,
  hook_id TEXT NOT NULL,
  hook_digest BLOB NOT NULL CHECK(length(hook_digest) = 32),

  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  assurance_id TEXT NOT NULL,

  committed_at_ms INTEGER NOT NULL
    CHECK(committed_at_ms BETWEEN 0 AND 9007199254740991),

  app_commit_version INTEGER NOT NULL CHECK(app_commit_version >= 0),

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE CASCADE,

  FOREIGN KEY(identity_id)
    REFERENCES "_auth_identities"(id) ON DELETE CASCADE,

  FOREIGN KEY(assurance_id)
    REFERENCES "_auth_assurances"(id) ON DELETE CASCADE
);
```

The receipt records no app row contents and no identity secret.

### 3.13 Security journal

Catalog v3 adds a protected security journal floor:

```sql
CREATE TABLE "_auth_security_events" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL CHECK(length(kind) > 0),
  cause_class TEXT NOT NULL CHECK(length(cause_class) > 0),

  identity_id TEXT,
  credential_id TEXT,
  session_id TEXT,

  occurred_at_ms INTEGER NOT NULL
    CHECK(occurred_at_ms BETWEEN 0 AND 9007199254740991),

  correlation_id TEXT NOT NULL CHECK(length(correlation_id) > 0),
  redacted_metadata TEXT NOT NULL,

  FOREIGN KEY(user_id)
    REFERENCES "_auth_users"(id) ON DELETE SET NULL
);
```

Journal metadata is closed per event kind.

It never includes:

- passwords;
- password hashes;
- recovery-code plaintext or digests;
- session bearers or token hashes;
- verification codes or digests;
- provider tokens;
- secret values; or
- rehearsal capability material.

A required journal insert is part of the transition transaction. Failure aborts
the transition.

### 3.14 Carried v2 objects

Catalog v3 carries the remaining v2 objects and invariants unless this section
explicitly replaces them:

- `_auth_session_tokens`;
- `_auth_verification_codes`;
- `_auth_agent_credentials`;
- `_auth_grants`;
- `_auth_grant_tokens`;
- `_auth_agent_invitations`;
- `_auth_pairing_requests`;
- `_auth_scope_bases`; and
- their exact v2 indexes and checks.

LLP 0055 remains authoritative for all agent relations and transitions.

This Spec does not reinterpret an LLP 0055 credential as an
`_auth_credentials` row.

### 3.15 Activation, reset, backup, and export

Creation of all v3 objects and marker `3` is one transaction.

A rollback leaves no marker and no partial catalog.

`app.reset` removes v3 rows in foreign-key-safe order in the same reset
transaction, including:

- security events;
- provisioning receipts;
- assurances;
- recovery codes and sets;
- typed credential material;
- credentials;
- sessions and token tombstones;
- identities;
- principals; and
- all LLP 0055 authority rows.

Reset preserves catalog DDL, the marker, and provider keyrings.

Physical backup and declared restore continue to follow LLP 0057 and later
physical-store authorities. Declared restore revokes restored sessions and
other live authority before service.

Logical export never includes:

- sessions;
- token hashes or tombstones;
- challenge state;
- password hashes unless an explicitly authorized migration format names them;
- recovery-code state;
- provisioning internal receipts;
- keyrings; or
- security-journal secret material.

Import never silently activates a session.

## 4. Assurance model

### 4.1 Exact record

The public assurance record is:

```ts
type AssuranceRecord = Readonly<{
  kind:
    | 'authenticated'
    | 'email_verified'
    | 'phone_verified'
    | 'recent_auth'
    | 'phishing_resistant'

  provenance:
    | 'session'
    | 'credential'
    | 'delivery'
    | 'federation'
    | 'import'
    | 'rehearsal'

  issuedAt: number
  expiresAt?: number
  governingAuthority?: string
}>;
```

`kind` says what is assured.

`provenance` says how it was assured.

They MUST NOT be combined into strings such as:

```text
rehearsal_email_verified
imported_email_verified
password_recent_auth
```

Such strings are invalid kinds.

### 4.2 Scope

An assurance is bound to one principal.

It may additionally be bound to:

- an identity;
- a credential;
- a session; or
- a governing authority.

A session-bound assurance is inadmissible after the session ends, even if its
own timestamp has not elapsed.

A credential-bound assurance is inadmissible after credential revocation or
generation replacement.

An identity-bound assurance is inadmissible after identity disablement.

A governing authority may impose a stricter lifetime than `expiresAt`.

The effective expiry is the earliest applicable expiry or termination.

### 4.3 Provenance-independent checks

Every assurance, regardless of provenance, is admissible only when:

- its principal matches the effective principal;
- its kind is recognized;
- its issuance timestamp is valid;
- `now < expiresAt` when expiry exists;
- it is not revoked;
- every referenced identity, credential, or session remains valid; and
- its governing authority, when present, validates for the assurance.

Invalid or corrupt rows fail closed and emit an operator diagnostic.

They are never skipped as if they were absent without recording the corruption.

### 4.4 Session provenance

`provenance: 'session'` is valid only for `kind: 'authenticated'`.

It is bound to the exact live session.

Guest session creation uses this provenance.

It is posture-independent.

A copied or restored session remains subject to LLP 0057 declared-restore
revocation.

### 4.5 Credential provenance

`provenance: 'credential'` is posture-independent.

It may produce:

- `authenticated`;
- `recent_auth`; and
- `phishing_resistant`, only for a credential class whose accepted
  authenticator contract provides phishing resistance.

Password authentication produces `authenticated` and `recent_auth`.

Password authentication never produces `phishing_resistant`.

Recovery-code authentication produces `authenticated` and `recent_auth`.

Passkey production of `phishing_resistant` remains gated by LLP 0151's
ceremony and RP-id requirements.

### 4.6 Delivery provenance

`provenance: 'delivery'` is posture-independent.

It is admissible in production.

It requires:

- a declared delivery adapter classified `contact-ownership`;
- successful challenge issuance;
- successful delivery handoff under that adapter;
- single-use challenge proof;
- canonical identity matching;
- one committed consume/link/assurance transaction; and
- a governing authority naming the provider installation and adapter
  activation.

A capture or simulator adapter classified `simulation` MUST NOT produce
`delivery` provenance.

Simulation produces `rehearsal` provenance or no verification assurance.

A real email challenge may produce `email_verified`.

A real phone challenge may produce `phone_verified`.

The delivery adapter does not determine the assurance kind by itself; the
verified identity transition does.

### 4.7 Federation provenance

`provenance: 'federation'` is posture-independent.

It requires the provider-specific protocol to prove:

- exact issuer;
- exact audience/client registration;
- exact subject;
- signature and token validity;
- nonce/state/replay closure;
- immutable provider installation; and
- authoritative status of any contact-verification claim mapped into an
  assurance.

A provider's plain email string does not imply `email_verified`.

The provider installation must explicitly declare that its verified-email
claim is authoritative before it can mint that kind.

### 4.8 Import provenance

`provenance: 'import'` is posture-independent and is admissible in production.

That production admissibility is deliberate.

An import assurance is valid only when all of these hold:

1. The import uses a versioned, declared source adapter.
2. The operator-authorized import validates its complete source envelope.
3. Dry-run canonicalization and collision analysis complete first.
4. The source adapter has an explicit mapping for the assurance kind.
5. The source record explicitly marks the identity verified.
6. The imported canonical identity matches the source evidence.
7. The target principal and identity link commit atomically.
8. The import receipt is immutable and integrity-bound to source identity,
   adapter version, target app, target principal, and imported assurance.
9. `governingAuthority` names that import receipt.
10. No source session, refresh token, challenge, provider token, or live
    authority is imported.

Import may mint only durable identity assurances whose source contract can
prove them.

Import MUST NOT mint:

- `authenticated`;
- `recent_auth`; or
- `phishing_resistant`.

When a source supplies a trustworthy verification timestamp, that timestamp
is `issuedAt`.

When a source supplies only a verified boolean, the import snapshot timestamp
is `issuedAt`, and the receipt records that the time means
`source-state-observed`, not original verification time.

An unverified or unsupported source identity is omitted or refused according
to the import plan. It is never upgraded by inference.

Import collisions are typed and create no partial principal, identity,
assurance, hook output, or session.

### 4.9 Rehearsal provenance

`provenance: 'rehearsal'` is admissible only on non-production deployment
profiles.

Production admission rejects it unconditionally.

The record's `governingAuthority` names the exact rehearsal minting authority.

When a rehearsal window mediated the mint, it names the window, not merely the
parent grant.

Expiry or revocation of that window makes the assurance inadmissible even
while a parent grant remains live.

A rehearsal assurance never invents a new kind.

For example, simulated email verification is:

```ts
{
  kind: 'email_verified',
  provenance: 'rehearsal',
  issuedAt,
  expiresAt,
  governingAuthority: windowId,
}
```

It is not `kind: 'simulated_email'`.

Rehearsal provenance, store taint, deferred-intent propagation, and the egress
gate remain owned by LLP 0212's commissioned rehearsal and LLP 0058-lineage
work.

If those integrations are unavailable, a rehearsal assurance is inadmissible.

### 4.10 Requirement evaluation

The shared invocation gate evaluates `requires` after resolving authority and
before application code executes.

Evaluation:

1. resolves the function's normalized requirement set;
2. obtains assurances for the effective principal;
3. applies session, credential, identity, expiry, revocation, governing
   authority, and posture checks;
4. evaluates every required kind or alias; and
5. either produces a sealed admitted set or refuses the handler invocation.

The handler cannot catch or override the refusal because it has not started.

Requirement evaluation does not replace:

- function `auth`;
- LLP 0055 scoped-grant checks;
- membership checks;
- row visibility;
- permission-backing enforcement; or
- egress policy.

Those gates are conjunctive.

A durable identity assurance may apply to a delegated effective principal, but
it does not widen the actor's LLP 0055 grant.

A session-bound `recent_auth` cannot be borrowed by a service-principal
invocation that has no qualifying human session.

Public refusal identifies required kinds but does not enumerate which
identities, credentials, or provenances the caller has.

## 5. Verified provisioning hook

### 5.1 Purpose

The verified-provisioning hook is the paved identity-binding path.

It closes the current guide gap in which ordinary handlers know only the
principal while a trusted external broker knows the verified identity.

After a successful verified-identity transition, the host invokes the hook
with both facts before releasing the resulting authority.

The hook may idempotently create:

- an app profile;
- a principal-to-app-identity binding;
- an initial membership; or
- other explicitly declared app rows.

### 5.2 Exact input

```ts
type VerifiedIdentityResult = Readonly<{
  eventId: string
  operation: 'verify' | 'claim' | 'import'

  identity: Readonly<{
    id: string
    kind: 'email' | 'phone' | 'oidc' | 'oauth2'
          | 'username' | 'external'
    providerKey: string
    issuer?: string
    subject: string
    canonicalValue?: string
  }>

  assurances: readonly AssuranceRecord[]
  provisioningKey: string
}>;

type ResolvedProvisioningPrincipal = Readonly<{
  userId: string
  kind: 'human' | 'agent'
  guestState: 'never' | 'active' | 'claimed' | 'reaped'
  sessionId: string | null
}>;

type VerifiedProvisioningInput = Readonly<{
  verifiedIdentity: VerifiedIdentityResult
  principal: ResolvedProvisioningPrincipal
}>;
```

Every field is server-derived.

No public or operator request accepts this DTO.

The identity id, principal id, assurances, operation, event id, and
provisioning key are taken from the same prepared transition.

### 5.3 Sealed invocation authority

The hook is:

- host-invoked;
- transactional;
- idempotent;
- absent from public route registries;
- absent from app function allowlists;
- absent from CLI/MCP ordinary function invocation;
- unavailable to nested application calls;
- not satisfiable by a session bearer alone;
- not satisfiable by AdminWrite alone;
- not satisfiable by an LLP 0055 scoped grant; and
- not callable by naming its handler id.

The prepared authority class is `VerifiedProvisioning`.

It carries:

- the resolved principal;
- the verified identity result;
- the admitted assurance set;
- the normalized hook declaration;
- the exact app bundle digest; and
- rehearsal provenance when applicable.

It does not grant arbitrary `System`, admin, or impersonation authority.

### 5.4 Hook context

The handler receives:

- read-only `ctx.auth` for the resolved principal;
- read-only `ctx.provisioning` containing the exact input;
- transactional `ctx.db` limited to declared reads and writes;
- deterministic `ctx.runtime.now()` and `ctx.runtime.id()`; and
- no action, fetch, secret, job, cron, arbitrary function-call, or external
  egress surface.

The hook may use pure helpers compiled into the same bundle.

It may not enqueue arbitrary deferred work.

Lifecycle notification intents are emitted by the host after validating the
hook result, under §7's rules.

### 5.5 Allowed write set

Every hook write declaration has one of three modes:

```ts
type ProvisioningWrite =
  | {
      table: string
      mode: 'ordinary'
    }
  | {
      table: string
      mode: 'identity-binding'
      principalField: string
      identityField: string
    }
  | {
      table: string
      mode: 'permission-backing'
      principalField: string
    };
```

`ordinary` permits writes only to the named table.

`identity-binding` additionally requires:

- a unique index on the principal field;
- a unique index on the bound identity field or provider/subject tuple;
- host injection of the resolved principal field;
- host injection of the verified canonical identity value;
- refusal of an existing incompatible binding; and
- write sealing against ordinary client-invoked functions.

`permission-backing` additionally requires:

- the table to be declared `permissionBacking`;
- host injection of the resolved principal field;
- insert or idempotent upsert only for that principal;
- no authority grant to a caller-selected different principal;
- no owner transfer;
- no raw delete or revocation;
- an admitted assurance set satisfying the hook's `requires`; and
- LLP 0053 authorization-version advancement in the same transaction.

A hook attempting an undeclared table, mode, field, or operation is terminated
by the host.

Catching an application exception cannot unbrand or bypass the termination.

### 5.6 Permission-backing provenance

Every permission-backing hook write records a sealed provenance fact:

```ts
type ProvisioningAuthorityProvenance = Readonly<{
  source: 'verified-provisioning'
  hookId: string
  provisioningKey: string
  principalId: string
  identityId: string
  assuranceIds: readonly string[]
  assuranceKinds: readonly string[]
  assuranceProvenances: readonly string[]
  eventId: string
}>;
```

This fact is stored in the protected commit/audit record, not trusted from an
app row.

The hook is admitted from assurance requirements, not from handler branching
on provenance.

`delivery`, `federation`, and valid `import` provenance are admissible in every
deployment posture.

`rehearsal` is admissible only outside production and carries rehearsal taint
and propagation.

Unknown or inadmissible provenance refuses before any app write.

The provenance fact does not itself grant authority. It explains the proof
that permitted the provisioning transition.

This Spec does not automatically revoke app membership when a durable identity
assurance later changes. That is a general lifecycle policy and must be
declared by the future lifecycle Spec. The original provisioning write remains
auditable.

### 5.7 Idempotency

`provisioningKey` is stable for the tuple:

```text
hook declaration id
+ principal id
+ identity id
+ verified transition class
+ governing assurance event
```

A successful hook commit inserts `_auth_provisioning_receipts` in the same
transaction.

Retry with the same key and same hook digest returns the prior redacted receipt
without rerunning the handler.

Retry with the same key and a different hook digest refuses with
`SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH`.

The receipt does not cache or re-expose app rows, tokens, or secrets.

Application rows must also carry structural uniqueness appropriate to their
binding. Host idempotency does not replace database uniqueness.

### 5.8 Failure atomicity

The following commit together:

- principal transition;
- identity-link insert or update;
- assurance insert;
- provisioning-hook app writes;
- permission-backing authorization-version advancement;
- security-journal event;
- configured notification intent;
- provisioning receipt; and
- session consequences of the identity transition.

Any failure rolls back all of them.

There is no state in which:

- an identity is attached but the required binding is absent;
- a membership exists without its assurance provenance;
- a claim clears guest state without rotating sessions;
- the hook receipt exists without app writes; or
- the challenge is consumed while the transition is otherwise absent.

Expensive provider verification or password hashing may occur before the
transaction. The transaction rechecks the exact proof generation and state
before committing.

### 5.9 Relationship to the guide binding gap

The generated guide MUST teach:

```text
verified identity
  → host transition
  → sealed provisioning hook
  → binding/profile/membership
  → session release
```

It MUST NOT teach:

```text
client claim
  → ordinary mutation
  → caller-selected app user id
```

A declared identity-binding table is write-sealed to the provisioning hook and
authorized migration tooling.

An ordinary handler attempting to write it receives
`SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`, even when `ctx.auth.claims` contains a
verified identity.

Undeclared ad hoc app tables receive no platform binding guarantee.

## 6. Read-only `ctx.auth` claims

### 6.1 Projection shape

The handler auth projection gains one optional field:

```ts
type AuthClaimsProjection = Readonly<{
  identities: readonly Readonly<{
    kind: 'email' | 'phone' | 'oidc' | 'oauth2'
        | 'username' | 'external'
    providerKey: string
    issuer?: string
    subject: string
    value?: string
  }>[]

  assurances: readonly AssuranceRecord[]
}>;

type HandlerAuthProjectionV3 = HandlerAuthProjection & Readonly<{
  claims?: AuthClaimsProjection
}>;
```

The preexisting keys and LLP 0055 actor block retain their meanings.

`value` is the canonical email, phone, or username when that identity class has
one.

Internal identity ids, credential ids, assurance ids, password state, recovery
state, raw provider tokens, session generation, and governing bearer material
are omitted.

### 6.2 Projection rules

A real v3 session projects `claims`.

A guest session projects:

```ts
{
  identities: [],
  assurances: [{
    kind: 'authenticated',
    provenance: 'session',
    issuedAt,
    expiresAt,
  }],
}
```

An email-code session projects its verified email identity and the applicable
assurances.

A password session projects its local username identity and credential-derived
assurances.

Anonymous, AdminBypass, and System authority omit `claims`.

Dev impersonation omits claims unless a separately admitted rehearsal flow
created a real session. Dev impersonation does not synthesize verification.

LLP 0055 agent projections remain unchanged unless a future 0055 amendment
explicitly adopts claims.

Identities and assurances are sorted deterministically.

The projection, arrays, records, and nested objects are null-prototype,
own-property-only, and deeply frozen under LLP 0058's existing projection
discipline.

### 6.3 Server derivation

The authoritative server constructs claims from the resolved v3 catalog and
prepared authority.

No request body, header, client object, optimistic mutation argument, or
provider payload reaches `ctx.auth.claims` without server verification and
catalog resolution.

A client may cache a server-issued claims projection for UI and optimistic
rendering, but that cache grants no server authority.

An assurance-required optimistic mutation whose sealed projection is absent or
stale must defer authoritative success. It cannot assume the requirement.

The server replay evaluates requirements again from current authoritative
state.

### 6.4 Preserved provenance

Every assurance preserves its exact provenance.

Rehearsal assurance is visibly rehearsal provenance outside production.

Import assurance remains visibly import provenance in production.

The projection never rewrites either to `delivery`.

`governingAuthority`, when projected, is an opaque nonsecret identifier. It is
not a capability and is not accepted as one.

### 6.5 Not a binding mechanism

Claims are read-only evidence for application behavior and display.

They are not accepted by:

- identity-link APIs;
- binding-table writers;
- membership authority APIs;
- credential registration;
- account merge;
- guest claim;
- provider linking; or
- host operations.

A client cannot send a claims object back as proof.

The generated teaching rule is:

> Declare assurance requirements; do not branch on provenance to recreate the
> host's admissibility policy.

Application code may display provenance for diagnostics or explainability.

Generated authorization examples MUST use `requires`, not:

```ts
if (ctx.auth.claims.assurances.some(
  (a) => a.provenance === 'delivery'
)) {
  // authorize
}
```

### 6.6 Claims cannot authorize binding

Even a correctly server-derived email claim does not open a binding writer.

The following remains forbidden:

```ts
export const bindMe = defineJsMutation({
  auth: 'authenticated',
  args: { appUserId: v.id('user') },
  writes: ['identityBinding'],
  handler: async (ctx, args) => {
    // Forbidden: caller chose appUserId.
  },
});
```

The supported operation is the sealed provisioning hook, where the host owns
both the identity and principal inputs.

## 7. Common floor-transition rules

This section and §8 are the single source for the wave-1c transition floor.

### 7.1 Closed DTOs

All floor request DTOs:

- are camelCase;
- use `deny_unknown_fields`;
- reject duplicate keys;
- have generated committed schemas;
- are size-bounded;
- reject credentials in query parameters;
- accept credentials only over loopback or TLS where applicable; and
- classify password and recovery-code bodies as request secrets.

All credential-bearing responses are `Cache-Control: no-store`.

They never enter receipts, logs, traces, runtime snapshots, or default
machine-readable output.

### 7.2 Canonical username

`username-v1` canonicalization is ordered:

1. decode the JSON string as Unicode;
2. reject NUL and Unicode control characters;
3. trim Unicode `White_Space` at both ends;
4. normalize to NFC;
5. apply locale-independent Unicode lowercase;
6. reject remaining Unicode whitespace or controls;
7. require a nonempty result; and
8. enforce the declared UTF-8 byte bounds.

No provider-specific rewrite, confusable folding, punctuation removal, or
invisible future normalization occurs.

Changing username canonicalization requires a versioned identity migration.

Passwords are not trimmed, lowercased, or Unicode-normalized.

The exact decoded password string is converted to UTF-8 and evaluated under
the password policy.

### 7.3 Password processing outside the storage lock

Password creation and change perform:

- length validation;
- compromised/common-password screening; and
- Argon2id hashing

outside the SQLite writer transaction.

Password authentication:

1. reads the canonical identity, credential id, credential generation, and PHC
   hash through a bounded snapshot;
2. performs Argon2id verification outside the writer lock;
3. opens the transition transaction;
4. rechecks identity mapping, credential generation, credential liveness, and
   principal state; and
5. commits only if the snapshot still matches.

Unknown identities run the budgeted dummy-Argon2 path using the active policy
parameters.

No unknown-user fast path skips the expensive proof class.

### 7.4 Public non-enumeration

Password authentication maps all of these to one public result:

- unknown username;
- wrong password;
- disabled identity;
- revoked password credential;
- deactivated principal; and
- stale credential snapshot.

The result is `SNAPBACK_AUTH_CREDENTIAL_INVALID`.

Recovery authentication similarly folds:

- unknown username;
- absent recovery set;
- wrong code;
- consumed code;
- replaced set; and
- revoked set

into `SNAPBACK_AUTH_RECOVERY_CODE_INVALID`.

Public bodies, statuses, headers, and retry behavior are identical within each
class.

Operator explanation may reveal the gated cause through an opaque correlation
id.

### 7.5 Notification floor

Every successful authority or credential transition writes a protected
security-journal event in the same transaction.

Security-relevant public refusals write a redacted, budget-bounded journal
event according to the effect-budgets policy.

When an LLP 0045 outbox is configured and a reachable verified identifier
exists, the same transition transaction enqueues the required lifecycle
notification intent.

The intent contains:

- template id;
- recipient identity reference;
- event class;
- idempotency key;
- redacted transition metadata; and
- no credential plaintext.

Provider delivery occurs later and cannot roll back the auth transition after
the durable intent commits.

When no outbox or reachable identifier exists, the journal remains the
mandatory floor and records `notificationChannel: unavailable`.

Absence of delivery does not silently suppress a required journal event.

### 7.6 Session rules

All session creation, cap, token hashing, expiry, rotation, family alarm,
sliding use, revocation, and bulk-revocation mechanics use LLP 0057 unchanged.

“Rotate the acting session” means:

- replace its bearer through the existing token-family rotation operation;
- retain its session id and authority instance where LLP 0057 does;
- project the new authority before further app work; and
- reject use of the superseded bearer under LLP 0057's grace rules.

“Revoke other sessions” means the affected sessions receive durable
revocation/generation transitions and LLP 0059 projection termination.

A principal-preserving transition is not a user switch.

Guest claim and password/recovery transitions therefore do not trigger the
full client-store wipe solely because the principal id is unchanged.

They do trigger authorization re-evaluation where specified.

### 7.7 Last-authenticator rule

A usable authenticator is one of:

- a live password credential;
- a live passkey credential whose mechanism is available;
- a live recovery-code set with at least one usable code;
- a verified email identity with an available email-code authentication path;
- a verified phone identity with an available phone authentication path; or
- another mechanism whose implementing Spec declares it independently
  recoverable.

A session is not an independently durable authenticator.

An unavailable delivery channel does not count as usable recovery.

A rehearsal-only mechanism does not count for production last-authenticator
evaluation.

No transition may revoke, consume without replacement, unlink, or disable the
last usable authenticator of a non-guest principal.

Replacement in one atomic transaction counts as continuous availability.

A guest may be reaped under guest policy; that is not an authenticator unlink.

## 8. Complete floor transition set

### 8.1 Guest principal and session creation

Public route:

```json
// POST /auth/guest
{}
```

Proof requirements:

- guest policy enabled;
- admitted `auth.guest.create` budget;
- admitted `auth.session.mint` budget;
- CSPRNG availability; and
- no caller-supplied principal or session identity.

The transaction atomically:

1. creates a human principal with `guest_state = 'active'`;
2. sets its guest expiry from the declared policy;
3. creates a guest-origin session;
4. creates a session-bound `authenticated` assurance with
   `provenance: 'session'`;
5. writes `guest.created` to the security journal; and
6. commits the session-cap result.

Session consequence:

- one new LLP 0057 session family;
- no preexisting session to rotate; and
- the returned `userId` is the durable principal id.

Notification obligation:

- journal required;
- no outbox notification because no verified delivery identity exists.

Typed refusals:

- disabled guest policy;
- budget refusal;
- catalog not v3;
- CSPRNG/provider unavailable; and
- malformed nonempty request DTO.

Failure creates no principal or session.

### 8.2 Guest claim

Floor route for the email-code proof:

```json
// POST /auth/guest/claim
{
  "challengeId": "sbc_...",
  "code": "012345"
}
```

The caller also presents the current guest session bearer.

Proof requirements:

- resolved live session;
- principal in `guest_state = 'active'`;
- challenge completed from that guest session;
- verified identity result from the provider;
- admissible assurance provenance;
- unused proof; and
- hook requirements satisfied.

The transaction atomically:

1. rechecks guest state and challenge;
2. consumes the proof;
3. creates or selects the verified identity link;
4. creates the applicable assurance;
5. runs verified provisioning;
6. changes `guest_state` from `active` to `claimed`;
7. sets `guest_claimed_at_ms`;
8. rotates the claiming session;
9. revokes every other guest-era session for that principal;
10. advances the LLP 0053 authorization version as a permission-backing event;
11. writes the claim journal events;
12. enqueues configured lifecycle notification; and
13. commits without changing `userId`.

The client does not wipe its store solely because of claim.

It clears/quarantines affected auth-scoped results and reauthorizes under LLP
0053/0059 before claimed authority becomes visible.

If the identity already maps to a different principal:

- return `SNAPBACK_AUTH_GUEST_CLAIM_COLLISION`;
- do not auto-link;
- do not merge;
- do not switch principals;
- do not consume the successful proof irreversibly;
- do not run the hook;
- leave the guest principal and sessions unchanged except permitted budget and
  redacted journal accounting.

The `switch_existing` and `merge` continuations remain delegated to the
general lifecycle Spec commissioned by LLP 0151.

If two claims race for one guest, at most one commits.

A loser observes either:

- already claimed;
- proof replay;
- identity collision; or
- stale transition generation.

It never creates a second link or partially rotates sessions.

### 8.3 Password account creation

Public route:

```json
// POST /auth/password/register
{
  "username": "person",
  "password": "request-secret"
}
```

Proof requirements:

- password mechanism enabled;
- admitted account-create, enumeration, hash-CPU, and session-mint budgets;
- valid canonical username;
- password policy satisfied;
- common/compromised-password screening passed; and
- Argon2id hash completed outside the writer lock.

The transaction atomically:

1. rechecks username uniqueness;
2. creates a non-guest human principal;
3. creates the local username identity;
4. creates the password credential and password-material row;
5. creates an initial recovery-code-set credential and digest rows;
6. creates a password-origin session;
7. creates `authenticated` and `recent_auth` credential assurances;
8. runs verified provisioning only if its declared requirements are satisfied
   by this local identity event;
9. writes `password.account-created` and `recovery-codes.issued`;
10. records outbox unavailability for username-only accounts; and
11. commits.

The response wraps the unchanged LLP 0057 credential response and a one-time
recovery-code payload:

```json
{
  "credential": {
    "tokenType": "Bearer",
    "token": "sbs_...",
    "refreshAfter": 0,
    "session": {},
    "authorityDescriptor": {}
  },
  "recoveryCodes": ["...", "..."]
}
```

The recovery-code array is present exactly once after successful commit.

Username collision returns `SNAPBACK_AUTH_IDENTITY_UNAVAILABLE`.

Password-policy failures return `SNAPBACK_AUTH_PASSWORD_POLICY`.

No failure reveals password screening internals beyond repair-safe policy
classes.

A lost successful response does not roll back the account. The password remains
usable; the caller authenticates and rotates recovery codes.

### 8.4 Password authentication

Public route:

```json
// POST /auth/password/authenticate
{
  "username": "person",
  "password": "request-secret"
}
```

Proof requirements:

- password mechanism enabled;
- admitted guessing, enumeration, hash-CPU, and session-mint budgets;
- valid canonical username shape;
- Argon2id verification or the dummy-hash path; and
- unchanged identity, credential generation, and principal state at commit.

Success atomically:

1. records password credential use;
2. optionally replaces an outdated password hash only when a new Argon2id hash
   was prepared outside the lock and the generation recheck succeeds;
3. creates a password-origin session;
4. enforces the LLP 0057 session cap;
5. creates session-bound `authenticated` and `recent_auth` assurances; and
6. writes `password.authenticated`.

Session consequence:

- a new session family;
- existing sessions remain live except LLP 0057 cap eviction; and
- cap eviction terminates only the selected oldest session.

Failure:

- returns uniform `SNAPBACK_AUTH_CREDENTIAL_INVALID`;
- creates no session or assurance;
- changes no credential state except budget and bounded redacted attempt
  journal accounting; and
- performs no outbox notification unless the configured security policy's
  budgeted suspicious-attempt threshold is crossed.

### 8.5 Password set

Authenticated route:

```json
// POST /auth/password/set
{
  "username": "person",
  "password": "request-secret"
}
```

This transition applies to a non-guest principal with no live password
credential.

Proof requirements:

- live authenticated session;
- admissible `recent_auth` from an independently usable authenticator;
- password and username policy;
- common-password screening;
- Argon2id hash outside the writer lock;
- username availability; and
- post-transition last-authenticator validity.

The transaction atomically:

1. creates the local username identity when absent;
2. creates the password credential and material;
3. rotates the acting session;
4. revokes other sessions under the credential-change policy;
5. writes `password.set`;
6. advances authorization state when provisioning writes are permission
   backing;
7. runs any newly applicable verified-provisioning event; and
8. enqueues notification to every reachable verified contact.

A guest cannot use password set to bypass guest claim.

It must first complete an allowed guest-claim transition.

### 8.6 Password change

Authenticated route:

```json
// POST /auth/password/change
{
  "currentPassword": "request-secret",
  "newPassword": "request-secret"
}
```

Proof requirements:

- live authenticated session;
- live password credential;
- proof of the current password, or a separately declared strong recent-auth
  path;
- admitted guessing and hash-CPU budgets;
- new password policy and common-password screening;
- new password differs under constant-time verifier semantics; and
- Argon2id hash prepared outside the writer lock.

The transaction atomically:

1. rechecks the old credential generation;
2. increments the credential generation;
3. replaces the password material;
4. rotates the acting session;
5. revokes all other human sessions for the principal;
6. revokes session-bound assurances attached to ended sessions;
7. creates new `authenticated` and `recent_auth` assurances for the acting
   session;
8. writes `password.changed`; and
9. enqueues lifecycle notification to every reachable verified contact.

The old password is invalid immediately after commit.

A race between two changes permits at most one generation successor.

The loser returns a stale-proof or credential-invalid result and does not
overwrite the winner.

### 8.7 Initial recovery-code issuance

Initial issuance occurs inside password account creation.

It is also available as an authenticated transition when no live set exists:

```json
// POST /auth/recovery-codes/issue
{}
```

Proof requirements:

- recovery codes enabled;
- live authenticated session;
- admissible `recent_auth`;
- no current live recovery-code set;
- CSPRNG and digest-key availability; and
- last-authenticator evaluation.

Plaintext codes are generated outside SQL and wrapped in zeroizing
secret-bearing types.

The transaction atomically:

1. creates the recovery-code-set credential;
2. inserts one digest row per code;
3. rotates the acting session;
4. revokes other sessions under recovery-configuration policy;
5. writes `recovery-codes.issued`; and
6. enqueues notification to reachable verified contacts.

The response contains plaintext codes once.

The response is no-store and excluded from every receipt/log path.

A retry after an unknown successful outcome never retrieves the committed
plaintext. The authenticated caller rotates the set instead.

### 8.8 Recovery-code consumption and after-use replacement

Public route:

```json
// POST /auth/recovery
{
  "username": "person",
  "code": "request-secret"
}
```

Proof requirements:

- admitted recovery-guess, enumeration, and session-mint budgets;
- valid username/code shapes;
- keyed-digest verification or uniform dummy path;
- live current recovery-code set; and
- exact unconsumed code at commit.

Successful recovery is one atomic replacement transition:

1. mark the presented code consumed;
2. mark the old set replaced;
3. revoke every remaining code in the old set through set replacement;
4. revoke all existing sessions for the principal;
5. generate and commit a new recovery-code set;
6. create a new recovery-origin session;
7. create `authenticated` and `recent_auth` assurances;
8. write `recovery-code.consumed`;
9. write `recovery-codes.rotated` with reason `after-use`;
10. enqueue notifications to all reachable verified contacts; and
11. return the new session credential plus the new one-time plaintext set.

The old set has no usable code after commit.

This preserves the last-authenticator invariant even when recovery codes were
the account's only independently recoverable credential.

Failure returns uniform `SNAPBACK_AUTH_RECOVERY_CODE_INVALID`.

Failure creates no session and does not consume or replace any code, apart from
effect-budget and bounded redacted attempt accounting.

Two consumers racing the same code produce at most one successful session and
one replacement set.

### 8.9 Recovery-code rotation after suspected disclosure

Authenticated route:

```json
// POST /auth/recovery-codes/rotate
{
  "reason": "suspected-disclosure"
}
```

Proof requirements:

- live authenticated session;
- admissible `recent_auth` from a non-revoked authenticator;
- active recovery-code set;
- CSPRNG and keyring availability; and
- last-authenticator evaluation.

The transaction atomically:

1. creates the complete replacement set;
2. marks the prior set replaced;
3. rotates the acting session;
4. revokes every other session;
5. writes `recovery-codes.rotated` with reason
   `suspected-disclosure`;
6. enqueues lifecycle notification; and
7. commits before returning plaintext.

No old code remains usable after commit.

A lost response is repaired by performing another authenticated rotation.
Plaintext is never re-read from storage.

### 8.10 Last-authenticator enforcement across the floor

The floor applies the last-authenticator rule at every credential or identity
state change, including transitions initiated by future admin/lifecycle code.

Required negative cases include:

- revoking the only password with no live recovery set or delivery identity;
- replacing a recovery set without committing its successor;
- disabling the only email-code identity when no credential exists;
- consuming the final recovery code without atomic replacement;
- treating an expired session as an authenticator;
- treating unavailable production delivery as recovery; and
- treating rehearsal-only assurance as production recovery.

Every case refuses with `SNAPBACK_AUTH_LAST_AUTHENTICATOR` and leaves the
predecessor state intact.

## 9. Recovery-code plaintext custody

Recovery codes are one-time response secrets.

Their plaintext:

- is generated from the OS CSPRNG;
- uses an implementation-versioned encoding;
- is placed only in zeroizing memory;
- is never written to SQLite;
- is never written to the outbox;
- is never included in the security journal;
- is never returned by inspect, list, status, backup manifests, or receipts;
- is never printed by default CLI or MCP output;
- is never included in exception text;
- is never included in model-visible explanations; and
- is erased after response publication or failure.

Explicit reveal is the initial transition response itself.

There is no later reveal operation.

The durable digest is domain-separated from:

- email verification codes;
- session tokens;
- agent credentials;
- pairing codes; and
- rehearsal capabilities.

Constant-time digest comparison is required.

Unknown, replaced, consumed, and malformed inputs use a uniform public path.

## 10. V6 no-delivery readiness

### 10.1 Derived facts

Codegen derives, at minimum:

```json
{
  "authProgramReadiness": {
    "programVersion": 1,
    "catalogRequired": 3,
    "declarationValid": true,
    "assuranceRequirementsCompiled": true,
    "verifiedProvisioningCompiled": true,
    "claimsProjectionCompiled": true,

    "requiredAssuranceProducers": {
      "email_verified": {
        "requiredBy": ["function-id"],
        "declaredDeliveryAdapters": ["transactionalEmail"],
        "importEnabled": false,
        "rehearsalAvailable": true
      }
    },

    "deliveryChannels": {
      "email": {
        "declared": true,
        "configured": false,
        "available": false,
        "assuranceClass": "contact-ownership",
        "missingSecretReferences": ["authEmailProvider"]
      }
    },

    "noDeliveryCheck": {
      "enforced": false,
      "satisfied": false
    }
  }
}
```

The concrete projection remains closed and schema-generated.

Public inspect may omit operator-sensitive config-reference names while
preserving the boolean readiness facts.

Admin inspect may name missing references but never values.

### 10.2 Producer derivation

A function transitively requiring `email_verified` creates an
`email_verified` producer requirement.

A production deployment satisfies the delivery leg only with an available
email adapter classified `contact-ownership`.

These do not satisfy the production delivery leg:

- import support;
- a capture mailbox;
- a simulator;
- rehearsal;
- a declared adapter whose secret reference is unset;
- a disabled adapter;
- an adapter unavailable on the target; or
- an adapter with unverified configuration generation.

Import assurances remain valid for imported users, but import is not a
self-serve delivery channel for new users.

### 10.3 Wave boundary

Wave 1b MUST publish the readiness facts.

During the wave-1b interim, `noDeliveryCheck.enforced` is `false`, and tooling
must describe the missing enforcement honestly.

Wave 2a changes enforcement to `true`.

No capability or publication claim may say V6 is complete while the fact
remains false.

### 10.4 Deploy/readiness refusal

At wave 2a, staging or deploying an app that requires `email_verified` to a
profile with no admissible delivery channel fails with:

```text
SNAPBACK_AUTH_DELIVERY_REQUIRED
```

The diagnostic names:

- assurance kind;
- requiring function ids;
- deployment profile;
- missing channel;
- declared adapter names;
- missing config-reference names at operator locus; and
- the generated registration/setup instruction.

It contains no secret value or recipient identity.

The previous active deployment remains active.

No end user first discovers the missing channel by reaching a runtime
verification dead end.

Non-production capture or rehearsal may satisfy non-production readiness only
when their provenance is correctly classified and admissible there.

## 11. Guest-first template posture

The agent-built starter template emits an explicit guest-first auth program.

This is a template choice, not a platform default.

The emitted shape is:

```ts
guestPolicy: {
  enabled: true,
  claiming: ['emailCode'],
  reaping: {
    afterMs: AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
    cleanup: {
      kind: 'declarative',
      default: 'tombstone',
      tables: {},
    },
  },
},
```

When the app adds a table with a declared guest-principal reference, generation
requires a table policy:

```ts
guestPolicy: {
  enabled: true,
  claiming: ['emailCode'],
  reaping: {
    afterMs: AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS,
    cleanup: {
      kind: 'declarative',
      default: 'tombstone',
      tables: {
        draft: {
          principalField: 'ownerId',
          onReap: 'delete',
        },
        post: {
          principalField: 'authorId',
          onReap: 'retain-anonymized',
        },
      },
    },
  },
},
```

Reaping is idempotent.

A reaper:

- selects only expired active guests;
- acquires a transition generation;
- executes the declared cleanup;
- writes `guest.reaped`;
- terminates guest sessions;
- marks the principal reaped;
- applies permission-backing invalidation; and
- commits atomically per guest.

A cleanup failure leaves the guest active and retryable.

The default tombstone posture prevents silent orphaning.

General collision quarantine, `switch_existing`, and merge cleanup remain with
the account-lifecycle Spec.

## 12. Budget consumption points

The floor references the effect-budgets vocabulary without redefining it.

| Transition | Required budget names |
| --- | --- |
| Guest create | `auth.guest.create`, `auth.session.mint` |
| Guest claim request/proof | existing challenge budgets, `auth.identity.enumeration` |
| Password account creation | `auth.account.create`, `auth.identity.enumeration`, `auth.password.hash-cpu`, `auth.session.mint` |
| Password authentication | `auth.password.guess`, `auth.identity.enumeration`, `auth.password.hash-cpu`, `auth.session.mint` |
| Password set/change | `auth.password.guess` when reproof occurs, `auth.password.hash-cpu` |
| Recovery-code issue/rotate | `auth.password.hash-cpu` only if accompanying password proof requires it |
| Recovery-code consumption | `auth.recovery-code.guess`, `auth.identity.enumeration`, `auth.session.mint` |

The effect-budgets Spec determines which attempts charge, which axes compose,
how denial is charged, and how retries use normalized idempotency identity.

Identity-core code MUST pass the complete normalized transition identity to
that subsystem.

It MUST NOT implement a second per-endpoint counter.

A budget refusal occurs before any authority-granting effect.

Public refusal remains non-enumerating.

## 13. Diagnostics

The following are identity-core additions.

| Code | Locus / HTTP | Meaning |
| --- | --- | --- |
| `SNAPBACK_AUTH_PROGRAM_INVALID` | codegen/stage | Closed auth declaration is structurally invalid |
| `SNAPBACK_AUTH_PROGRAM_VERSION_UNSUPPORTED` | codegen/stage | Unknown `defineAuth` version |
| `SNAPBACK_AUTH_PROGRAM_REFERENCE_UNKNOWN` | codegen | Unknown mechanism/provider/adapter/function/table reference |
| `SNAPBACK_AUTH_SECRET_REFERENCE_INVALID` | codegen/stage | Literal secret, unknown config reference, or wrong secret class |
| `SNAPBACK_AUTH_BUDGET_REFERENCE_INVALID` | codegen/stage | Unknown effect-budget name |
| `SNAPBACK_AUTH_ASSURANCE_REQUIREMENT_INVALID` | codegen | Unknown, duplicate, cyclic, or contradictory requirement |
| `SNAPBACK_AUTH_ASSURANCE_REQUIRED` | 403 | Required admissible assurance is absent |
| `SNAPBACK_AUTH_ASSURANCE_CORRUPT` | startup/operator | Stored assurance violates catalog or governing-authority rules |
| `SNAPBACK_AUTH_ASSURANCE_PROVENANCE_INADMISSIBLE` | operator/explain | Assurance exists but provenance is inadmissible; public path maps to `ASSURANCE_REQUIRED` |
| `SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3` | stage/request | Requested identity-core surface is unavailable on ReadyV1/ReadyV2 |
| `SNAPBACK_AUTH_DELIVERY_REQUIRED` | deploy/readiness | Required verified-contact assurance has no deployment delivery channel |
| `SNAPBACK_AUTH_DELIVERY_UNAVAILABLE` | operator/readiness | Declared adapter is unset, disabled, unavailable, or unapplied |
| `SNAPBACK_AUTH_GUEST_DISABLED` | 404 | Guest transition is not declared |
| `SNAPBACK_AUTH_GUEST_STATE_INVALID` | 409 | Principal is not in the required guest state |
| `SNAPBACK_AUTH_GUEST_ALREADY_CLAIMED` | 409 | Concurrent/replayed claim observed a committed claim |
| `SNAPBACK_AUTH_GUEST_CLAIM_COLLISION` | 409 | Verified identity belongs to a different principal |
| `SNAPBACK_AUTH_IDENTITY_UNAVAILABLE` | 409 | Requested signup identity cannot be allocated |
| `SNAPBACK_AUTH_CREDENTIAL_INVALID` | 401 | Uniform password-authentication failure |
| `SNAPBACK_AUTH_PASSWORD_POLICY` | 422 | New password fails declared policy or common-password screening |
| `SNAPBACK_AUTH_RECENT_AUTH_REQUIRED` | 403 | Sensitive transition lacks admissible recent authentication |
| `SNAPBACK_AUTH_RECOVERY_CODE_INVALID` | 401 | Uniform recovery-code failure |
| `SNAPBACK_AUTH_RECOVERY_CODES_ALREADY_ISSUED` | 409 | Initial issue requested with a live set present |
| `SNAPBACK_AUTH_LAST_AUTHENTICATOR` | 409 | Transition would leave no usable authenticator |
| `SNAPBACK_AUTH_PROVISIONING_INVALID` | codegen/stage | Hook declaration or binding shape is invalid |
| `SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN` | hook/operator | Hook attempted an undeclared or wrong-mode write |
| `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` | function/runtime | Ordinary code attempted a sealed identity-binding write |
| `SNAPBACK_AUTH_PROVISIONING_FAILED` | transition / 503 | Hook failed; transition rolled back |
| `SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH` | transition / 409 | Idempotency key was reused with a different hook digest |
| `SNAPBACK_AUTH_IMPORT_ASSURANCE_INVALID` | import | Source evidence cannot produce the claimed assurance |
| `SNAPBACK_AUTH_SECURITY_JOURNAL_FAILED` | transition / 503 | Required journal write failed |
| `SNAPBACK_AUTH_NOTIFICATION_ENQUEUE_FAILED` | transition / 503 | Configured required outbox intent could not commit |
| `SNAPBACK_AUTH_GUEST_CLEANUP_INCOMPLETE` | codegen/stage | Guest-referenced app state lacks a cleanup policy |

Unknown request-path codes remain internal 500 responses.

Public diagnostics never contain:

- account-existence detail;
- canonical email or username;
- password-policy screening source;
- assurance inventory;
- recovery-set state;
- credentials;
- secrets; or
- internal table contents.

Gated explanation may expose exact cause with an opaque public correlation id.

## 14. Acceptance matrix

| ID | Positive or negative case | Required assertion |
| --- | --- | --- |
| C-01 | Fresh uninitialized activation | Exact v3 objects and marker `3` commit together |
| C-02 | Crash before marker insert | No partial catalog is recognized or adopted |
| C-03 | Exact frozen v1 open | `ReadyV1`; sessions/email-code usable; no migration |
| C-04 | Exact frozen v2 open | `ReadyV2`; agent/session surfaces usable; no migration |
| C-05 | v1/v2 identity-core request | Typed `IDENTITY_CORE_REQUIRES_V3`, no write |
| C-06 | Unknown marker | `CATALOG_VERSION_UNSUPPORTED`, no mutation |
| C-07 | Changed/extra v3 object | `CATALOG_CORRUPT`, no service |
| C-08 | App declares `_auth_*` object | Existing reserved-name diagnostic |
| P-01 | Valid auth program | All deterministic artifacts share one program digest |
| P-02 | Unknown nested field | Typed generation failure, no outputs |
| P-03 | Duplicate lowered key | Typed generation failure |
| P-04 | Unknown mechanism/provider/adapter | Typed reference failure |
| P-05 | Literal provider secret | `SECRET_REFERENCE_INVALID`; sentinel absent from outputs |
| P-06 | Unknown budget name | `BUDGET_REFERENCE_INVALID` |
| P-07 | Requirement cycle | `ASSURANCE_REQUIREMENT_INVALID` |
| P-08 | `requires` with incompatible `auth` | Generation refusal |
| P-09 | Guest enabled without cleanup | Generation refusal |
| P-10 | Binding table lacks unique sides | Provisioning declaration refusal |
| A-01 | Real email delivery proof | `email_verified/delivery` admitted in prod |
| A-02 | Valid imported verified email | `email_verified/import` admitted in prod |
| A-03 | Import boolean without original time | Snapshot-observed issuance recorded honestly |
| A-04 | Import attempts `recent_auth` | Refused with import-assurance diagnostic |
| A-05 | Capture adapter claims delivery provenance | Refused |
| A-06 | Rehearsal email assurance in test | Admitted while governing window remains valid |
| A-07 | Same rehearsal assurance in prod | Refused before handler |
| A-08 | Window expires while parent grant lives | Window-governed assurance becomes inadmissible |
| A-09 | Expired/revoked assurance | Requirement refusal |
| A-10 | Unknown provenance in stored row | Catalog/assurance corruption, not ignored |
| A-11 | Function requires email verification | Handler runs only after shared-gate admission |
| A-12 | Handler catches application exception | Cannot catch pre-handler assurance refusal |
| G-01 | Guest create | Real principal, session, authenticated assurance, journal |
| G-02 | Guest create with caller user id | Closed DTO refusal; no principal |
| G-03 | Guest policy disabled | `GUEST_DISABLED`, no write |
| G-04 | Concurrent guest creates | Distinct server-minted principals; no shared identity |
| G-05 | Successful guest claim | Same `userId`, identity+assurance+hook+rotation atomic |
| G-06 | Claim session consequences | Claiming session rotated; other guest sessions revoked |
| G-07 | Claim client behavior | No user-switch wipe; auth-scoped data reauthorized |
| G-08 | Existing-account collision | Typed collision; guest state/data/session unchanged |
| G-09 | Collision race | At most one identity owner; no auto-merge |
| G-10 | Two claims race for one guest | Exactly one commit; loser typed |
| G-11 | Replayed proof | No duplicate identity, assurance, hook write, or session |
| PW-01 | Password account create | Principal, username identity, password, recovery set, session atomic |
| PW-02 | Account response | Password absent; recovery plaintext present once; no-store |
| PW-03 | Username canonical collision | One allocation; loser `IDENTITY_UNAVAILABLE` |
| PW-04 | Common password | Policy refusal before account write |
| PW-05 | Hashing concurrency | Argon2 work occurs outside writer lock |
| PW-06 | Password login success | New session and recent-auth assurance |
| PW-07 | Wrong password | Uniform `CREDENTIAL_INVALID`; no session |
| PW-08 | Unknown username | Same status/body/headers/work class as wrong password |
| PW-09 | Revoked password | Same public result as unknown/wrong |
| PW-10 | Login race with password change | Snapshot generation recheck prevents stale success |
| PW-11 | Session cap | Existing LLP 0057 oldest-session eviction exactly once |
| PW-12 | Password set | Requires non-guest session and recent auth |
| PW-13 | Guest attempts password set | Refused; guest must claim |
| PW-14 | Password change | New generation, acting rotation, other sessions revoked |
| PW-15 | Two password changes race | One successor; loser cannot overwrite |
| PW-16 | Lost successful change response | Old password remains invalid; no reissued bearer |
| R-01 | Initial recovery issue | Digest-only storage, one-time plaintext response |
| R-02 | Recovery issue with active set | `RECOVERY_CODES_ALREADY_ISSUED` |
| R-03 | Plaintext sentinel | Absent from DB, WAL-visible rows, logs, traces, receipts, outbox |
| R-04 | Recovery success | Presented code consumed, old set replaced, new set committed |
| R-05 | Recovery session consequences | All old sessions revoked; one new recovery session |
| R-06 | Recovery response | New plaintext set returned once under no-store |
| R-07 | Wrong/unknown/used/replaced code | One uniform public result |
| R-08 | Concurrent same-code consumption | One success, one replacement set, one new session |
| R-09 | Suspected-disclosure rotation | Old set terminal, replacement atomic |
| R-10 | Lost rotation response | No reveal; another authenticated rotation repairs custody |
| L-01 | Remove sole password without recovery | `LAST_AUTHENTICATOR`, no mutation |
| L-02 | Consume last recovery code | Atomic successor prevents zero-authenticator state |
| L-03 | Delivery adapter unavailable | Email identity does not count as usable production recovery |
| L-04 | Session only | Session does not satisfy last-authenticator rule |
| L-05 | Rehearsal-only proof in prod | Does not count as authenticator |
| H-01 | Hook first invocation | Exact declared rows and receipt commit |
| H-02 | Same provisioning key/digest retry | Prior receipt returned; handler not rerun |
| H-03 | Same key/different digest | Replay mismatch; no write |
| H-04 | Hook throws before commit | Identity, assurance, app writes, receipt, session all absent |
| H-05 | Failure after app writes before commit | Whole transition rolls back |
| H-06 | Hook undeclared-table write | Host terminates hook; no partial commit |
| H-07 | Hook external fetch/job attempt | Surface absent/refused |
| H-08 | Permission-backing write | Principal injected; provenance stored; auth version advances |
| H-09 | Hook tries membership for another principal | Refused |
| H-10 | Rehearsal hook | Provenance propagates and store taint commits with first effect |
| CL-01 | Session claims projection | Deep-frozen, null-prototype, deterministic |
| CL-02 | Client supplies claims body/header | Ignored or rejected; authoritative claims unchanged |
| CL-03 | Import assurance projection | Provenance remains `import` |
| CL-04 | Rehearsal assurance projection | Provenance remains `rehearsal` |
| CL-05 | Claims used as binding input | Generated binding writer refuses |
| CL-06 | Ordinary `bindMe` reaches sealed table | `BINDING_WRITE_FORBIDDEN` |
| CL-07 | Function declares requirement | Admission works without provenance branch |
| CL-08 | Optimistic stale claims | Cannot produce authoritative success |
| N-01 | Every successful floor transition | Required protected journal event commits |
| N-02 | Configured outbox | Lifecycle intent commits with transition |
| N-03 | Provider delivery later fails | Auth transition remains committed; outbox retries |
| N-04 | No outbox/reachable contact | Journal records channel unavailable |
| N-05 | Notification payload sentinel | No password, code, bearer, digest, or secret |
| V6-01 | Wave-1b generation | Complete readiness facts present; enforcement false |
| V6-02 | Prod requires email verification, no adapter | Wave-2a deploy refuses |
| V6-03 | Adapter declared, secret unset | Readiness names missing reference only at operator locus |
| V6-04 | Import enabled, no delivery | Deploy still refuses the no-delivery condition |
| V6-05 | Non-prod rehearsal/capture | Satisfies only its admitted non-production posture |
| T-01 | Template-generated app | Guest-first explicit; platform default unchanged |
| T-02 | Guest-referenced table added | Cleanup classification required |
| T-03 | Reaping failure | Guest remains active and retryable |
| T-04 | Successful reaping | Cleanup, session termination, journal, and terminal state atomic |
| NE-01 | Password wrong vs unknown | Status/body/header and measured work class indistinguishable |
| NE-02 | Recovery wrong vs unknown | Status/body/header indistinguishable |
| NE-03 | Public assurance refusal | Required kind only; no inventory/provenance disclosure |
| NE-04 | Gated explanation | Correlation id resolves exact cause only with operator authority |

Generated state-machine tests MUST cover every positive and negative transition
edge, not only route-level examples.

Concurrency tests MUST include fault injection at every transaction commit
boundary that returns a credential or one-time plaintext set.

## 15. Security considerations

### 15.1 Client identity remains non-authoritative

No transition accepts:

- `userId`;
- principal kind;
- assurance kind;
- assurance provenance;
- verified email status;
- credential id;
- session id; or
- provider subject

as caller authority.

Inputs selecting an identifier are treated only as lookup candidates under
non-enumerating and budgeted verification.

### 15.2 Password and recovery secrets

Password and recovery request types:

- do not implement ordinary `Debug`;
- serialize only at the HTTP boundary;
- redact on error;
- zeroize owned buffers;
- never appear in generated examples with real values; and
- are excluded from request-body capture.

The server never logs a hash input or verification candidate.

### 15.3 Binding and permission safety

The provisioning hook cannot become arbitrary system-authority application
code because:

- invocation is sealed;
- inputs are server-derived;
- reads and writes are declared;
- identity and permission tables have special write modes;
- target principal fields are host-injected;
- external effects are absent;
- assurance admission precedes execution;
- permission provenance is recorded;
- authorization versions advance atomically; and
- ordinary functions cannot reach sealed binding writers.

### 15.4 Import does not import authority

Import may preserve identities, supported password hashes, and admissible
durable verification assurances.

It does not import:

- sessions;
- refresh tokens;
- verification challenges;
- recovery codes;
- provider tokens;
- MFA shared secrets;
- rehearsal authority; or
- live grants.

Imported password hashes are marked for rehash under the current password
policy after successful authentication.

### 15.5 Rehearsal remains distinguishable

Rehearsal can satisfy non-production requirements but cannot erase its
provenance.

It cannot become delivery or import provenance.

Production rejects it at the shared gate.

Hook output under rehearsal is subject to the commissioned whole-store taint
and egress rules.

### 15.6 Failure does not weaken policy

When any of these are unavailable:

- budget service;
- catalog recognition;
- provider keyring;
- delivery readiness;
- assurance authority resolver;
- security journal;
- provisioning hook;
- authorization-version writer; or
- required outbox transaction,

the affected transition refuses.

No mechanism runs in a reduced-security compatibility mode.

## 16. Corpus register

This register is normative and fail-closed.

| Authority | Adopted rule | This Spec's ownership | Conflict handling |
| --- | --- | --- | --- |
| LLP 0212 | Four layers, assurance record, rehearsal posture, I1/I2/I8/V6, OQ3, wave-1c enumeration | Exact identity-core contract commissioned by landing item 2 | 0212 retains product frame and rehearsal authority; this Spec controls identity-core details |
| LLP 0011 | Principal-first root; server-derived identity; stable `userId`; guest claim continuity; collision refusal; session rotation; merge out of scope | Exact floor implementation of guest creation/claim | Any path that changes principal id or auto-merges is rejected |
| LLP 0151 | Identity/credential split; password baseline; recovery codes; last-authenticator; guest cleanup; continuation proposals | Exact authenticator floor and storage split | Requirements in 0151 remain a minimum; broader lifecycle stays delegated |
| LLP 0057 | `_auth` reservation; exact catalog recognition; DTO/redaction discipline; email canonicalization; session/token-family protocol | Catalog v3 extension and identity-core DTOs | V1/v2 recognized exactly; session/token-family semantics are not modified |
| LLP 0055 | Exact catalog v2; agent principal and grant semantics | V3 carries v2 agent objects unchanged | No silent v2 migration and no reinterpretation of agent credentials |
| LLP 0036 | Config/secret value custody and `uses` grants | `defineAuth` names references only | Literal or unavailable secret references fail closed |
| LLP 0045 | Durable notification outbox; ephemeral auth-challenge boundary | Lifecycle journal/outbox obligations | No auth plaintext enters durable notification intents |
| LLP 0053 | Permission-backing events and same-transaction authorization version | Hook permission-backing writes and guest-claim invalidation | Missing atomic version advancement aborts the transition |
| LLP 0058 | Shared invocation gate and sealed handler projection | Assurance admission, hook authority, and claims extension | All entry paths use the same gate; no alternate claims or hook path |

Additional precise carry-forward rules:

- LLP 0172's explicit `auth` register remains the source register extended by
  `requires`; omission does not create an assurance default.
- LLP 0059 remains authoritative for durable clock, projection, session
  termination, and client barrier behavior.
- LLP 0148's identifier registry must register any new minted id classes before
  implementation; prefixes are advisory and never authorization.
- The effect-budgets Spec exclusively owns the referenced budget semantics.
- The rehearsal-grants Spec exclusively owns rehearsal carriers, windows,
  counters, selectors, and store taint.
- The future lifecycle Spec exclusively owns post-collision
  `switch_existing`, merge, quarantine, and general link/unlink transitions.

If two authorities appear to permit different security outcomes:

1. do not infer precedence from document number;
2. apply the explicit ownership table above;
3. otherwise choose the more restrictive behavior;
4. emit a typed operator diagnostic;
5. perform no identity, credential, assurance, session, app, or notification
   write; and
6. require a corpus amendment before enabling the disputed path.

No implementation comment, guide snippet, generated artifact, or existing code
may silently weaken this register.

## 17. Non-goals

This Spec does not specify:

- `switch_existing` after guest collision;
- account merge or cross-principal data migration;
- general identity link/unlink;
- email or phone replacement;
- principal deletion;
- provider revocation;
- passkey registration/assertion ceremony;
- TOTP or MFA factor composition;
- OAuth/OIDC completion routes;
- provider registration execution;
- a production mail vendor;
- effect-budget values or axes;
- rehearsal capability structure;
- a new session bearer or refresh protocol;
- hosted-auth readiness beyond the facts required by V6; or
- migration of existing v1/v2 catalogs.

Storage slots or declaration tags for later mechanisms are not readiness
claims.

## 18. Open questions

Only numeric policy parameters remain open in this Draft. **Q1–Q4 were ruled by
the author on 2026-08-11** when the first-class password surface was
commissioned; Q5 and Q6 remain open because nothing in that slice depends on
them.

1. ~~What exact Argon2id memory, iteration, and parallelism parameters ship in
   password policy version 1?~~ **RULED 2026-08-11:** memory 19 456 KiB,
   iterations 2, parallelism 1, 16-byte random salt, 32-byte tag (OWASP-aligned).
   Expressed as a versioned `PasswordHashPolicy` **pinned explicitly in code** —
   deliberately not inherited from `Argon2::default()`, so a dependency bump
   cannot silently move the policy. The stored PHC string describes an
   individual hash and is never the policy authority.
2. ~~What exact minimum password length and maximum accepted UTF-8 byte length
   ship in version 1?~~ **RULED 2026-08-11; amended 2026-08-15:** the default
   minimum remains 12 bytes and the maximum remains 1 024 bytes. An app may
   explicitly declare one shared password-mechanism `minimumLength` from 8
   through 128; omitted declarations retain 12. Length is decoded UTF-8 bytes,
   not characters. Conflicting password-mechanism declarations and values
   outside the bound refuse during codegen/startup; the policy refusal names
   the active minimum and declaration path.
3. ~~How many recovery codes are issued per set, and how many random bits and
   display characters does each code carry?~~ **RULED 2026-08-11:** 8 codes per
   set, 160 bits each, rendered `sbrv1_` + base64url.
4. ~~What exact lifetime defines `recent_auth` for password, recovery, and future
   passkey proofs?~~ **RULED 2026-08-11:** 10 minutes.
5. What exact default retention duration and reaper batch size ship in the
   guest-first template?
6. What exact security-journal retention duration and failed-attempt sampling
   ceiling apply before archival or compaction?

These questions may tune constants and policy versions.

**Verification-cost caveat added 2026-08-11 (implementation finding).** The
policy above pins *hashing*. It does not pin *verification*: PHC verification
necessarily re-derives using the parameters embedded in the stored hash, so
passing a policy-configured `Argon2` to a verify call does not bound its cost.
Any stored hash — including one admitted through §20's widened import
allowlist — must therefore have its declared cost parameters checked against
declared ceilings **before** verification, for argon2 (m, t, p), scrypt
(log n, r, p) and bcrypt (cost) alike. The KDF concurrency permit bounds how
*many* verifications run at once; only this bounds how expensive one of them is.
The uniform-timing dummy hash must itself stay within those ceilings, or an
unknown-identifier signin would refuse early and cheaply while a real one spent
full KDF — reintroducing exactly the enumeration oracle the dummy exists to
close.

They may not reopen:

- the four-layer split;
- catalog recognition posture;
- import admissibility in production;
- rehearsal inadmissibility in production;
- the sealed hook;
- claims read-only status;
- complete floor transition membership;
- session consequences;
- notification journal floor;
- recovery-code one-time custody;
- automatic replacement after recovery use;
- last-authenticator enforcement; or
- V6 deploy/readiness-time refusal.

## 19. Status

Draft.

Acceptance requires:

- author ruling on the numeric questions;
- reconciliation with the separately authored effect-budgets and
  rehearsal-grants Specs;
- exact catalog-v3 descriptor fixtures;
- generated schema and client-state-machine artifacts;
- dual-family security review scaled to the password, recovery, import,
  provisioning, and claims surfaces;
- implementation of every acceptance row claimed by the landing; and
- an explicit author decision before status advances.

## 20. Amendment (2026-08-10): reconciliation with LLP 0227

Commissioned by the author 2026-08-10 to resolve the two-spec catalog-v3
collision found in LLP 0227's super-refine loop
(`llp/reviews/0227-password-credential-auth.gpt-5.md` rounds 2–5). This Spec
is the **catalog authority**; the outcome:

1. **This Spec's credential shape supersedes 0227's sketch DDL wholesale.**
   `_auth_credentials` (kind-based base) + `_auth_password_credentials`
   (typed material, argon2id-pinned, `policy_version`) + the
   `_auth_password_one_live_per_user` partial index replace 0227's
   identity-linked sketch. 0227's upgrade-on-verify composes as a material
   rewrite under the base row's `generation` compare-and-swap. Import
   note: 0227's create/attach modes admit foreign `scrypt`/`bcrypt` PHC
   strings; the `algorithm = 'argon2id'` CHECK therefore widens to the
   bounded allowlist `('argon2id','scrypt','bcrypt')` with 0227's
   parameter caps, upgrading-on-verify back to argon2id — the sole change
   this reconciliation makes to §3.7.
2. **The composed v3 descriptor gains one relation from 0227:**
   `_auth_password_attempts` (canonical address PRIMARY KEY,
   `window_start_ms`, `failed_count`, `locked_until_ms`) — internal,
   account-existence-blind lockout state only, per 0227's non-oracular
   contract; the canonical-address custody list gains this row. It is
   **not** a budget substrate: rate metering is LLP 0215's, and this Spec's
   second-endpoint-counter prohibition stands.
3. **Identifier class:** the local-password provider's per-app identifier
   mode is declared at activation — `username-v1` (this Spec's floor) or
   `email-v1` (0227's benchmark slice, subject = canonical address).
   Provider-scoped lookups keep 0227's containment: a local-password
   identity never satisfies an email-code lookup, cross-provider email
   equality never auto-links (§3.5 unchanged), and 0227's
   set-displacement/same-principal-reset flows carry over with displacement
   realized as `revoked_at_ms` retirement of the credential **plus**
   retirement of the local-password identity link, with the affected
   session set terminated through the planned session-terminal operation
   (LLP 0059 `durableDelete`) — not FK cascade.
4. **Public refusal-code family:** this Spec's uniform
   `SNAPBACK_AUTH_CREDENTIAL_INVALID` is the public wire code; 0227's
   `SNAPBACK_AUTH_PASSWORD_*` names survive only as internal
   classifications and observability facts.
5. **Flow semantics adopted from 0227** (normative here, detailed there):
   the two-phase exact-predecessor verification fence extended over the
   ledger predecessor; step-up-bound first-password set with the
   `identityId` target; uniform KDF spend for lock-window attempts; reset
   screening parity.
6. **Landing remains gated** on this Spec's own preconditions (§19) —
   including the backup-format blocker
   (`issues/20260810-llp-0214-floor-catalog-v3-backup-blocked.md`) — and
   the exact composed descriptor fixtures now include items 1–2 above plus
   the LLP 0031 route-policy tuples for 0227's four routes.

## 21. Amendment (2026-08-11): catalog v4, and what the reconciliation actually cost

§20 placed `_auth_password_attempts` and the per-app identifier mode in "the
composed v3 descriptor." That is now **wrong in one respect and is corrected
here**: they ship in **catalog version 4**, not v3.

**Why.** Catalog v3 shipped publicly in `@expo/snapback-*` 0.1.18
(2026-08-10) and 0.1.19 (2026-08-11) before those relations existed. Catalog
recognition compares stored SQL text and physical pragma shape against the
descriptor for the marked version, so adding a table to v3 in place would make
every store those published runtimes created fail recognition and refuse
**entirely** — not merely refuse the password paths. A new version costs one
marker and confines the consequence: a v3 store keeps doing everything it does
today, and only the first-class password provider reports unready
(`SNAPBACK_AUTH_PASSWORD_REQUIRES_V4`) through `authProgramReadiness`. Author
ruling, 2026-08-11.

The version discipline holds in both directions and is tested as such: a v3-era
recognizer refuses marker `4` with
`SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED`, and there is no silent v3 → v4
migration (§3.1 unchanged).

**Identifier mode** (§20 item 3) is declared at activation in `_snapback_meta`
as `auth_password_identifier_mode`, readable without a transaction so readiness
reporting does not need one, immutable after activation
(`SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE`), with the marker written
last. `email-v1` reuses the existing `CanonicalAddress` rather than introducing
a second canonicalizer. Catalog v3's shipped internal floor retains implicit
`username-v1`.

**Backup** widened **format 2** rather than minting format 3: v3 manifests keep
their exact prior shape by omitting the optional field and v4 requires it, so
no new backup envelope or security protocol was introduced. Every existing
backup security assertion is preserved, none relaxed.

**Logical transfer** carries the identifier mode — so an `email-v1` identity
cannot be imported into a `username-v1` target under the wrong interpretation —
but deliberately **excludes** the attempt ledger. Operational anti-abuse history
is not principal/ownership/identity fact, and exporting it would carry canonical
addresses into a logical artifact. Physical backup and instance-fork custody do
carry it, consistent with §20 item 2's custody placement.

### What §20 item 6's gate actually turned out to require

§20 item 6 gated landing on §19's preconditions. In the event, the backup
blocker was cleared by the format-2 work that landed with the floor
(`961b8be8c`), and implementation proceeded under author rulings on §18 Q1–Q4
rather than a full §19 acceptance. **This Spec remains Draft**: §19 still wants
the dual-family security review and complete acceptance, and the shipped
surface should not be read as those having happened.

### Session issuance — a floor defect found by exposing it

The floor landed by `961b8be8c` minted sessions with a direct `INSERT` into
`_auth_sessions` carrying a locally generated authority id. That is sound as
storage and unsound as issuance: the resulting bearer was absent from the
memory-only session resolver, so it would not have resolved as a required
session until a projection rebuild or restart. It was invisible while nothing
called it and would have surfaced as "signup returns a session that does not
work" the moment a route existed.

Password, guest-claim, and recovery-consume transitions now run the same
plan → premark → commit → reconcile → finalize → propagate path as an
email-code exchange, through a shared issuance primitive rather than a parallel
copy. They acquire typed `Kind::AuthorityInstance` ids, session-cap planning
with exact commit-time recheck and cap-eviction terminal causes,
token-collision admission, commit-uncertainty reconciliation, and LLP 0059
projection finalization.

Password change is consequently an authenticated **same-authority rotation**,
not the floor's authority transition: it rotates the acting session's bearer
and revokes the user's *other* sessions through a new user-scoped revocation
operation (LLP 0057's bulk helper is deliberately instance-wide and is not
reused). Preserving the authority instance id is what lets the client arm adopt
change through its existing credential-rotation path instead of a fresh login.

## 22. Amendment (2026-08-15): application auth bootstrap inputs

LLP 0258 D1 extends the closed version-1 `defineAuth(...)` program with two
semantic inputs. `custody` is optional and normalizes to `durable-required`;
its only other admitted value is the explicitly authored
`volatile-explicit`. Codegen never infers the weaker grade from target or
adapter availability. `externalSessionEntry` is optional and, when present,
must be the literal `true`; it is the sole declaration that admits
`external-session-explicit-v1` into the generated application bootstrap
policy.

Both fields enter the existing normalized auth-program record and therefore
the LLP 0241 semantic-identity path. They do not create another auth
configuration, carry credentials, or alter the server's per-operation
authorization authority. Their generated projection and refusal rules are
owned by LLP 0258 D1.

Profile disposition (LLP 0252 D1, rows in LLP 0253 Appendix A): the
Familiar profile supplies the `durable-required` default and refuses an
authored `volatile-explicit`; `externalSessionEntry` is shared through the
same explicit advanced-session extension. Changing `custody` rotates the
generated bootstrap-policy semantic identity, and a live LLP 0258
bootstrap owner refuses to absorb that rotation by rebind (0258 D2).
Neither field is an entry mechanism: `guestPolicy` (a claimable guest
principal proves no control and is not anonymous access) and the passkey
slot stay out of the generated entry-mechanism allowlist, and
`recoveryPolicy` continues to own the recovery lifecycle — LLP 0258 D9's
generated recovery rows derive from it, never from the mechanism/provider
set.
