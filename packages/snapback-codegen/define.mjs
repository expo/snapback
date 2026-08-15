// Snapback authoring surface: source-authored schema + handlers.
//
// @ref LLP 0004#schema-api — schema/handlers are source-authored and codegen-friendly.
// @ref LLP 0004#first-slice-api-decisions — source definitions codegen into
//   manifest-backed handlers; HostPlan remains for narrow deterministic fixtures
//   while JavaScript `ctx.db` handlers use the Ibex bridge.
//
// These builders are *executed* by codegen (packages/snapback-codegen/index.mjs)
// to produce the generated manifests. Executing the definition module — rather
// than regex/AST parsing it — is a deliberate response to the Valet silent-drop
// failure recovered in LLP 0006 / LLP 0010#generated-artifacts: a typo is a loud
// runtime error here, never a field quietly missing from the persisted schema.
//
// The definition markers below are Symbols, so guard checks work only against
// this module instance: every import path (including the demos/_kit/define.mjs
// compatibility shim) must resolve to this one file.

const FN = Symbol('snapback.fn');
const ROUTES = Symbol('snapback.routes');
const CRON = Symbol('snapback.cron');
const CONFIG = Symbol('snapback.config');
const PROJECTION = Symbol('snapback.maintainedProjection');
const TABLE = Symbol('snapback.table');
const DATA_RESOURCE_SPEC_FIELDS = new Set([
  'listIndex', 'createDefaults', 'updateDefaults', 'immutable',
]);
const EPHEMERAL_COLLECTION = Symbol('snapback.ephemeralCollection');
const EPHEMERAL = Symbol('snapback.ephemeral');
const ASSET_UPLOAD = Symbol('snapback.assetUpload');
const COMMAND = Symbol('snapback.command');
const SURFACE = Symbol('snapback.surface');
const SURFACE_BINDING = Symbol('snapback.surfaceBinding');
const PUSH_SEAM = Symbol('snapback.pushSeam');
// The result validator is needed only while composing an authored relational
// definition into snapshot-batch.v2. Keep it out of the definition object:
// the isolated evaluator deliberately admits exactly one symbol marker per
// definition and rejects any additional hidden carrier.
const RELATIONAL_PAGES = new WeakMap();
const AUTH_PROGRAMS = new WeakSet();
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const REFLECT_APPLY = Reflect.apply;
const ARRAY_SLICE = Array.prototype.slice;
const USER_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const isUserIdentifier = (value) => {
  if (typeof value !== 'string' || !USER_IDENTIFIER.test(value) || value.startsWith('_snapback')) {
    return false;
  }
  const folded = value.toLowerCase();
  return folded !== '_auth' && !folded.startsWith('_auth_');
};
const AUTH_MODES = new Set(['dev', 'sessions']);
const AUTH_ASSURANCE_KINDS = new Set([
  'authenticated', 'email_verified', 'phone_verified', 'recent_auth', 'phishing_resistant',
]);
const AGENT_REGISTRATION_MODES = new Set(['disabled', 'invited', 'open']);
const AGENT_INVITERS = new Set(['operators', 'users']);
const API_DISCLOSURES = new Set(['exposed-only', 'full']);
const AUTH_REQUIREMENTS = new Set(['public', 'optional-user', 'authenticated']);
const AUTHORIZATION_DIMENSIONS = new Set([
  'userId',
  'kind',
  'actorKind',
  'isDelegated',
  'sessionId',
  'provider',
  'roles',
  'isAuthenticated',
  'opaque',
]);
export const QUERY_SPEC_FIELDS = new Set([
  'table', 'args', 'filter', 'order', 'limit', 'index', 'defaultLive',
  'auth', 'authorityIndependent', 'publicInline', 'retainable', 'refusals', 'trackedRefusals',
  'authScopeField', 'membership', 'standardPattern', 'requires',
]);
export const MUTATION_SPEC_FIELDS = new Set([
  'args', 'plan', 'result', 'returns', 'stream', 'boundedSkew', 'standardPattern',
  'auth', 'authorityCreating', 'refusals', 'trackedRefusals', 'requires',
]);
export const ACTION_SPEC_FIELDS = new Set([
  'args', 'plan', 'js', 'handler', 'result', 'returns', 'stream', 'uses', 'writes',
  'auth', 'authorityCreating', 'refusals', 'trackedRefusals', 'requires',
]);

// @ref LLP 0065#3-common-pattern-contracts — every standard-pattern helper
//   and profile carries a stable versioned identifier recorded in generated
//   artifacts. Free-form definitions never carry one.
function normalizeStandardPattern(spec, kind) {
  if (spec.standardPattern === undefined) return {};
  const value = spec.standardPattern;
  assert(
    value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.helper === 'string' && value.helper.length > 0
      && typeof value.profile === 'string' && value.profile.length > 0,
    `${kind} standardPattern must carry { helper, profile } version identifiers`,
  );
  // @ref LLP 0100#5-index-and-continuation-contract — the membership pages
  // profile carries its generation-time membership facts (declaration stable
  // id, resource argument/field, canonical role set) on the standard pattern
  // so the runtime's cursor binding digest can consume them without
  // re-deriving authority facts from the plan.
  if (value.membership !== undefined) {
    const membership = value.membership;
    assert(
      membership && typeof membership === 'object' && !Array.isArray(membership)
        && typeof membership.declaration === 'string' && membership.declaration.length > 0
        && typeof membership.resourceArg === 'string' && membership.resourceArg.length > 0
        && typeof membership.resourceField === 'string' && membership.resourceField.length > 0
        && Array.isArray(membership.roles) && membership.roles.length > 0
        && membership.roles.every((role) => typeof role === 'string' && role.length > 0)
        && Object.keys(membership).length === 4
        && Object.keys(value).length === 3,
      `${kind} standardPattern.membership must be { declaration, resourceArg, resourceField, roles }`,
    );
    return {
      standardPattern: {
        helper: value.helper,
        profile: value.profile,
        membership: {
          declaration: membership.declaration,
          resourceArg: membership.resourceArg,
          resourceField: membership.resourceField,
          roles: [...membership.roles],
        },
      },
    };
  }
  assert(
    Object.keys(value).length === 2,
    `${kind} standardPattern must be { helper, profile } version identifiers`,
  );
  return { standardPattern: { helper: value.helper, profile: value.profile } };
}
export const JS_QUERY_SPEC_FIELDS = new Set([
  'args', 'source', 'exportName', 'handler', 'reads', 'result', 'authScopeField',
  'defaultLive', 'auth', 'authorityIndependent', 'retainable', 'refusals', 'trackedRefusals',
  'authorizationDependence', 'requires', 'fieldBoundary',
]);
const TARGET_CAPABILITIES = new Set([
  'auth.sessions.v1',
  'cron',
  'cron_action_run_mutation',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'live_subscriptions',
  'mutation_read_set_validation',
  'notifications.expoPushSeam',
  'realtime.connected-client-predicate',
  'settlement.bounded_skew',
  'permission_epoch_resync',
  'full_text_search_v1',
  'live_full_text_search_v1',
  'bounded_children_v1',
  'snapshot_batch_v1',
  'snapshot_batch_v2',
  'write_activity_v1',
  'vector_search_v1',
]);
const SEARCH_INDEX_SPEC_FIELDS = new Set([
  'semanticVersion', 'textFields', 'fieldClassifications', 'equalityFilters', 'storedFields',
  'highlightFields', 'visibility', 'sourceLimits', 'queryLimits',
  'cursorLimits', 'maintenanceLimits', 'liveLimits',
]);
const SEARCH_TEXT_FIELD_SPEC_FIELDS = new Set(['weight', 'classification']);
const SEARCH_FIELD_CLASSIFICATIONS = new Set(['public', 'private', 'sensitive', 'forbidden']);
const VECTOR_INDEX_SPEC_FIELDS = new Set([
  'semanticVersion', 'vectorField', 'metric', 'fieldClassifications',
  'equalityFilters', 'storedFields', 'visibility', 'tieBreak',
  'maxIndexedVectorsPerPartition',
]);
const SEARCH_SOURCE_LIMIT_FIELDS = new Set(['maxIndexedBytes', 'maxTokens', 'maxPostingOperations']);
const SEARCH_QUERY_LIMIT_FIELDS = new Set(['maxCandidateWork', 'maxPrefixTerms', 'minPrefixScalars']);
const SEARCH_CURSOR_LIMIT_FIELDS = new Set(['ttlMs', 'maxBytes']);
const SEARCH_MAINTENANCE_LIMIT_FIELDS = new Set([
  'searchMaintenanceEffects', 'searchPostingOps', 'searchPositions', 'searchBytes',
]);
const SEARCH_LIVE_LIMIT_FIELDS = new Set([
  'maxLiveSubscriptions', 'maxLiveSubscriptionsPerConnection',
]);
const SEARCH_TABLE_LIVE_LIMIT_FIELDS = new Set(['maxLiveSubscriptionsPerTable']);
// @ref LLP 0044#generated-upload-intents — the closed authoring surface for
//   one upload intent; the client cannot supply or widen any declared fact.
const ASSET_UPLOAD_FIELDS = new Set([
  'args', 'auth', 'reads', 'accept', 'delivery', 'access', 'grants', 'image', 'video', 'on',
  'authorize', 'source', 'exportName',
]);
const ASSET_CALLBACK_EVENTS = ['ready', 'rejected'];
const ASSET_ACCEPT_FIELDS = new Set(['mediaTypes', 'maxBytes']);
// The concrete types src/assets.rs detect_content_type can produce; accepts
// outside this set (or wildcards intersecting it) can never finalize.
const ASSET_DETECTABLE_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'video/mp4', 'video/quicktime',
  'application/gzip', 'application/zip', 'application/octet-stream',
]);
function acceptEntryDetectable(mediaType) {
  const lower = mediaType.toLowerCase();
  if (ASSET_DETECTABLE_MEDIA_TYPES.has(lower)) return true;
  if (lower === '*/*') return true;
  if (lower.endsWith('/*')) {
    const prefix = lower.slice(0, -1);
    for (const detectable of ASSET_DETECTABLE_MEDIA_TYPES) {
      if (detectable.startsWith(prefix)) return true;
    }
  }
  return false;
}
const ASSET_DELIVERY_KINDS = new Set(['public-immutable', 'private-signed', 'private-strict']);
const ASSET_READ_ACCESS = new Set(['owner-only', 'via-references']);
const ASSET_LOCATION_POLICIES = new Set(['strip', 'retain']);
const ASSET_IMAGE_FIELDS = new Set(['location', 'variants']);
const ASSET_VIDEO_FIELDS = new Set(['location']);
const ASSET_VARIANT_FIELDS = new Set(['key', 'width', 'required']);
// @ref LLP 0007#dated-amendment-asset-references-sharing-declarations-and-admission-2026-07-31
//   — the sharing declaration reuses the shipped closed visibility union.
const ASSET_SHARING_KINDS = new Set(['public-read', 'owner', 'membership']);
const TABLE_VISIBILITY_KINDS = new Set(['public-read', 'owner', 'membership', 'any-of']);

const MEMBERSHIP_FIELDS = new Set([
  'id', 'principal', 'resource', 'role', 'roles', 'pendingRoles',
  'bootstrapRole', 'lastHolder', 'expiry', 'incidental', 'provenance',
  'transitions', 'scope', 'principalAddressedWrites',
]);
const MEMBERSHIP_TRANSITION_FIELDS = new Set([
  'op', 'by', 'target', 'from', 'to', 'fields',
]);
const MEMBERSHIP_OPS = new Set(['insert', 'setRole', 'remove', 'patch']);
const MEMBERSHIP_TARGETS = new Set(['self', 'other']);
const MEMBERSHIP_PROVENANCE = new Set(['creation', 'full']);

function authoredFunctionAuth(spec, kind) {
  // @ref LLP 0058#closed-function-requirement — authoring accepts only the
  // closed requirement and authority-independence spellings the Rust parser owns.
  const fields = {};
  if (spec.auth !== undefined) {
    assert(AUTH_REQUIREMENTS.has(spec.auth), `${kind} auth must be public, optional-user, or authenticated`);
    fields.auth = spec.auth;
  }
  if (spec.requires !== undefined) {
    assert(Array.isArray(spec.requires), `${kind} requires must be an array`);
    assert(spec.auth === 'authenticated', `${kind} assurance requires need auth: authenticated`);
    assert(
      spec.requires.every((requirement) => typeof requirement === 'string' && requirement.length > 0),
      `${kind} requires entries must be non-empty names`,
    );
    assert(new Set(spec.requires).size === spec.requires.length, `${kind} requires must not repeat names`);
    fields.requires = [...spec.requires];
  }
  if (spec.authorityIndependent !== undefined) {
    assert(typeof spec.authorityIndependent === 'boolean', `${kind} authorityIndependent must be boolean`);
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot be authorityIndependent`);
    fields.authorityIndependent = spec.authorityIndependent;
  }
  if (spec.publicInline !== undefined) {
    // @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact —
    // an HTML-embedding disclosure permission on an already-public query;
    // accepted only beside a valid authorityIndependent declaration.
    assert(typeof spec.publicInline === 'boolean', `${kind} publicInline must be boolean`);
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot be publicInline`);
    fields.publicInline = spec.publicInline;
  }
  if (spec.authorityCreating !== undefined) {
    assert(typeof spec.authorityCreating === 'boolean', `${kind} authorityCreating must be boolean`);
    assert(kind === 'Mutation' || kind === 'Action', `${kind} cannot be authorityCreating`);
    fields.authorityCreating = spec.authorityCreating;
  }
  if (spec.retainable !== undefined) {
    assert(typeof spec.retainable === 'boolean', `${kind} retainable must be boolean`);
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot be retainable`);
    fields.retainable = spec.retainable;
  }
  // @ref LLP 0108#declared-application-refusals — the declaration is what
  //   makes an app-thrown code typed; an undeclared throw stays generic.
  const declaredRefusals = new Set();
  if (spec.refusals !== undefined) {
    assert(Array.isArray(spec.refusals), `${kind} refusals must be an array`);
    assert(spec.refusals.length <= 64, `${kind} declares more than 64 refusals`);
    for (const code of spec.refusals) {
      assert(
        typeof code === 'string' && code.length > 0 && code.length <= 64,
        `${kind} refusal codes must be 1..=64 character strings`,
      );
      assert(
        !code.startsWith('SNAPBACK_'),
        `${kind} refusal ${code} must not use the reserved SNAPBACK_ namespace`,
      );
      assert(
        /^[A-Z0-9_]+$/.test(code),
        `${kind} refusal ${code} must be A-Z, 0-9, and underscore`,
      );
      assert(!declaredRefusals.has(code), `${kind} declares duplicate refusal ${code}`);
      declaredRefusals.add(code);
    }
    fields.refusals = [...spec.refusals];
  }
  // @ref LLP 0108#tracked-refusal-opt-in — tracking can only narrow the
  //   already typed refusal set; it never admits an app code by itself.
  if (spec.trackedRefusals !== undefined) {
    assert(Array.isArray(spec.trackedRefusals), `${kind} trackedRefusals must be an array`);
    assert(spec.trackedRefusals.length <= 64, `${kind} tracks more than 64 refusals`);
    const seenTrackedRefusals = new Set();
    for (const code of spec.trackedRefusals) {
      assert(
        typeof code === 'string',
        `${kind} trackedRefusals entries must be strings`,
      );
      assert(
        declaredRefusals.has(code),
        `${kind} tracked refusal ${code} must also appear in refusals`,
      );
      assert(
        !seenTrackedRefusals.has(code),
        `${kind} tracks duplicate refusal ${code}`,
      );
      seenTrackedRefusals.add(code);
    }
    fields.trackedRefusals = [...spec.trackedRefusals];
  }
  if (spec.authorizationDependence !== undefined) {
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot declare authorizationDependence`);
    assert(Array.isArray(spec.authorizationDependence), `${kind} authorizationDependence must be an array`);
    const seen = new Set();
    for (let index = 0; index < spec.authorizationDependence.length; index += 1) {
      const dimension = spec.authorizationDependence[index];
      assert(AUTHORIZATION_DIMENSIONS.has(dimension), `${kind} authorizationDependence contains unknown dimension ${String(dimension)}`);
      assert(!seen.has(dimension), `${kind} authorizationDependence repeats ${dimension}`);
      seen.add(dimension);
    }
    fields.authorizationDependence = REFLECT_APPLY(ARRAY_SLICE, spec.authorizationDependence, []);
  }
  return fields;
}

function assertKnownSpecFields(spec, kind, allowed, code = undefined) {
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), `${kind} expects a spec object`);
  const fields = Object.keys(spec);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    assert(allowed.has(field), `${kind} has unknown field ${field}`, code);
  }
}

// ---------------------------------------------------------------------------
// Validators (field + arg types). The vocabulary maps 1:1 onto the server's
// FieldType enum and the Contract DataTypeDescriptor primitive names.
// ---------------------------------------------------------------------------

/** @ref LLP 0004#portability-rules — the validator vocabulary must map cleanly to
 *  SQLite, Postgres, generated types, and the wire format. */
function validator(fieldType, primitive, extra = {}) {
  return { __validator: true, fieldType, primitive, optional: false, ...extra };
}

export const v = {
  string: (options = {}) => {
    assertKnownSpecFields(options, 'v.string() options', new Set(['maxBytes']));
    if (options.maxBytes !== undefined) {
      assert(Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0, 'v.string() maxBytes must be a positive safe integer');
    }
    return validator('String', 'string', {
      ...(options.maxBytes !== undefined ? { resultOptions: { maxBytes: options.maxBytes } } : {}),
    });
  },
  // @ref LLP 0056#declaring-a-membership-table — principal and application
  // ids stay strings on the wire while preserving their nominal identity in
  // the manifest for authorization-axis validation.
  principal: () => validator('Principal', 'string'),
  id: (table) => {
    assert(typeof table === 'string' && table.length > 0, 'v.id() expects a table name');
    return validator({ Id: { table } }, 'string');
  },
  /** Result-contract-only reference to the complete stored document shape.
   * Codegen resolves this marker against the app schema before hashing or
   * emission; it is deliberately not an argument or stored-field validator.
   * @ref LLP 0127#move-1--contracts-reference-nothing-respells */
  doc: (table) => {
    assert(typeof table === 'string' && table.length > 0, 'v.doc() expects a table name');
    return validator({ AppSchemaRef: { authority: 'app', table } }, 'appSchemaRef');
  },
  /** Framework-owned child stamp; application inserts/patches never author it.
   * @ref LLP 0110#protected-relation-incarnation-and-stamping */
  relationIncarnationOf: ({ foreignKeyField, parentTable } = {}) => {
    assert(
      typeof foreignKeyField === 'string' && foreignKeyField.length > 0
        && typeof parentTable === 'string' && parentTable.length > 0,
      'v.relationIncarnationOf() expects { foreignKeyField, parentTable }',
    );
    return validator({
      RelationIncarnation: { foreignKeyField, parentTable },
    }, 'string', { protectedWrite: true });
  },
  /** Typed asset reference (LLP 0044 §Typed references; LLP 0007 dated
   * amendment 2026-07-31). The value is the opaque asset id string; the
   * commit boundary validates every write's admission, so a raw string
   * assignment fails there, not here. An `upload` restriction names the
   * exported upload-intent binding whose assets the field admits and is what
   * lets non-handler write paths derive a commit-boundary admission;
   * a restriction-less field is attachable only through handler-side
   * `ctx.assets.attach`. */
  assetRef: (options = {}) => {
    assertKnownSpecFields(options, 'v.assetRef() options', new Set(['upload']));
    if (options.upload !== undefined && options.upload !== null) {
      assert(
        typeof options.upload === 'string' && options.upload.length > 0,
        'v.assetRef() upload must name an upload-intent binding, or be null for an unrestricted handler-attach-only field',
      );
    }
    // LLP 0044 §Ceremony floor (2026-08-01): omitted upload derives a
    // generated default intent at generation; the explicit `upload: null`
    // keeps the prior unrestricted handler-attach-only semantics. The
    // marker never reaches the schema manifest — codegen consumes it.
    return validator({
      AssetRef: {
        ...(typeof options.upload === 'string' ? { upload: options.upload } : {}),
        ...(options.upload === null ? { unrestricted: true } : {}),
      },
    }, 'string');
  },
  /** A finalized-only media asset reference. The physical stored value stays
   * the opaque asset id; query/result lowering projects the distinguished
   * mediaRef.v1 value from the exact source cell. */
  // @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut —
  //   authoring preserves the exact media policy facts required by the
  //   semantic result node instead of disguising this as a plain assetRef.
  media: (options = {}) => {
    assertKnownSpecFields(
      options,
      'v.media() options',
      new Set(['intent', 'policy', 'kinds', 'delivery', 'variants']),
    );
    assert(
      typeof options.intent === 'string' && options.intent.length > 0,
      'v.media() intent must name an upload-intent binding',
    );
    assert(
      typeof options.policy === 'string' && options.policy.length > 0,
      'v.media() policy must name the attachment/read policy generation',
    );
    const admittedKinds = new Set(['image', 'video', 'audio', 'file']);
    assert(
      Array.isArray(options.kinds) && options.kinds.length > 0,
      'v.media() kinds must be a non-empty array',
    );
    const kinds = [];
    for (const kind of options.kinds) {
      assert(
        typeof kind === 'string' && admittedKinds.has(kind),
        `v.media() kinds contains unsupported kind ${String(kind)}`,
      );
      assert(!kinds.includes(kind), `v.media() kinds repeats ${kind}`);
      kinds.push(kind);
    }
    if (options.delivery !== undefined) {
      assert(
        typeof options.delivery === 'string' && options.delivery.length > 0,
        'v.media() delivery must be a non-empty delivery profile name',
      );
    }
    if (options.variants !== undefined) {
      assert(
        Array.isArray(options.variants)
          && options.variants.every((variant) => typeof variant === 'string' && variant.length > 0)
          && new Set(options.variants).size === options.variants.length,
        'v.media() variants must be an array of unique non-empty names',
      );
    }
    return validator({
      AssetRef: {
        upload: options.intent,
        media: {
          intent: options.intent,
          policy: options.policy,
          kinds,
          ...(options.delivery !== undefined ? { delivery: options.delivery } : {}),
          ...(options.variants !== undefined ? { variants: [...options.variants] } : {}),
          classificationProfile: 'detected-content-type.v1',
          retentionClass: 'media-reference.v1',
          targetCapability: 'assets.media-ref-projection.v1',
        },
      },
    }, 'string');
  },
  boolean: () => validator('Boolean', 'boolean'),
  integer: (options = {}) => {
    assertKnownSpecFields(options, 'v.integer() options', new Set(['min', 'max']));
    if (options.min !== undefined) assert(Number.isSafeInteger(options.min), 'v.integer() min must be a safe integer');
    if (options.max !== undefined) assert(Number.isSafeInteger(options.max), 'v.integer() max must be a safe integer');
    assert(options.min === undefined || options.max === undefined || options.min <= options.max, 'v.integer() min must not exceed max');
    return validator('Integer', 'number', {
      ...((options.min !== undefined || options.max !== undefined) ? { resultOptions: { ...options } } : {}),
    });
  },
  real: (options = {}) => {
    assertKnownSpecFields(options, 'v.real() options', new Set(['min', 'max']));
    return validator('Real', 'number', {
      ...((options.min !== undefined || options.max !== undefined) ? { resultOptions: { ...options } } : {}),
    });
  },
  number: (options = {}) => {
    assertKnownSpecFields(options, 'v.number() options', new Set(['min', 'max']));
    return validator('Real', 'number', {
      ...((options.min !== undefined || options.max !== undefined) ? { resultOptions: { ...options } } : {}),
    });
  },
  finiteReal: (options = {}) => {
    assertKnownSpecFields(options, 'v.finiteReal() options', new Set(['min', 'max']));
    return validator('Real', 'number', {
      resultOptions: { ...options },
    });
  },
  /** One fixed-dimension portable binary64 vector. The dedicated contract
   * node keeps ordinary arrays capped at 1,024 while D reaches 4,096.
   * @ref LLP 0132#the-vvectordimensions-value */
  vector: (dimensions) => {
    assert(
      Number.isSafeInteger(dimensions) && dimensions >= 1 && dimensions <= 4_096,
      'v.vector() dimensions must be an integer in 1..4096',
    );
    return validator({ Vector: { dimensions } }, 'vector', {
      resultKind: 'vector',
      dimensions,
    });
  },
  json: (options = {}) => {
    assertKnownSpecFields(options, 'v.json() options', new Set(['maxDepth', 'maxBytes']));
    return validator('Json', 'unknown', {
      ...((options.maxDepth !== undefined || options.maxBytes !== undefined)
        ? { resultOptions: { ...options } }
        : {}),
    });
  },
  null: () => validator('Json', 'null', { resultKind: 'null' }),
  literal: (value) => {
    assert(
      value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value)),
      'v.literal() expects a finite JSON scalar',
    );
    return validator('Json', typeof value, {
      resultKind: 'literal',
      literal: value,
    });
  },
  object: (fields) => {
    assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'v.object() expects a fields object');
    for (const [name, val] of Object.entries(fields)) {
      assert(val && val.__validator, `object field ${name} must be a validator`);
    }
    return { __validator: true, fieldType: 'Json', primitive: 'object', fields, optional: false };
  },
  optional: (inner) => {
    assert(inner && inner.__validator, 'v.optional() expects a validator');
    return { ...inner, optional: true };
  },
  array: (inner, options = {}) => {
    assert(inner && inner.__validator, 'v.array() expects a validator');
    assertKnownSpecFields(options, 'v.array() options', new Set(['maxItems']));
    if (options.maxItems !== undefined) {
      assert(Number.isSafeInteger(options.maxItems) && options.maxItems >= 0, 'v.array() maxItems must be a non-negative safe integer');
    }
    return validator('Json', 'array', {
      resultKind: 'array',
      element: inner,
      resultOptions: { ...options },
    });
  },
  tuple: (elements) => {
    assert(Array.isArray(elements) && elements.length >= 1 && elements.length <= 8, 'v.tuple() expects 1–8 validators');
    for (const element of elements) assert(element && element.__validator, 'v.tuple() entries must be validators');
    return validator('Json', 'array', {
      resultKind: 'tuple',
      elements: REFLECT_APPLY(ARRAY_SLICE, elements, []),
    });
  },
  union: (variants) => {
    assert(Array.isArray(variants) && variants.length >= 2 && variants.length <= 8, 'v.union() expects 2–8 validators');
    for (const variant of variants) assert(variant && variant.__validator, 'v.union() entries must be validators');
    return validator('Json', 'union', {
      resultKind: 'union',
      variants: REFLECT_APPLY(ARRAY_SLICE, variants, []),
    });
  },
};

export const results = Object.freeze({
  documents(table) {
    assert(typeof table === 'string' && table.length > 0, 'results.documents() expects a table name');
    return Object.freeze({ __resultContract: true, kind: 'documents', table });
  },
  records(recordValidator, options = {}) {
    assertKnownSpecFields(options, 'results.records() options', new Set(['minItems', 'maxItems']));
    assert(
      recordValidator?.__validator === true
        && (
          recordValidator.primitive === 'object'
          || recordValidator.primitive === 'appSchemaRef'
          || (
            recordValidator.resultKind === 'union'
            && recordValidator.variants.every(
              (variant) => variant.primitive === 'object' || variant.primitive === 'appSchemaRef',
            )
          )
        ),
      'results.records() expects v.object(...), v.doc(...), or a discriminated union of closed record variants',
    );
    const hasBounds = options.minItems !== undefined || options.maxItems !== undefined;
    if (hasBounds) {
      assert(
        Number.isSafeInteger(options.minItems)
          && Number.isSafeInteger(options.maxItems)
          && options.minItems >= 0
          && options.minItems <= options.maxItems
          && options.maxItems <= 1_024,
        'results.records() bounds require 0 <= minItems <= maxItems <= 1,024',
      );
    }
    return Object.freeze({
      __resultContract: true,
      kind: 'records',
      validator: recordValidator,
      ...(hasBounds ? { rows: Object.freeze({ ...options }) } : {}),
    });
  },
  document(table) {
    assert(typeof table === 'string' && table.length > 0, 'results.document() expects a table name');
    return Object.freeze({ __resultContract: true, kind: 'document', table });
  },
  value(valueValidator) {
    assert(valueValidator?.__validator === true, 'results.value() expects a validator');
    return Object.freeze({ __resultContract: true, kind: 'value', validator: valueValidator });
  },
});

// The only two resource references admitted by the membership predicate IR.
// An app-scoped declaration uses the host-owned singleton rather than an app
// argument; TableBuilder.memberOf()/hasRole() also infer this form when their
// resource argument is omitted.
export const membershipResource = Object.freeze({
  arg(path) {
    assert(typeof path === 'string' && path.length > 0, 'membershipResource.arg() expects a path');
    return Object.freeze({ __membershipResourceRef: true, kind: 'arg', path });
  },
  rowField(field) {
    assert(typeof field === 'string' && field.length > 0, 'membershipResource.rowField() expects a field');
    return Object.freeze({ __membershipResourceRef: true, kind: 'rowField', field });
  },
  app() {
    return Object.freeze({ __membershipResourceRef: true, kind: 'app' });
  },
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function exactObject(value, where, allowed, code = undefined) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${where} must be an object`, code);
  for (const field of Object.keys(value)) {
    assert(allowed.has(field), `${where} has unknown field ${field}`, code);
  }
}

function positiveBudgetInteger(value, where) {
  assert(Number.isSafeInteger(value) && value > 0, `${where} must be a positive safe integer`, 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  return value;
}

function normalizeAskBudgets(value) {
  exactObject(value, 'defineSchema api.budgets', new Set(['ask']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  if (value.ask === undefined) return {};
  const ask = value.ask;
  exactObject(ask, 'defineSchema api.budgets.ask', new Set([
    'perRequest', 'perPrincipalDay', 'perIntegrationDay', 'appMonthly', 'resultVolume',
  ]), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  const required = ['perRequest', 'perPrincipalDay', 'appMonthly', 'resultVolume'];
  for (const line of required) {
    assert(Object.hasOwn(ask, line), `defineSchema api.ask.enabled requires api.budgets.ask.${line}`, 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
  }
  exactObject(ask.perRequest, 'defineSchema api.budgets.ask.perRequest', new Set(['maxTokens', 'maxSteps', 'maxWallMs']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  for (const line of ['maxTokens', 'maxSteps', 'maxWallMs']) {
    assert(Object.hasOwn(ask.perRequest, line), `defineSchema api.ask.enabled requires api.budgets.ask.perRequest.${line}`, 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
  }
  exactObject(ask.perPrincipalDay, 'defineSchema api.budgets.ask.perPrincipalDay', new Set(['maxTokens']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  assert(Object.hasOwn(ask.perPrincipalDay, 'maxTokens'), 'defineSchema api.ask.enabled requires api.budgets.ask.perPrincipalDay.maxTokens', 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
  exactObject(ask.appMonthly, 'defineSchema api.budgets.ask.appMonthly', new Set(['maxTokens']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  assert(Object.hasOwn(ask.appMonthly, 'maxTokens'), 'defineSchema api.ask.enabled requires api.budgets.ask.appMonthly.maxTokens', 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
  exactObject(ask.resultVolume, 'defineSchema api.budgets.ask.resultVolume', new Set(['maxBytes', 'maxRows', 'perPrincipalDayBytes']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
  for (const line of ['maxBytes', 'maxRows', 'perPrincipalDayBytes']) {
    assert(Object.hasOwn(ask.resultVolume, line), `defineSchema api.ask.enabled requires api.budgets.ask.resultVolume.${line}`, 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
  }
  let perIntegrationDay;
  if (ask.perIntegrationDay !== undefined) {
    exactObject(ask.perIntegrationDay, 'defineSchema api.budgets.ask.perIntegrationDay', new Set(['maxTokens']), 'SNAPBACK_API_ASK_BUDGETS_INVALID');
    assert(Object.hasOwn(ask.perIntegrationDay, 'maxTokens'), 'defineSchema api.budgets.ask.perIntegrationDay requires maxTokens', 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
    perIntegrationDay = { maxTokens: positiveBudgetInteger(ask.perIntegrationDay.maxTokens, 'defineSchema api.budgets.ask.perIntegrationDay.maxTokens') };
  }
  return {
    ask: {
      perRequest: {
        maxTokens: positiveBudgetInteger(ask.perRequest.maxTokens, 'defineSchema api.budgets.ask.perRequest.maxTokens'),
        maxSteps: positiveBudgetInteger(ask.perRequest.maxSteps, 'defineSchema api.budgets.ask.perRequest.maxSteps'),
        maxWallMs: positiveBudgetInteger(ask.perRequest.maxWallMs, 'defineSchema api.budgets.ask.perRequest.maxWallMs'),
      },
      perPrincipalDay: { maxTokens: positiveBudgetInteger(ask.perPrincipalDay.maxTokens, 'defineSchema api.budgets.ask.perPrincipalDay.maxTokens') },
      ...(perIntegrationDay ? { perIntegrationDay } : {}),
      appMonthly: { maxTokens: positiveBudgetInteger(ask.appMonthly.maxTokens, 'defineSchema api.budgets.ask.appMonthly.maxTokens') },
      resultVolume: {
        maxBytes: positiveBudgetInteger(ask.resultVolume.maxBytes, 'defineSchema api.budgets.ask.resultVolume.maxBytes'),
        maxRows: positiveBudgetInteger(ask.resultVolume.maxRows, 'defineSchema api.budgets.ask.resultVolume.maxRows'),
        perPrincipalDayBytes: positiveBudgetInteger(ask.resultVolume.perPrincipalDayBytes, 'defineSchema api.budgets.ask.resultVolume.perPrincipalDayBytes'),
      },
    },
  };
}

function stringArray(value, where, { allowEmpty = false, code = undefined } = {}) {
  assert(Array.isArray(value), `${where} must be an array`, code);
  assert(allowEmpty || value.length > 0, `${where} must not be empty`, code);
  const seen = new Set();
  for (const item of value) {
    assert(typeof item === 'string' && item.length > 0, `${where} entries must be non-empty strings`, code);
    assert(!seen.has(item), `${where} repeats ${item}`, code);
    seen.add(item);
  }
  return REFLECT_APPLY(ARRAY_SLICE, value, []);
}

function normalizeMembership(spec) {
  exactObject(spec, 'membership()', MEMBERSHIP_FIELDS);
  const scope = spec.scope ?? 'resource';
  assert(scope === 'resource' || scope === 'app', 'membership() scope must be resource or app');
  assert(typeof spec.principal === 'string' && spec.principal.length > 0, 'membership() requires principal');
  assert(typeof spec.role === 'string' && spec.role.length > 0, 'membership() requires role');
  if (scope === 'resource') {
    assert(typeof spec.resource === 'string' && spec.resource.length > 0, 'resource membership() requires resource');
  } else {
    assert(spec.resource === undefined, 'app membership() cannot declare a resource field');
  }
  if (spec.id !== undefined) assert(typeof spec.id === 'string' && spec.id.length > 0, 'membership() id must be non-empty');
  const roles = stringArray(spec.roles, 'membership() roles');
  const pendingRoles = spec.pendingRoles === undefined
    ? undefined
    : stringArray(spec.pendingRoles, 'membership() pendingRoles');
  const vocabulary = new Set([...roles, ...(pendingRoles ?? [])]);
  assert(vocabulary.size === roles.length + (pendingRoles?.length ?? 0), 'membership() roles and pendingRoles must be disjoint');

  if (spec.bootstrapRole !== undefined) {
    assert(roles.includes(spec.bootstrapRole), 'membership() bootstrapRole must be a declared non-pending role');
  }
  let lastHolder;
  if (spec.lastHolder !== undefined) {
    exactObject(spec.lastHolder, 'membership() lastHolder', new Set(['protect']));
    assert(roles.includes(spec.lastHolder.protect), 'membership() lastHolder.protect must be a non-pending role');
    lastHolder = { protect: spec.lastHolder.protect };
  }
  let expiry;
  if (spec.expiry !== undefined) {
    exactObject(spec.expiry, 'membership() expiry', new Set(['field', 'onExpiry']));
    assert(typeof spec.expiry.field === 'string' && spec.expiry.field.length > 0, 'membership() expiry.field is required');
    assert(spec.expiry.onExpiry === 'remove', 'membership() expiry.onExpiry must be remove');
    expiry = { field: spec.expiry.field, onExpiry: 'remove' };
  }
  const incidental = spec.incidental === undefined
    ? undefined
    : stringArray(spec.incidental, 'membership() incidental');
  if (spec.provenance !== undefined) {
    assert(MEMBERSHIP_PROVENANCE.has(spec.provenance), 'membership() provenance must be creation or full');
  }

  const transitions = (spec.transitions ?? []).map((transition, index) => {
    const where = `membership() transitions[${index}]`;
    exactObject(transition, where, MEMBERSHIP_TRANSITION_FIELDS);
    assert(MEMBERSHIP_OPS.has(transition.op), `${where}.op is invalid`);
    assert(MEMBERSHIP_TARGETS.has(transition.target), `${where}.target must be self or other`);
    const by = stringArray(transition.by, `${where}.by`);
    for (const caller of by) {
      assert(caller === 'self' || caller === 'none' || vocabulary.has(caller), `${where}.by names undeclared class ${caller}`);
    }
    const from = transition.from === undefined ? undefined : stringArray(transition.from, `${where}.from`);
    const to = transition.to === undefined ? undefined : stringArray(transition.to, `${where}.to`);
    for (const role of [...(from ?? []), ...(to ?? [])]) {
      assert(vocabulary.has(role), `${where} names undeclared role ${role}`);
    }
    const fields = transition.fields === undefined ? undefined : stringArray(transition.fields, `${where}.fields`);
    if (transition.op === 'insert') {
      assert(from === undefined, `${where}.from is forbidden for insert`);
      assert(to !== undefined, `${where}.to is required for insert`);
      assert(!by.includes('self'), `${where}.by cannot name self for insert`);
    } else if (transition.op === 'setRole') {
      assert(to !== undefined, `${where}.to is required for setRole`);
      assert(fields === undefined, `${where}.fields is forbidden for setRole`);
      assert(!by.includes('none'), `${where}.by cannot name none for setRole`);
    } else if (transition.op === 'remove') {
      assert(to === undefined && fields === undefined, `${where} remove forbids to and fields`);
      assert(!by.includes('none'), `${where}.by cannot name none for remove`);
    } else {
      assert(to === undefined, `${where}.to is forbidden for patch`);
      assert(fields !== undefined, `${where}.fields is required for patch`);
      assert(!by.includes('none'), `${where}.by cannot name none for patch`);
    }
    return {
      op: transition.op,
      by,
      target: transition.target,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(fields ? { fields } : {}),
    };
  });

  // Principal-addressed writes (LLP 0100 §2): closed opt-in, and activation
  // requires at least one TOTAL other-principal removal transition — `from`
  // omitted (partial coverage would make removal a hidden-role oracle),
  // every carrier caller class a full non-pending role, and under lastHolder
  // exactly the protected role (an admitted caller is itself a protected
  // holder, so removal can never empty the protected set).
  let principalAddressedWrites;
  if (spec.principalAddressedWrites !== undefined) {
    exactObject(spec.principalAddressedWrites, 'membership() principalAddressedWrites', new Set(['remove']));
    assert(
      spec.principalAddressedWrites.remove === true,
      'membership() principalAddressedWrites admits only { remove: true } in v1',
    );
    const carriers = transitions.filter((transition) => (
      transition.op === 'remove' && transition.target === 'other' && transition.from === undefined
    ));
    assert(
      carriers.length > 0,
      'membership() principalAddressedWrites.remove requires at least one total other-principal '
        + 'removal transition ({ op: "remove", target: "other" } with from omitted)',
    );
    for (const carrier of carriers) {
      for (const caller of carrier.by) {
        assert(
          roles.includes(caller),
          `membership() principalAddressedWrites: carrier caller class ${caller} must be a full, non-pending declared role`,
        );
        if (lastHolder) {
          assert(
            caller === lastHolder.protect,
            `membership() principalAddressedWrites: carrier caller class ${caller} must be the lastHolder-protected role ${lastHolder.protect}`,
          );
        }
      }
    }
    principalAddressedWrites = { remove: true };
  }

  return {
    ...(spec.id !== undefined ? { id: spec.id } : {}),
    principal: spec.principal,
    ...(scope === 'resource' ? { resource: spec.resource } : {}),
    role: spec.role,
    roles,
    ...(pendingRoles ? { pendingRoles } : {}),
    ...(spec.bootstrapRole !== undefined ? { bootstrapRole: spec.bootstrapRole } : {}),
    ...(lastHolder ? { lastHolder } : {}),
    ...(expiry ? { expiry } : {}),
    ...(incidental ? { incidental } : {}),
    ...(spec.provenance !== undefined ? { provenance: spec.provenance } : {}),
    transitions,
    scope,
    ...(principalAddressedWrites ? { principalAddressedWrites } : {}),
  };
}

function normalizeAuthorityProfile(spec) {
  // Semantic validation deliberately happens in codegen, where every D1
  // refusal can carry the authored table span and a concrete repair. This
  // normalization only snapshots the closed facade input so later mutation
  // cannot change the evaluated definition behind codegen's back.
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  return {
    ...spec,
    ...(spec.hierarchy && typeof spec.hierarchy === 'object' && !Array.isArray(spec.hierarchy)
      ? { hierarchy: Object.fromEntries(Object.entries(spec.hierarchy).map(([role, implied]) => [
          role,
          Array.isArray(implied) ? REFLECT_APPLY(ARRAY_SLICE, implied, []) : implied,
        ])) }
      : {}),
    ...(spec.roster && typeof spec.roster === 'object' && !Array.isArray(spec.roster)
      ? {
          roster: {
            ...spec.roster,
            ...(Array.isArray(spec.roster.visible)
              ? { visible: REFLECT_APPLY(ARRAY_SLICE, spec.roster.visible, []) }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeTableVisibilityLeaf(
  spec,
  where,
  shapeCode = 'SNAPBACK_TABLE_VISIBILITY_SPEC_INVALID',
) {
  if (spec.kind === 'owner') {
    exactObject(
      spec,
      where,
      new Set(['kind', 'field']),
      shapeCode,
    );
    assert(
      typeof spec.field === 'string' && spec.field.length > 0,
      `${where} owner requires a non-empty field`,
      'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_INVALID',
    );
    return { kind: 'owner', field: spec.field };
  }
  exactObject(
    spec,
    where,
    new Set(['kind', 'declaration', 'resourceField', 'roles']),
    shapeCode,
  );
  const declaration = typeof spec.declaration === 'string'
    ? spec.declaration
    : spec.declaration?.__table === true
      ? spec.declaration.membershipDeclaration?.id ?? spec.declaration.__tableName
      : null;
  assert(
    typeof declaration === 'string' && declaration.length > 0,
    `${where} membership declaration must be a non-empty membership declaration id or a membership() object carrying an id`,
    'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_INVALID',
  );
  assert(
    typeof spec.resourceField === 'string' && spec.resourceField.length > 0,
    `${where} membership requires a non-empty resourceField`,
    'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_INVALID',
  );
  const roles = spec.roles === undefined
    ? undefined
    : stringArray(spec.roles, `${where} membership roles`, {
        code: 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID',
      });
  return {
    kind: 'membership',
    declaration,
    resourceField: spec.resourceField,
    ...(roles ? { roles } : {}),
  };
}

class TableBuilder {
  constructor(fields) {
    this[TABLE] = true;
    this.__table = true;
    this.fields = fields;
    this.indexes = [];
    this.searchIndexes = [];
    this.vectorIndexes = [];
    this.syncable = false;
  }

  _assertDataTerminal(method) {
    assert(
      this.dataDeclaration === undefined,
      `.data(...) is terminal; ${method}() cannot follow it`,
      'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
    );
  }

  /** @ref LLP 0007#index-contract — uniqueness is part of the portable index
   *  declaration, not a handler convention. */
  index(name, fields, options = {}) {
    this._assertDataTerminal('index');
    assert(Array.isArray(fields) && fields.length > 0, `index ${name} needs fields`);
    assert(new Set(fields).size === fields.length, `index ${name} fields must not contain duplicates`);
    assertKnownSpecFields(options, `index ${name} options`, new Set(['unique']));
    const unique = options.unique ?? false;
    assert(typeof unique === 'boolean', `index ${name} unique must be boolean`);
    this.indexes.push({ name, fields: REFLECT_APPLY(ARRAY_SLICE, fields, []), unique });
    return this;
  }

  /**
   * Declare the portable, synchronously maintained full-text-search-v1
   * profile. The generated manifest binds every semantic constant; authors
   * choose only source fields, weights, release visibility, and lower limits.
   *
   * @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — search
   * declarations compile to SearchIndexManifestV1, never backend query text.
   */
  searchIndex(name, spec) {
    this._assertDataTerminal('searchIndex');
    assert(typeof name === 'string' && name.length > 0, 'searchIndex() requires a name');
    assertKnownSpecFields(spec, `search index ${name}`, SEARCH_INDEX_SPEC_FIELDS);
    assert(typeof spec.semanticVersion === 'string' && spec.semanticVersion.length > 0, `search index ${name} semanticVersion is required`);
    assert(spec.textFields && typeof spec.textFields === 'object' && !Array.isArray(spec.textFields), `search index ${name} textFields must be an object`);
    const textFields = {};
    for (const [field, declaration] of Object.entries(spec.textFields)) {
      assertKnownSpecFields(declaration, `search index ${name} text field ${field}`, SEARCH_TEXT_FIELD_SPEC_FIELDS);
      assert(Number.isSafeInteger(declaration.weight) && declaration.weight >= 1 && declaration.weight <= 64, `search index ${name} text field ${field} weight must be 1..64`);
      assert(declaration.classification !== undefined, `search index ${name} text field ${field} classification is required`);
      const classification = declaration.classification;
      assert(SEARCH_FIELD_CLASSIFICATIONS.has(classification), `search index ${name} text field ${field} has unknown classification`);
      textFields[field] = { weight: declaration.weight, classification };
    }
    assert(Object.keys(textFields).length >= 1 && Object.keys(textFields).length <= 16, `search index ${name} requires 1..16 text fields`);
    const stringSet = (value, label) => {
      const fields = value ?? [];
      assert(Array.isArray(fields), `search index ${name} ${label} must be an array`);
      assert(fields.every((field) => typeof field === 'string' && field.length > 0), `search index ${name} ${label} must contain field names`);
      assert(new Set(fields).size === fields.length, `search index ${name} ${label} must not contain duplicates`);
      return [...fields].sort();
    };
    // @ref LLP 0073#search-declarations — public release is an affirmative
    // author decision; omission must never widen an index to public-read.
    assert(
      spec.visibility !== undefined,
      `search index ${name} requires explicit visibility; use { kind: 'public-read' } only for intentionally public data`,
      'SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED',
    );
    const authoredVisibility = spec.visibility;
    assert(authoredVisibility && typeof authoredVisibility === 'object' && !Array.isArray(authoredVisibility), `search index ${name} visibility is required`);
    let visibility;
    if (authoredVisibility.kind === 'public-read') {
      exactObject(authoredVisibility, `search index ${name} public-read visibility`, new Set(['kind']));
      visibility = { kind: 'public-read' };
    } else if (authoredVisibility.kind === 'owner') {
      exactObject(authoredVisibility, `search index ${name} owner visibility`, new Set(['kind', 'field']));
      assert(typeof authoredVisibility.field === 'string' && authoredVisibility.field.length > 0, `search index ${name} owner visibility requires a non-empty field`);
      visibility = { kind: 'owner', field: authoredVisibility.field };
    } else if (authoredVisibility.kind === 'membership') {
      // @ref LLP 0073#the-third-visibility-variant — membership visibility is
      // a closed declaration-id/resource-field/roles record. A membership()
      // table builder is accepted only when it already carries a stable id;
      // the retained manifest shape never contains the authoring object.
      exactObject(
        authoredVisibility,
        `search index ${name} membership visibility`,
        new Set(['kind', 'declaration', 'resourceField', 'roles']),
      );
      const declaration = typeof authoredVisibility.declaration === 'string'
        ? authoredVisibility.declaration
        : authoredVisibility.declaration?.__table === true
          ? authoredVisibility.declaration.membershipDeclaration?.id
            ?? authoredVisibility.declaration.__tableName
          : null;
      assert(
        typeof declaration === 'string' && declaration.length > 0,
        `search index ${name} membership visibility declaration must be a non-empty membership declaration id or a membership() object carrying an id`,
      );
      assert(
        typeof authoredVisibility.resourceField === 'string'
          && authoredVisibility.resourceField.length > 0,
        `search index ${name} membership visibility requires a non-empty resourceField`,
      );
      const roles = authoredVisibility.roles === undefined
        ? undefined
        : stringArray(authoredVisibility.roles, `search index ${name} membership visibility roles`);
      visibility = {
        kind: 'membership',
        declaration,
        resourceField: authoredVisibility.resourceField,
        ...(roles ? { roles } : {}),
      };
    } else {
      assert(
        false,
        `search index ${name} visibility must be { kind: 'public-read' }, { kind: 'owner', field }, or { kind: 'membership', declaration, resourceField, roles? }`,
      );
    }
    const equalityFilters = stringSet(spec.equalityFilters, 'equalityFilters');
    const storedFields = stringSet(spec.storedFields, 'storedFields');
    const highlightFields = stringSet(spec.highlightFields, 'highlightFields');
    const fieldClassifications = spec.fieldClassifications ?? {};
    assert(
      fieldClassifications
        && typeof fieldClassifications === 'object'
        && !Array.isArray(fieldClassifications),
      `search index ${name} fieldClassifications must be an object`,
    );
    for (const [field, classification] of Object.entries(fieldClassifications)) {
      assert(
        SEARCH_FIELD_CLASSIFICATIONS.has(classification),
        `search index ${name} field ${field} has unknown classification`,
      );
    }
    assert(
      highlightFields.every((field) => Object.hasOwn(textFields, field)),
      `search index ${name} highlightFields must be declared text fields`,
    );
    const lowerLimits = (value, label, defaults, maxima, allowed) => {
      const authored = value ?? {};
      assertKnownSpecFields(authored, `search index ${name} ${label}`, allowed);
      const resolved = { ...defaults, ...authored };
      for (const [field, maximum] of Object.entries(maxima)) {
        assert(
          Number.isSafeInteger(resolved[field])
            && resolved[field] >= 1
            && resolved[field] <= maximum,
          `search index ${name} ${label}.${field} must be an integer in 1..${maximum}`,
        );
      }
      return resolved;
    };
    const sourceLimits = lowerLimits(
      spec.sourceLimits,
      'sourceLimits',
      { maxIndexedBytes: 32 * 1024, maxTokens: 2_048, maxPostingOperations: 4_096 },
      { maxIndexedBytes: 32 * 1024, maxTokens: 2_048, maxPostingOperations: 4_096 },
      SEARCH_SOURCE_LIMIT_FIELDS,
    );
    const queryLimits = lowerLimits(
      spec.queryLimits,
      'queryLimits',
      { maxCandidateWork: 10_000, maxPrefixTerms: 256, minPrefixScalars: 2 },
      { maxCandidateWork: 10_000, maxPrefixTerms: 256, minPrefixScalars: 64 },
      SEARCH_QUERY_LIMIT_FIELDS,
    );
    const authoredCursorLimits = spec.cursorLimits ?? {};
    assertKnownSpecFields(authoredCursorLimits, `search index ${name} cursorLimits`, SEARCH_CURSOR_LIMIT_FIELDS);
    const cursorLimits = { ttlMs: 120_000, maxBytes: 2_048, ...authoredCursorLimits };
    assert(
      cursorLimits.ttlMs === 120_000 && cursorLimits.maxBytes === 2_048,
      `search index ${name} cursorLimits are fixed at { ttlMs: 120000, maxBytes: 2048 } in v1`,
    );
    const maintenanceLimits = lowerLimits(
      spec.maintenanceLimits,
      'maintenanceLimits',
      {
        searchMaintenanceEffects: 1_024,
        searchPostingOps: 4_096,
        searchPositions: 8_192,
        searchBytes: 256 * 1024,
      },
      {
        searchMaintenanceEffects: 1_024,
        searchPostingOps: 4_096,
        searchPositions: 8_192,
        searchBytes: 256 * 1024,
      },
      SEARCH_MAINTENANCE_LIMIT_FIELDS,
    );
    let liveLimits;
    if (spec.liveLimits !== undefined) {
      // @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal
      // — live-search ceilings are a closed optional sibling of the ordinary
      // search limits. Presence requires the dedicated capability; it never
      // inherits support from full_text_search_v1 + live_subscriptions.
      liveLimits = lowerLimits(
        spec.liveLimits,
        'liveLimits',
        { maxLiveSubscriptions: 64, maxLiveSubscriptionsPerConnection: 8 },
        { maxLiveSubscriptions: 64, maxLiveSubscriptionsPerConnection: 8 },
        SEARCH_LIVE_LIMIT_FIELDS,
      );
    }
    this.searchIndexes.push({
      formatVersion: 1,
      name,
      semanticVersion: spec.semanticVersion,
      analyzer: 'snapback-category-unicode17-v1',
      analyzerTablesDigest: 'sha256:67feb427579c6f3f9d601d93251c19cb18b15ab13cf46e7f33d285c3ff10181d',
      textFields,
      fieldClassifications: Object.fromEntries(
        Object.entries(fieldClassifications).sort(([left], [right]) => (
          left < right ? -1 : left > right ? 1 : 0
        )),
      ),
      equalityFilters,
      storedFields,
      highlightFields,
      visibility,
      tieBreak: 'score-desc-row-id-asc.v1',
      sourceLimits,
      queryLimits,
      cursorLimits,
      maintenanceLimits,
      ...(liveLimits ? { liveLimits } : {}),
    });
    return this;
  }

  /** Declare one exact, synchronous vector-search-v1 index. Work and
   * maintenance ceilings are derived/fixed facts, never author knobs.
   * @ref LLP 0132#index-declarations */
  vectorIndex(name, spec) {
    this._assertDataTerminal('vectorIndex');
    assert(typeof name === 'string' && name.length > 0, 'vectorIndex() requires a name');
    assertKnownSpecFields(spec, `vector index ${name}`, VECTOR_INDEX_SPEC_FIELDS);
    assert(typeof spec.semanticVersion === 'string' && spec.semanticVersion.length > 0, `vector index ${name} semanticVersion is required`);
    assert(typeof spec.vectorField === 'string' && spec.vectorField.length > 0, `vector index ${name} vectorField is required`);
    const vector = this.fields[spec.vectorField];
    const dimensions = vector?.fieldType?.Vector?.dimensions;
    assert(Number.isSafeInteger(dimensions) && !vector.optional, `vector index ${name} vectorField must name a required v.vector() field`);
    assert(spec.metric === 'l2sq' || spec.metric === 'dot', `vector index ${name} metric must be l2sq or dot`);
    const stringSet = (value, label) => {
      const fields = value ?? [];
      assert(Array.isArray(fields), `vector index ${name} ${label} must be an array`);
      assert(fields.every((field) => typeof field === 'string' && field.length > 0), `vector index ${name} ${label} must contain field names`);
      assert(new Set(fields).size === fields.length, `vector index ${name} ${label} must not contain duplicates`);
      return [...fields];
    };
    const equalityFilters = stringSet(spec.equalityFilters, 'equalityFilters');
    const storedFields = stringSet(spec.storedFields, 'storedFields');
    assert(equalityFilters.length <= 8, `vector index ${name} admits at most eight equality filters`);
    for (const field of equalityFilters) {
      const fieldType = this.fields[field]?.fieldType;
      const stringLike = fieldType === 'String'
        || fieldType === 'Principal'
        || (fieldType !== null
          && typeof fieldType === 'object'
          && !Array.isArray(fieldType)
          && (Object.hasOwn(fieldType, 'Enum')
            || Object.hasOwn(fieldType, 'Id')
            || Object.hasOwn(fieldType, 'AssetRef')));
      assert(
        stringLike || fieldType === 'Boolean' || fieldType === 'Integer',
        `vector index ${name} equality filter ${field} must use LLP 0080 portable exact scalar equality`,
      );
    }
    for (const field of storedFields) {
      assert(!this.fields[field]?.fieldType?.Vector, `vector index ${name} storedFields must not expose vector field ${field}`);
    }
    const classifications = spec.fieldClassifications;
    assert(classifications && typeof classifications === 'object' && !Array.isArray(classifications), `vector index ${name} fieldClassifications is required`);
    for (const [field, classification] of Object.entries(classifications)) {
      assert(typeof field === 'string' && field.length > 0 && SEARCH_FIELD_CLASSIFICATIONS.has(classification), `vector index ${name} field ${field} has unknown classification`);
    }
    // @ref LLP 0132#index-declarations — public release is an affirmative
    // author decision; omission must never widen an index to public-read.
    assert(
      spec.visibility !== undefined,
      `vector index ${name} requires explicit visibility; use { kind: 'public-read' } only for intentionally public data`,
      'SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED',
    );
    const authoredVisibility = spec.visibility;
    let visibility;
    if (authoredVisibility.kind === 'public-read') {
      exactObject(authoredVisibility, `vector index ${name} public-read visibility`, new Set(['kind']));
      visibility = { kind: 'public-read' };
    } else if (authoredVisibility.kind === 'owner') {
      exactObject(authoredVisibility, `vector index ${name} owner visibility`, new Set(['kind', 'field']));
      assert(typeof authoredVisibility.field === 'string' && authoredVisibility.field.length > 0, `vector index ${name} owner visibility requires field`);
      visibility = { kind: 'owner', field: authoredVisibility.field };
    } else {
      assert(false, `vector index ${name} visibility must be public-read or owner`);
    }
    const participating = new Set([
      spec.vectorField,
      ...equalityFilters,
      ...storedFields,
      ...(visibility.kind === 'owner' ? [visibility.field] : []),
    ]);
    assert(
      JSON.stringify([...participating].sort()) === JSON.stringify(Object.keys(classifications).sort()),
      `vector index ${name} fieldClassifications must name exactly every participating field`,
    );
    for (const [field, classification] of Object.entries(classifications)) {
      assert(classification !== 'sensitive' && classification !== 'forbidden', `vector index ${name} cannot participate with ${classification} field ${field}`);
      assert(visibility.kind !== 'public-read' || classification === 'public', `public vector index ${name} admits only public fields`);
    }
    const tieBreak = spec.tieBreak ?? 'id-asc';
    assert(tieBreak === 'id-asc' || tieBreak === 'id-desc', `vector index ${name} tieBreak must be id-asc or id-desc`);
    const corpus = spec.maxIndexedVectorsPerPartition;
    assert(Number.isSafeInteger(corpus) && corpus >= 1 && corpus <= 65_536, `vector index ${name} maxIndexedVectorsPerPartition must be 1..65536`);
    const maxScalarPairs = dimensions * corpus;
    assert(maxScalarPairs <= 2 ** 26, `vector index ${name} dimensions × corpus exceeds 2^26 scalar pairs`);
    this.vectorIndexes.push({
      formatVersion: 1,
      name,
      semanticVersion: spec.semanticVersion,
      vectorField: spec.vectorField,
      dimensions,
      metric: spec.metric,
      distanceProfile: 'snapback-vector-distance-v1',
      orderingProfile: 'nearest-first-row-id.v1',
      fieldClassifications: Object.fromEntries(Object.entries(classifications).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
      equalityFilters,
      storedFields,
      visibility,
      tieBreak,
      maxIndexedVectorsPerPartition: corpus,
      maxScalarPairs,
      maintenanceLimits: {
        vectorMaintenanceEffects: 1_024,
        vectorBytes: 4 * 1024 * 1024,
      },
    });
    return this;
  }

  /** Declare the one table-wide aggregate live-search subscription ceiling.
   * @ref LLP 0136#capability-id-and-claim-discipline-llp-0119-oq2-proposal */
  searchLiveLimits(spec = {}) {
    this._assertDataTerminal('searchLiveLimits');
    assert(
      this.searchLiveLimitsDeclaration === undefined,
      'searchLiveLimits() may be declared only once per table',
    );
    assertKnownSpecFields(spec, 'searchLiveLimits()', SEARCH_TABLE_LIVE_LIMIT_FIELDS);
    const resolved = { maxLiveSubscriptionsPerTable: 128, ...spec };
    assert(
      Number.isSafeInteger(resolved.maxLiveSubscriptionsPerTable)
        && resolved.maxLiveSubscriptionsPerTable >= 1
        && resolved.maxLiveSubscriptionsPerTable <= 128,
      'searchLiveLimits() maxLiveSubscriptionsPerTable must be an integer in 1..128',
    );
    this.searchLiveLimitsDeclaration = resolved;
    return this;
  }

  /** @ref LLP 0004#relationship-to-sync-and-realtime — only declared-syncable
   *  tables back the restricted syncable-live subset. */
  sync() {
    this._assertDataTerminal('sync');
    this.syncable = true;
    this.syncSource = 'authored';
    return this;
  }

  /**
   * Mark this table for the closed DataResourceV1 generated surface. This is
   * intentionally terminal: every fact used by the lowerer is fixed before
   * the declaration is recorded, and the returned TypeScript surface exposes
   * no further table-builder methods.
   *
   * @ref LLP 0255#s1-exact-data-resource-authoring-grammar
   */
  data(spec = {}) {
    assert(
      this.dataDeclaration === undefined,
      '.data(...) may be declared only once per table',
      'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
    );
    assertKnownSpecFields(
      spec,
      '.data(...)',
      DATA_RESOURCE_SPEC_FIELDS,
      'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
    );
    const normalizeDefaults = (value, where) => {
      if (value === undefined) return undefined;
      assert(
        value && typeof value === 'object' && !Array.isArray(value),
        `.data(...) ${where} must be an object`,
        'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
      );
      return Object.fromEntries(Object.entries(value));
    };
    if (spec.listIndex !== undefined) {
      assert(
        typeof spec.listIndex === 'string' && spec.listIndex.length > 0,
        '.data(...) listIndex must be a non-empty index name',
        'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
      );
    }
    if (spec.immutable !== undefined) {
      assert(
        Array.isArray(spec.immutable)
          && spec.immutable.every((field) => typeof field === 'string' && field.length > 0)
          && new Set(spec.immutable).size === spec.immutable.length,
        '.data(...) immutable must be an array of distinct field names',
        'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID',
      );
    }
    this.dataDeclaration = Object.freeze({
      ...(spec.listIndex === undefined ? {} : { listIndex: spec.listIndex }),
      ...(spec.createDefaults === undefined
        ? {}
        : { createDefaults: Object.freeze(normalizeDefaults(spec.createDefaults, 'createDefaults')) }),
      ...(spec.updateDefaults === undefined
        ? {}
        : { updateDefaults: Object.freeze(normalizeDefaults(spec.updateDefaults, 'updateDefaults')) }),
      ...(spec.immutable === undefined
        ? {}
        : { immutable: Object.freeze([...spec.immutable]) }),
    });
    return this;
  }

  /** Declare finite retained record history for this table. The declaration
   * is projected into storage atomically with schema publication; there is no
   * unbounded v1 spelling.
   * @ref LLP 0162#6-bounded-history-and-named-checkpoints */
  history(spec) {
    this._assertDataTerminal('history');
    assert(this.historyDeclaration === undefined, 'history() may be declared only once per table');
    exactObject(spec, 'history()', new Set(['retainMs', 'maxVersionsPerRecord']));
    assert(
      Number.isSafeInteger(spec.retainMs) && spec.retainMs >= 1 && spec.retainMs <= 2_592_000_000,
      'history() retainMs must be an integer in 1..2592000000',
    );
    assert(
      Number.isSafeInteger(spec.maxVersionsPerRecord)
        && spec.maxVersionsPerRecord >= 1
        && spec.maxVersionsPerRecord <= 1_000,
      'history() maxVersionsPerRecord must be an integer in 1..1000',
    );
    this.historyDeclaration = {
      retainMs: spec.retainMs,
      maxVersionsPerRecord: spec.maxVersionsPerRecord,
    };
    return this;
  }

  /** Declare that this table contains authorization-granting facts. An
   * optional field list narrows only known updates; insert/delete and unknown
   * changed-field sets remain conservative.
   * @ref LLP 0053#two-orthogonal-declarations — permission backing is the
   *   independent authorization-dependence axis. */
  permissionBacking(fields) {
    this._assertDataTerminal('permissionBacking');
    assert(!this.permissionBackingDeclared, 'permissionBacking() may be declared only once per table');
    assert(!this.membershipDeclaration, 'permissionBacking() cannot be combined with membership()');
    if (fields !== undefined) {
      assert(Array.isArray(fields), 'permissionBacking() fields must be an array');
      for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        assert(typeof field === 'string', 'permissionBacking() fields must be strings');
      }
      this.permissionFields = REFLECT_APPLY(ARRAY_SLICE, fields, []);
    }
    this.permissionBackingDeclared = true;
    return this;
  }

  /** Declare this table as the closed role-per-resource authority primitive.
   * The resource table is derived later from the resource field's v.id(...)
   * validator, never repeated as an unverified string in this object.
   * @ref LLP 0056#declaring-a-membership-table — one declaration owns the
   * permission-backing derivation and its generated indexes. */
  membership(spec) {
    this._assertDataTerminal('membership');
    assert(!this.membershipDeclaration, 'membership() may be declared only once per table');
    assert(!this.permissionBackingDeclared, 'membership() cannot be combined with permissionBacking()');
    this.membershipDeclaration = normalizeMembership(spec);
    return this;
  }

  /** Decorate this table's canonical membership declaration with the closed
   * application-owned authority-profile facade. The facade adds no writer or
   * evaluator: codegen validates it against, and lowers it back into, the
   * existing membership and table-visibility IR.
   *
   * @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
   *   — one app table remains the roster and authority source of truth.
   * @ref LLP 0240#d2-compile-one-authority-ir-for-read-and-write-decisions
   *   — hierarchy sugar is a codegen projection over canonical membership.
   */
  authorityProfile(spec) {
    this._assertDataTerminal('authorityProfile');
    if (!this.authorityProfileDeclarations) this.authorityProfileDeclarations = [];
    this.authorityProfileDeclarations.push({
      afterMembership: this.membershipDeclaration !== undefined,
      spec: normalizeAuthorityProfile(spec),
    });
    return this;
  }

  _membershipPredicate(resource, roles) {
    assert(this.membershipDeclaration, 'memberOf()/hasRole() requires membership()');
    const declaration = this.membershipDeclaration.id ?? this.__tableName;
    assert(declaration, 'membership helper table must be installed in defineSchema() before use');
    let reference = resource;
    if (this.membershipDeclaration.scope === 'app' && reference === undefined) {
      reference = membershipResource.app();
    }
    assert(reference?.__membershipResourceRef === true, 'membership helper expects membershipResource.arg(), rowField(), or app()');
    assert(
      this.membershipDeclaration.scope === 'app' ? reference.kind === 'app' : reference.kind !== 'app',
      `membership helper resource does not match ${this.membershipDeclaration.scope} scope`,
    );
    return Object.freeze({
      __membershipPredicate: true,
      declaration,
      resource: reference,
      roles,
    });
  }

  /** Declare this table's default row-visibility policy. The declaration is
   * independent of assetSharing(): this slice records policy authority but
   * does not unify the two consumers.
   *
   * @ref LLP 0231#d1--the-table-is-the-policy-locus-queries-refine — every
   *   table policy has one explicit, reviewable declaration locus. */
  visibility(spec) {
    this._assertDataTerminal('visibility');
    assert(
      !this.visibilityDeclaration,
      'visibility() may be declared only once per table',
      'SNAPBACK_TABLE_VISIBILITY_ALREADY_DECLARED',
    );
    assert(
      spec && typeof spec === 'object' && !Array.isArray(spec),
      'visibility() expects a spec object',
      'SNAPBACK_TABLE_VISIBILITY_SPEC_INVALID',
    );
    assert(
      TABLE_VISIBILITY_KINDS.has(spec.kind),
      "visibility() kind must be 'public-read', 'owner', 'membership', or 'any-of'",
      'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID',
    );
    if (spec.kind === 'any-of') {
      exactObject(
        spec,
        'visibility()',
        new Set(['kind', 'arms']),
        'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID',
      );
      assert(
        Array.isArray(spec.arms) && spec.arms.length >= 2 && spec.arms.length <= 8,
        'visibility() any-of requires 2..8 arms',
        'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID',
      );
      const seen = new Set();
      const arms = spec.arms.map((arm, index) => {
        assert(
          arm && typeof arm === 'object' && !Array.isArray(arm),
          `visibility() any-of arm ${index} must be an owner or membership object`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID',
        );
        assert(
          arm.kind !== 'any-of',
          `visibility() any-of arm ${index} cannot be nested`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_NESTED',
        );
        assert(
          arm.kind !== 'public-read',
          `visibility() any-of arm ${index} cannot be public-read; declare public-read at the table locus instead`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_PUBLIC_READ_ARM',
        );
        assert(
          arm.kind === 'owner' || arm.kind === 'membership',
          `visibility() any-of arm ${index} must be owner or membership`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID',
        );
        const normalized = normalizeTableVisibilityLeaf(
          arm,
          `visibility() any-of arm ${index}`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARM_INVALID',
        );
        const identity = JSON.stringify(normalized);
        assert(
          !seen.has(identity),
          `visibility() any-of repeats arm ${index}`,
          'SNAPBACK_TABLE_VISIBILITY_ANY_OF_DUPLICATE_ARM',
        );
        seen.add(identity);
        return normalized;
      });
      this.visibilityDeclaration = { kind: 'any-of', arms };
    } else if (spec.kind === 'public-read') {
      exactObject(
        spec,
        'visibility()',
        new Set(['kind']),
        'SNAPBACK_TABLE_VISIBILITY_SPEC_INVALID',
      );
      this.visibilityDeclaration = { kind: 'public-read' };
    } else if (spec.kind === 'owner') {
      this.visibilityDeclaration = normalizeTableVisibilityLeaf(spec, 'visibility()');
    } else {
      this.visibilityDeclaration = normalizeTableVisibilityLeaf(spec, 'visibility()');
    }
    return this;
  }

  /** Declare this table's analyzable row-visibility policy sufficient for
   * asset sharing: anyone the spec admits may also read assets referenced
   * from these rows, independent of any function-level gate a query adds.
   * Without this declaration a typed reference confers no `via-references`
   * read authority (owner-only fallback).
   * @ref LLP 0044#asset-read-authorization — sharing authority is an
   *   explicit app-authored statement, never inferred from a filter's
   *   existence, because a row filter alone can be broader than any query
   *   path actually exposes. */
  assetSharing(spec) {
    this._assertDataTerminal('assetSharing');
    assert(!this.assetSharingDeclaration, 'assetSharing() may be declared only once per table');
    assert(spec && typeof spec === 'object' && !Array.isArray(spec), 'assetSharing() expects a spec object');
    assert(ASSET_SHARING_KINDS.has(spec.kind), "assetSharing() kind must be 'public-read', 'owner', or 'membership'");
    if (spec.kind === 'public-read') {
      exactObject(spec, 'assetSharing()', new Set(['kind']));
      this.assetSharingDeclaration = { kind: 'public-read' };
    } else if (spec.kind === 'owner') {
      exactObject(spec, 'assetSharing()', new Set(['kind', 'field']));
      assert(typeof spec.field === 'string' && spec.field.length > 0, 'assetSharing() owner requires field');
      this.assetSharingDeclaration = { kind: 'owner', field: spec.field };
    } else {
      exactObject(spec, 'assetSharing()', new Set(['kind', 'membership', 'roles']));
      assert(
        typeof spec.membership === 'string' && spec.membership.length > 0,
        'assetSharing() membership requires a declared membership id',
      );
      const roles = spec.roles === undefined ? undefined : stringArray(spec.roles, 'assetSharing() roles');
      this.assetSharingDeclaration = {
        kind: 'membership',
        membership: spec.membership,
        ...(roles ? { roles } : {}),
      };
    }
    return this;
  }

  memberOf(resource) {
    return this._membershipPredicate(resource, null);
  }

  hasRole(resource, ...roles) {
    assert(this.membershipDeclaration, 'hasRole() requires membership()');
    if (this.membershipDeclaration?.scope === 'app' && typeof resource === 'string') {
      roles.unshift(resource);
      resource = undefined;
    }
    const normalized = stringArray(roles, 'hasRole() roles');
    const vocabulary = new Set([
      ...this.membershipDeclaration.roles,
      ...(this.membershipDeclaration.pendingRoles ?? []),
    ]);
    for (const role of normalized) assert(vocabulary.has(role), `hasRole() names undeclared role ${role}`);
    return this._membershipPredicate(resource, normalized);
  }
}

export function defineTable(fields) {
  assert(fields && typeof fields === 'object', 'defineTable expects a fields object');
  for (const [name, val] of Object.entries(fields)) {
    assert(val && val.__validator, `field ${name} must be a validator (v.string(), ...)`);
  }
  return new TableBuilder(fields);
}

const PUSH_AUDIENCE_REF = Symbol('snapback.pushAudienceRef');

const pushMembershipReference = (value, where) => {
  assert(
    value?.__table === true && value.membershipDeclaration != null,
    `${where}.membership must be a table with membership(...)`,
  );
  return value;
};

const pushMembershipClause = (spec, where, { allowSystem = false } = {}) => {
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), `${where} must be an object`);
  if (allowSystem && spec.system === true) {
    exactObject(spec, where, new Set(['system']));
    return { kind: 'system' };
  }
  exactObject(spec, where, new Set(['membership', 'resourceArg', 'roles']));
  const membership = pushMembershipReference(spec.membership, where);
  const declaration = membership.membershipDeclaration;
  const resourceArg = spec.resourceArg ?? null;
  if (declaration.scope === 'resource') {
    assert(
      typeof resourceArg === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(resourceArg),
      `${where}.resourceArg is required for resource membership`,
    );
  } else {
    assert(resourceArg === null, `${where}.resourceArg is forbidden for app membership`);
  }
  const roles = stringArray(spec.roles, `${where}.roles`);
  const vocabulary = new Set([
    ...declaration.roles,
    ...(declaration.pendingRoles ?? []),
  ]);
  for (const role of roles) assert(vocabulary.has(role), `${where}.roles names undeclared role ${role}`);
  return { kind: 'membership', membership, resourceArg, roles };
};

const pushResolverClause = (spec, where) => {
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), `${where} must be an object`);
  if (spec.principalsArg !== undefined || spec.maxItems !== undefined) {
    exactObject(spec, where, new Set(['principalsArg', 'maxItems']));
    assert(
      typeof spec.principalsArg === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(spec.principalsArg),
      `${where}.principalsArg is invalid`,
    );
    assert(
      Number.isSafeInteger(spec.maxItems) && spec.maxItems >= 1 && spec.maxItems <= 1_000,
      `${where}.maxItems must be between 1 and 1,000`,
    );
    return { kind: 'explicitPrincipals', principalsArg: spec.principalsArg, maxItems: spec.maxItems };
  }
  return pushMembershipClause(spec, where);
};

const serializePushMembershipClause = (clause, tables, where) => {
  if (clause.kind === 'system') return { kind: 'system' };
  if (clause.kind === 'explicitPrincipals') {
    return { kind: 'explicitPrincipals', principalsArg: clause.principalsArg, maxItems: clause.maxItems };
  }
  const table = clause.membership;
  assert(
    typeof table.__tableName === 'string' && tables[table.__tableName] === table,
    `${where}.membership must be installed in this defineSchema()`,
  );
  return {
    kind: 'membership',
    declaration: table.membershipDeclaration.id ?? table.__tableName,
    ...(clause.resourceArg === null ? {} : { resourceArg: clause.resourceArg }),
    roles: [...clause.roles],
  };
};

/**
 * Declare the Expo push seam. Audience references are generated functions;
 * handlers can address only a named declaration plus its bounded argument
 * object, never token bytes or an arbitrary recipient list.
 *
 * @ref LLP 0143#d2-the-send-lane — membership resolution and its
 * authorize clause are declaration-bound and host enforced.
 */
export function definePushSeam(spec) {
  exactObject(spec, 'definePushSeam', new Set(['appScope', 'registry', 'audiences', 'uses', 'ledger']));
  exactObject(spec.appScope, 'definePushSeam appScope', new Set([
    'easProjectId', 'applicationId', 'environment',
  ]));
  exactObject(spec.registry, 'definePushSeam registry', new Set(['idleRetentionMs']));
  for (const field of ['easProjectId', 'applicationId', 'environment']) {
    const value = spec.appScope[field];
    assert(
      typeof value === 'string'
        && /^[A-Za-z0-9._:-]{1,255}$/u.test(value),
      `definePushSeam appScope.${field} must be 1..255 bounded ASCII characters`,
    );
  }
  assert(
    Number.isSafeInteger(spec.registry.idleRetentionMs)
      && spec.registry.idleRetentionMs >= 86_400_000
      && spec.registry.idleRetentionMs <= 31_536_000_000,
    'definePushSeam registry.idleRetentionMs must be between one day and one year',
  );
  const hasSendLane = spec.audiences !== undefined || spec.uses !== undefined || spec.ledger !== undefined;
  assert(
    !hasSendLane || (spec.audiences !== undefined && spec.uses !== undefined && spec.ledger !== undefined),
    'definePushSeam audiences, uses, and ledger must be declared together',
  );
  if (hasSendLane) {
    exactObject(spec.ledger, 'definePushSeam ledger', new Set(['retentionMs']));
    assert(
      Number.isSafeInteger(spec.ledger.retentionMs)
        && spec.ledger.retentionMs >= 86_400_000
        && spec.ledger.retentionMs <= 31_536_000_000,
      'definePushSeam ledger.retentionMs must be between one day and one year',
    );
  }
  const uses = hasSendLane
    ? stringArray(spec.uses, 'definePushSeam uses', { allowEmpty: true })
    : [];
  assert(new Set(uses).size === uses.length, 'definePushSeam uses must not contain duplicates');
  assert(
    !hasSendLane || (spec.audiences && typeof spec.audiences === 'object' && !Array.isArray(spec.audiences)),
    'definePushSeam audiences must be an object',
  );
  const audienceSpecs = {};
  const audienceRefs = {};
  for (const [name, audience] of Object.entries(spec.audiences ?? {})) {
    assert(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(name), `definePushSeam audience name ${name} is invalid`);
    exactObject(audience, `definePushSeam audiences.${name}`, new Set(['resolve', 'authorize']));
    const resolve = pushResolverClause(audience.resolve, `definePushSeam audiences.${name}.resolve`);
    const authorize = pushMembershipClause(
      audience.authorize,
      `definePushSeam audiences.${name}.authorize`,
      { allowSystem: true },
    );
    assert(
      resolve.kind !== 'explicitPrincipals'
        || authorize.kind !== 'membership'
        || resolve.principalsArg !== authorize.resourceArg,
      `definePushSeam audiences.${name} resolver and authorization arguments have incompatible shapes`,
    );
    audienceSpecs[name] = { resolve, authorize };
    audienceRefs[name] = (args = {}) => {
      assert(args && typeof args === 'object' && !Array.isArray(args), `push audience ${name} args must be an object`);
      return Object.freeze({ [PUSH_AUDIENCE_REF]: true, audience: name, args: { ...args } });
    };
  }
  assert(!hasSendLane || Object.keys(audienceSpecs).length > 0, 'definePushSeam requires at least one audience');
  return {
    [PUSH_SEAM]: true,
    appScope: { ...spec.appScope },
    registry: { ...spec.registry },
    ledger: spec.ledger === undefined ? null : { ...spec.ledger },
    uses: [...uses],
    audienceSpecs,
    audiences: Object.freeze(audienceRefs),
  };
}

function rejectLiteralAuthSecrets(value, where) {
  if (!value || typeof value !== 'object') return;
  for (const [name, child] of Object.entries(value)) {
    if (/(?:secret|password|privateKey|accessToken|refreshToken|clientSecret)$/iu.test(name)) {
      assert(false, `${where}.${name} must be a secretReferences name, not a literal`, 'SNAPBACK_AUTH_LITERAL_SECRET_FORBIDDEN');
    }
    rejectLiteralAuthSecrets(child, `${where}.${name}`);
  }
}

// @ref LLP 0214#11-guest-first-template-posture — starters opt into the
// explicit guest-first retention policy; the platform default stays disabled.
export const AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

// @ref LLP 0214#21-one-source-declaration — the floor auth program is closed,
// secret-reference-only, and normalized before it can enter an artifact.
export function defineAuth(program) {
  assert(program && typeof program === 'object' && !Array.isArray(program), 'defineAuth expects an object');
  exactObject(program, 'defineAuth', new Set([
    'version', 'mechanisms', 'providers', 'assuranceRequirements', 'guestPolicy',
    'secretReferences', 'verifiedProvisioning',
  ]), 'SNAPBACK_AUTH_PROGRAM_INVALID');
  assert(program.version === 1, 'defineAuth version must be 1', 'SNAPBACK_AUTH_PROGRAM_VERSION_UNSUPPORTED');

  const mechanisms = {};
  assert(program.mechanisms && typeof program.mechanisms === 'object' && !Array.isArray(program.mechanisms), 'defineAuth mechanisms must be an object');
  for (const [name, mechanism] of Object.entries(program.mechanisms)) {
    assert(isUserIdentifier(name), `defineAuth mechanism name ${name} is invalid`);
    assert(mechanism && typeof mechanism === 'object' && !Array.isArray(mechanism), `defineAuth mechanisms.${name} must be an object`);
    if (mechanism.kind === 'guest') {
      exactObject(mechanism, `defineAuth mechanisms.${name}`, new Set(['kind']));
    } else if (mechanism.kind === 'password') {
      exactObject(mechanism, `defineAuth mechanisms.${name}`, new Set([
        'kind', 'identifier', 'provider', 'recovery', 'minimumLength',
      ]));
      assert(
        mechanism.identifier === 'username' || mechanism.identifier === 'email',
        `defineAuth mechanisms.${name}.identifier must be username or email`,
        'SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_INVALID',
      );
      assert(typeof mechanism.provider === 'string' && mechanism.provider.length > 0, `defineAuth mechanisms.${name}.provider is required`);
      assert(typeof mechanism.recovery === 'string' && mechanism.recovery.length > 0, `defineAuth mechanisms.${name}.recovery is required`);
      assert(
        mechanism.minimumLength === undefined
          || (Number.isSafeInteger(mechanism.minimumLength)
            && mechanism.minimumLength >= 8
            && mechanism.minimumLength <= 128),
        `defineAuth mechanisms.${name}.minimumLength must be a safe integer from 8 through 128`,
        'SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID',
      );
    } else if (mechanism.kind === 'email-code') {
      exactObject(mechanism, `defineAuth mechanisms.${name}`, new Set(['kind', 'identityKind', 'provider', 'canonicalization', 'delivery']));
      assert(mechanism.identityKind === 'email', `defineAuth mechanisms.${name}.identityKind must be email`);
      assert(typeof mechanism.provider === 'string' && mechanism.provider.length > 0, `defineAuth mechanisms.${name}.provider is required`);
      assert(mechanism.canonicalization === undefined || mechanism.canonicalization === 'email-v1', `defineAuth mechanisms.${name}.canonicalization must be email-v1`);
      assert(typeof mechanism.delivery === 'string' && mechanism.delivery.length > 0, `defineAuth mechanisms.${name}.delivery is required`);
    } else if (mechanism.kind === 'passkey') {
      exactObject(mechanism, `defineAuth mechanisms.${name}`, new Set(['kind', 'provider']));
      assert(typeof mechanism.provider === 'string' && mechanism.provider.length > 0, `defineAuth mechanisms.${name}.provider is required`);
    } else {
      assert(false, `defineAuth mechanisms.${name}.kind is unsupported`, 'SNAPBACK_AUTH_MECHANISM_UNSUPPORTED');
    }
    mechanisms[name] = { ...mechanism };
  }
  const passwordIdentifiers = new Set(
    Object.values(mechanisms)
      .filter((mechanism) => mechanism.kind === 'password')
      .map((mechanism) => mechanism.identifier),
  );
  assert(
    passwordIdentifiers.size <= 1,
    'defineAuth password mechanisms must use one identifier mode',
    'SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_CONFLICT',
  );
  const passwordMinimumLengths = new Set(
    Object.values(mechanisms)
      .filter((mechanism) => mechanism.kind === 'password')
      .map((mechanism) => mechanism.minimumLength ?? 12),
  );
  assert(
    passwordMinimumLengths.size <= 1,
    'defineAuth password mechanisms must use one minimumLength policy',
    'SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_CONFLICT',
  );

  const assuranceRequirements = {};
  assert(program.assuranceRequirements && typeof program.assuranceRequirements === 'object' && !Array.isArray(program.assuranceRequirements), 'defineAuth assuranceRequirements must be an object');
  const assuranceNames = Object.keys(program.assuranceRequirements).sort();
  const availableRequirements = new Set([...AUTH_ASSURANCE_KINDS, ...assuranceNames]);
  for (const name of assuranceNames) {
    const requirement = program.assuranceRequirements[name];
    assert(isUserIdentifier(name), `defineAuth assurance requirement name ${name} is invalid`);
    exactObject(requirement, `defineAuth assuranceRequirements.${name}`, new Set(['allOf']));
    assert(Array.isArray(requirement.allOf), `defineAuth assuranceRequirements.${name}.allOf must be an array`);
    assert(new Set(requirement.allOf).size === requirement.allOf.length, `defineAuth assuranceRequirements.${name}.allOf repeats a requirement`);
    for (const item of requirement.allOf) {
      assert(availableRequirements.has(item), `defineAuth assuranceRequirements.${name} names unknown requirement ${String(item)}`, 'SNAPBACK_AUTH_ASSURANCE_REQUIREMENT_INVALID');
    }
    assuranceRequirements[name] = { allOf: [...requirement.allOf].sort() };
  }
  const assuranceVisit = new Map();
  const visitAssurance = (name) => {
    const state = assuranceVisit.get(name);
    assert(state !== 'visiting', `defineAuth assurance requirement ${name} is cyclic`, 'SNAPBACK_AUTH_ASSURANCE_REQUIREMENT_INVALID');
    if (state === 'visited') return;
    assuranceVisit.set(name, 'visiting');
    for (const dependency of assuranceRequirements[name].allOf) {
      if (Object.hasOwn(assuranceRequirements, dependency)) visitAssurance(dependency);
    }
    assuranceVisit.set(name, 'visited');
  };
  for (const name of assuranceNames) visitAssurance(name);

  const secretReferences = {};
  assert(program.secretReferences && typeof program.secretReferences === 'object' && !Array.isArray(program.secretReferences), 'defineAuth secretReferences must be an object');
  for (const [name, reference] of Object.entries(program.secretReferences)) {
    exactObject(reference, `defineAuth secretReferences.${name}`, new Set(['config']));
    assert(typeof reference.config === 'string' && reference.config.length > 0, `defineAuth secretReferences.${name}.config is required`);
    secretReferences[name] = { config: reference.config };
  }
  if (program.providers !== undefined) {
    assert(program.providers && typeof program.providers === 'object' && !Array.isArray(program.providers), 'defineAuth providers must be an object');
    rejectLiteralAuthSecrets(program.providers, 'defineAuth providers');
  }

  const guestPolicy = program.guestPolicy;
  assert(guestPolicy && typeof guestPolicy === 'object' && !Array.isArray(guestPolicy), 'defineAuth guestPolicy must be an object');
  exactObject(guestPolicy, 'defineAuth guestPolicy', new Set(['enabled', 'claiming', 'reaping']));
  assert(typeof guestPolicy.enabled === 'boolean', 'defineAuth guestPolicy.enabled must be boolean');
  const claiming = guestPolicy.claiming ?? [];
  assert(Array.isArray(claiming) && claiming.every((name) => Object.hasOwn(mechanisms, name)), 'defineAuth guestPolicy.claiming must name declared mechanisms');
  let reaping;
  if (guestPolicy.enabled) {
    assert(guestPolicy.reaping && typeof guestPolicy.reaping === 'object' && !Array.isArray(guestPolicy.reaping), 'enabled defineAuth guestPolicy requires reaping');
    exactObject(guestPolicy.reaping, 'defineAuth guestPolicy.reaping', new Set(['afterMs', 'cleanup']));
    assert(Number.isSafeInteger(guestPolicy.reaping.afterMs) && guestPolicy.reaping.afterMs > 0, 'defineAuth guestPolicy.reaping.afterMs must be a positive safe integer');
    const cleanup = guestPolicy.reaping.cleanup;
    assert(cleanup && typeof cleanup === 'object' && !Array.isArray(cleanup), 'defineAuth guestPolicy.reaping.cleanup is required');
    if (cleanup.kind === 'declarative') {
      exactObject(cleanup, 'defineAuth guestPolicy.reaping.cleanup', new Set(['kind', 'default', 'tables']));
      assert(['delete', 'tombstone', 'retain-anonymized'].includes(cleanup.default), 'defineAuth guest cleanup default is invalid');
      assert(cleanup.tables && typeof cleanup.tables === 'object' && !Array.isArray(cleanup.tables), 'defineAuth guest cleanup tables must be an object');
      const tables = {};
      for (const [table, policy] of Object.entries(cleanup.tables)) {
        assert(isUserIdentifier(table), `defineAuth guest cleanup table ${table} is invalid`);
        exactObject(policy, `defineAuth guestPolicy.reaping.cleanup.tables.${table}`, new Set(['principalField', 'onReap']));
        assert(typeof policy.principalField === 'string' && policy.principalField.length > 0, `defineAuth guest cleanup ${table}.principalField is required`);
        assert(['delete', 'tombstone', 'retain-anonymized'].includes(policy.onReap), `defineAuth guest cleanup ${table}.onReap is invalid`);
        tables[table] = { principalField: policy.principalField, onReap: policy.onReap };
      }
      reaping = { afterMs: guestPolicy.reaping.afterMs, cleanup: { kind: 'declarative', default: cleanup.default, tables } };
    } else {
      exactObject(cleanup, 'defineAuth guestPolicy.reaping.cleanup', new Set(['kind', 'handler', 'reads', 'writes']));
      assert(cleanup.kind === 'handler' && typeof cleanup.handler === 'string' && Array.isArray(cleanup.reads) && Array.isArray(cleanup.writes), 'defineAuth handler guest cleanup is invalid');
      reaping = { afterMs: guestPolicy.reaping.afterMs, cleanup: { kind: 'handler', handler: cleanup.handler, reads: [...cleanup.reads], writes: [...cleanup.writes] } };
    }
  }

  let verifiedProvisioning;
  if (program.verifiedProvisioning !== undefined) {
    const hook = program.verifiedProvisioning;
    exactObject(hook, 'defineAuth verifiedProvisioning', new Set(['handler', 'requires', 'reads', 'writes']));
    assert(typeof hook.handler === 'string' && hook.handler.length > 0, 'defineAuth verifiedProvisioning.handler is required');
    assert(Array.isArray(hook.requires) && hook.requires.every((name) => availableRequirements.has(name)), 'defineAuth verifiedProvisioning.requires names unknown assurances');
    assert(Array.isArray(hook.reads) && hook.reads.every((name) => typeof name === 'string'), 'defineAuth verifiedProvisioning.reads must be table names');
    assert(Array.isArray(hook.writes), 'defineAuth verifiedProvisioning.writes must be an array');
    const writes = hook.writes.map((write, index) => {
      assert(write && typeof write === 'object' && !Array.isArray(write), `defineAuth verifiedProvisioning.writes.${index} must be an object`);
      const allowed = write.mode === 'ordinary' ? ['table', 'mode']
        : write.mode === 'identity-binding' ? ['table', 'mode', 'principalField', 'identityField']
          : write.mode === 'permission-backing' ? ['table', 'mode', 'principalField'] : [];
      assert(allowed.length > 0, `defineAuth verifiedProvisioning.writes.${index}.mode is invalid`);
      exactObject(write, `defineAuth verifiedProvisioning.writes.${index}`, new Set(allowed));
      return { ...write };
    });
    verifiedProvisioning = { handler: hook.handler, requires: [...hook.requires], reads: [...hook.reads], writes };
  }

  const normalized = {
    version: 1,
    mechanisms,
    ...(program.providers === undefined ? {} : { providers: { ...program.providers } }),
    assuranceRequirements,
    guestPolicy: { enabled: guestPolicy.enabled, claiming: [...claiming], ...(reaping ? { reaping } : {}) },
    secretReferences,
    ...(verifiedProvisioning ? { verifiedProvisioning } : {}),
  };
  AUTH_PROGRAMS.add(normalized);
  return normalized;
}

export function defineSchema(tables, options = {}) {
  assert(tables && typeof tables === 'object', 'defineSchema expects a tables object');
  for (const [name, table] of Object.entries(tables)) {
    assert(table && table.__table, `table ${name} must be defineTable(...)`);
    assert(!table.__tableName || table.__tableName === name, `one table builder cannot be installed as both ${table.__tableName} and ${name}`);
    table.__tableName = name;
  }
  for (const [name, table] of Object.entries(tables)) {
    const visibility = table.visibilityDeclaration;
    const leaves = visibility?.kind === 'any-of' ? visibility.arms : visibility ? [visibility] : [];
    for (const leaf of leaves) {
      if (leaf.kind === 'owner') {
        assert(
          Object.hasOwn(table.fields, leaf.field),
          `table ${name} visibility owner field ${leaf.field} does not exist`,
          'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN',
        );
      } else if (leaf.kind === 'membership') {
        const selfResource = leaf.resourceField === '_id';
        const resource = selfResource ? null : table.fields[leaf.resourceField];
        assert(
          selfResource || resource !== undefined,
          `table ${name} visibility membership resource field ${leaf.resourceField} does not exist`,
          'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN',
        );
        const declaredMembership = Object.entries(tables).find(([membershipTableName, candidate]) => (
          candidate.membershipDeclaration
          && (candidate.membershipDeclaration.id ?? membershipTableName) === leaf.declaration
        ));
        assert(
          declaredMembership !== undefined,
          `table ${name} visibility names unknown membership declaration ${leaf.declaration}`,
          'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN',
        );
        const membershipTable = declaredMembership?.[1];
        const membershipDeclaration = membershipTable?.membershipDeclaration;
        const membershipResource = membershipDeclaration?.scope === 'resource'
          ? membershipTable.fields[membershipDeclaration.resource]
          : undefined;
        const expectedResourceTable = membershipResource?.fieldType?.Id?.table;
        const actualResourceTable = selfResource ? name : resource?.fieldType?.Id?.table;
        assert(
          (selfResource || resource?.optional === false)
            && typeof expectedResourceTable === 'string'
            && actualResourceTable === expectedResourceTable,
          `table ${name} visibility membership resource field ${leaf.resourceField} must be a required Id<${expectedResourceTable ?? 'resourceTable'}>`,
          'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_TYPE_MISMATCH',
        );
        const declaredRoles = new Set(membershipDeclaration?.roles ?? []);
        for (const role of leaf.roles ?? []) {
          assert(
            declaredRoles.has(role),
            `table ${name} visibility names undeclared or pending membership role ${role}`,
            'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN',
          );
        }
      }
    }
  }
  const ephemeralDef = options.ephemeral ?? null;
  if (ephemeralDef !== null) {
    assert(ephemeralDef && ephemeralDef[EPHEMERAL], 'defineSchema option "ephemeral" must be defineEphemeral(...)');
  }
  let auth;
  // @ref LLP 0058#closed-auth-mode — auth mode is must-understand, including
  // unknown members on the otherwise additive schema authoring object.
  if (options.auth !== undefined) {
    assert(options.auth && typeof options.auth === 'object' && !Array.isArray(options.auth), 'defineSchema option "auth" must be an object');
    exactObject(options.auth, 'defineSchema auth', new Set(['mode', 'agents']));
    assert(Object.hasOwn(options.auth, 'mode'), 'defineSchema option "auth" requires mode');
    assert(AUTH_MODES.has(options.auth.mode), 'defineSchema auth.mode must be dev or sessions');
    let agents;
    if (options.auth.agents !== undefined) {
      assert(options.auth.mode === 'sessions', 'defineSchema auth.agents requires auth.mode sessions');
      exactObject(options.auth.agents, 'defineSchema auth.agents', new Set(['mode', 'invitedBy']));
      const mode = options.auth.agents.mode ?? 'disabled';
      const invitedBy = options.auth.agents.invitedBy ?? 'operators';
      assert(AGENT_REGISTRATION_MODES.has(mode), 'defineSchema auth.agents.mode must be disabled, invited, or open');
      assert(AGENT_INVITERS.has(invitedBy), 'defineSchema auth.agents.invitedBy must be operators or users');
      agents = { mode, invitedBy };
    }
    // @ref LLP 0055#registration — authoring preserves an explicit closed
    // sessions-only registration policy; omission remains disabled.
    auth = { mode: options.auth.mode, ...(agents ? { agents } : {}) };
  }
  let authProgram;
  if (options.authProgram !== undefined) {
    assert(AUTH_PROGRAMS.has(options.authProgram), 'defineSchema option "authProgram" must be defineAuth(...)');
    assert(auth?.mode === 'sessions', 'defineSchema authProgram requires auth.mode sessions');
    authProgram = options.authProgram;
    const passwordMechanism = Object.values(authProgram.mechanisms)
      .find((mechanism) => mechanism.kind === 'password');
    if (passwordMechanism) {
      // @ref LLP 0214#21-amendment-2026-08-11-catalog-v4-and-what-the-reconciliation-actually-cost — the authored
      // password mechanism selects the immutable catalog-v4 mode.
      auth = {
        ...auth,
        passwordIdentifierMode: passwordMechanism.identifier === 'email'
          ? 'email-v1'
          : 'username-v1',
        ...(passwordMechanism.minimumLength === undefined
          ? {}
          : { passwordMinimumLength: passwordMechanism.minimumLength }),
      };
    }
    const cleanup = authProgram.guestPolicy.reaping?.cleanup;
    if (authProgram.guestPolicy.enabled && cleanup?.kind === 'declarative') {
      for (const [tableName, table] of Object.entries(tables)) {
        for (const [fieldName, field] of Object.entries(table.fields)) {
          if (field.fieldType !== 'Principal') continue;
          const policy = cleanup.tables[tableName];
          assert(
            policy?.principalField === fieldName,
            `defineAuth guest cleanup must classify ${tableName}.${fieldName}`,
            'SNAPBACK_AUTH_GUEST_CLEANUP_UNCLASSIFIED',
          );
        }
      }
      for (const [tableName, policy] of Object.entries(cleanup.tables)) {
        assert(
          tables[tableName]?.fields?.[policy.principalField]?.fieldType === 'Principal',
          `defineAuth guest cleanup ${tableName}.${policy.principalField} is not a declared principal field`,
          'SNAPBACK_AUTH_GUEST_CLEANUP_INVALID',
        );
      }
    }
  }
  let api;
  if (options.api !== undefined) {
    assert(options.api && typeof options.api === 'object' && !Array.isArray(options.api), 'defineSchema option "api" must be an object');
    exactObject(options.api, 'defineSchema api', new Set(['enabled', 'disclosure', 'functions', 'origins', 'oauth', 'ask', 'budgets']));
    const enabled = options.api.enabled ?? false;
    const disclosure = options.api.disclosure ?? 'exposed-only';
    const functions = options.api.functions ?? {};
    assert(typeof enabled === 'boolean', 'defineSchema api.enabled must be a boolean');
    assert(API_DISCLOSURES.has(disclosure), 'defineSchema api.disclosure must be exposed-only or full');
    assert(functions && typeof functions === 'object' && !Array.isArray(functions), 'defineSchema api.functions must be an object');
    const normalizedFunctions = {};
    for (const [name, exposure] of Object.entries(functions)) {
      assert(exposure && typeof exposure === 'object' && !Array.isArray(exposure), `defineSchema api.functions.${name} must be an object`);
      exactObject(exposure, `defineSchema api.functions.${name}`, new Set(['expose', 'since', 'approval']));
      const expose = exposure.expose ?? false;
      assert(typeof expose === 'boolean', `defineSchema api.functions.${name}.expose must be a boolean`);
      assert(exposure.since === undefined || typeof exposure.since === 'string', `defineSchema api.functions.${name}.since must be a string`);
      assert(
        exposure.approval === undefined
          || exposure.approval === 'required'
          || exposure.approval === 'external',
        `defineSchema api.functions.${name}.approval must be required or external`,
      );
      normalizedFunctions[name] = {
        expose,
        ...(exposure.since !== undefined ? { since: exposure.since } : {}),
        ...(exposure.approval !== undefined ? { approval: exposure.approval } : {}),
      };
    }
    let origins;
    if (options.api.origins !== undefined) {
      assert(Array.isArray(options.api.origins), 'defineSchema api.origins must be an array');
      origins = [...options.api.origins];
    }
    let oauth;
    if (options.api.oauth !== undefined) {
      assert(options.api.oauth && typeof options.api.oauth === 'object' && !Array.isArray(options.api.oauth), 'defineSchema api.oauth must be an object');
      exactObject(options.api.oauth, 'defineSchema api.oauth', new Set(['enabled', 'bearer', 'bundles']));
      const oauthEnabled = options.api.oauth.enabled ?? false;
      const bearer = options.api.oauth.bearer ?? false;
      const bundles = options.api.oauth.bundles ?? {};
      assert(typeof oauthEnabled === 'boolean', 'defineSchema api.oauth.enabled must be a boolean');
      assert(typeof bearer === 'boolean', 'defineSchema api.oauth.bearer must be a boolean');
      assert(bundles && typeof bundles === 'object' && !Array.isArray(bundles), 'defineSchema api.oauth.bundles must be an object');
      const normalizedBundles = {};
      for (const [name, bundle] of Object.entries(bundles)) {
        assert(bundle && typeof bundle === 'object' && !Array.isArray(bundle), `defineSchema api.oauth.bundles.${name} must be an object`);
        exactObject(bundle, `defineSchema api.oauth.bundles.${name}`, new Set(['functions']));
        assert(Array.isArray(bundle.functions), `defineSchema api.oauth.bundles.${name}.functions must be an array`);
        assert(bundle.functions.every((fn) => typeof fn === 'string'), `defineSchema api.oauth.bundles.${name}.functions must contain function names`);
        normalizedBundles[name] = { functions: [...bundle.functions] };
      }
      // @ref LLP 0204#open-questions — OQ3's human-sized scope vocabulary is
      // preserved for Rust activation to compile against stable function ids.
      oauth = { enabled: oauthEnabled, bearer, bundles: normalizedBundles };
    }
    let ask;
    if (options.api.ask !== undefined) {
      exactObject(options.api.ask, 'defineSchema api.ask', new Set(['enabled', 'billing', 'model']), 'SNAPBACK_API_ASK_MANIFEST_INVALID');
      assert(Object.hasOwn(options.api.ask, 'enabled'), 'defineSchema api.ask requires enabled', 'SNAPBACK_API_ASK_MANIFEST_INVALID');
      assert(Object.hasOwn(options.api.ask, 'billing'), 'defineSchema api.ask requires billing', 'SNAPBACK_API_ASK_MANIFEST_INVALID');
      assert(typeof options.api.ask.enabled === 'boolean', 'defineSchema api.ask.enabled must be a boolean', 'SNAPBACK_API_ASK_MANIFEST_INVALID');
      assert(options.api.ask.billing === 'app' || options.api.ask.billing === 'caller-key', 'defineSchema api.ask.billing must be app or caller-key', 'SNAPBACK_API_ASK_MANIFEST_INVALID');
      let model;
      if (options.api.ask.model !== undefined) {
        exactObject(options.api.ask.model, 'defineSchema api.ask.model', new Set(['provider', 'model', 'secret']), 'SNAPBACK_API_ASK_MODEL_INVALID');
        assert(typeof options.api.ask.model.provider === 'string' && options.api.ask.model.provider.length > 0, 'defineSchema api.ask.model.provider must be a non-empty string', 'SNAPBACK_API_ASK_MODEL_INVALID');
        assert(typeof options.api.ask.model.model === 'string' && options.api.ask.model.model.length > 0, 'defineSchema api.ask.model.model must be a non-empty string', 'SNAPBACK_API_ASK_MODEL_INVALID');
        assert(options.api.ask.model.secret === undefined || (typeof options.api.ask.model.secret === 'string' && options.api.ask.model.secret.length > 0), 'defineSchema api.ask.model.secret must be a non-empty config entry name', 'SNAPBACK_API_ASK_MODEL_INVALID');
        model = { ...options.api.ask.model };
      }
      assert(options.api.ask.billing !== 'caller-key' || model?.secret === undefined, 'defineSchema caller-key ask billing carries the provider credential on X-Snapback-Ask-Provider-Key and must not name an app secret', 'SNAPBACK_API_ASK_MODEL_INVALID');
      ask = { enabled: options.api.ask.enabled, billing: options.api.ask.billing, ...(model ? { model } : {}) };
    }
    const budgets = options.api.budgets === undefined ? undefined : normalizeAskBudgets(options.api.budgets);
    if (ask?.enabled === true) {
      assert(enabled === true, 'defineSchema api.ask.enabled requires api.enabled', 'SNAPBACK_API_ASK_REQUIRES_API');
      assert(budgets?.ask, 'defineSchema api.ask.enabled requires api.budgets.ask.perRequest, api.budgets.ask.perPrincipalDay, api.budgets.ask.appMonthly, and api.budgets.ask.resultVolume', 'SNAPBACK_API_ASK_BUDGETS_REQUIRED');
    }
    // @ref LLP 0204#d1--the-exposure-declaration-keystone — preserve the
    // explicit registration posture and the default-closed function map.
    api = {
      enabled,
      disclosure,
      functions: normalizedFunctions,
      ...(origins ? { origins } : {}),
      ...(oauth ? { oauth } : {}),
      ...(ask ? { ask } : {}),
      ...(budgets ? { budgets } : {}),
      __agentsModeExplicit: Boolean(
        options.auth?.agents && Object.hasOwn(options.auth.agents, 'mode'),
      ),
    };
  }
  if (options.requiredCapabilities !== undefined) {
    assert(Array.isArray(options.requiredCapabilities), 'defineSchema requiredCapabilities must be an array');
    for (const capability of options.requiredCapabilities) {
      assert(TARGET_CAPABILITIES.has(capability), `unknown required target capability ${String(capability)}`);
    }
  }
  // @ref LLP 0044#deletion-retention-and-garbage-collection — reference GC
  // is the app-level opt-in ("an app may enable"), so it is a schema
  // declaration, not an intent knob; the grace is app-declared and codegen
  // checks it against the target's Enforced bounds.
  let assets;
  if (options.assets !== undefined) {
    assert(options.assets && typeof options.assets === 'object' && !Array.isArray(options.assets), 'defineSchema option "assets" must be an object');
    exactObject(options.assets, 'defineSchema assets', new Set(['referenceGc']));
    if (options.assets.referenceGc !== undefined) {
      exactObject(options.assets.referenceGc, 'defineSchema assets.referenceGc', new Set(['graceMs']));
      const graceMs = options.assets.referenceGc.graceMs;
      assert(
        Number.isSafeInteger(graceMs) && graceMs > 0,
        'defineSchema assets.referenceGc.graceMs must be a positive safe integer',
      );
      assets = { referenceGc: { graceMs } };
    }
  }
  // @ref LLP 0146#d1-declarationobservation-conformance — strict mode is the
  // per-app opt-in (OQ1 ruling 2026-08-03: not the default for newly
  // generated apps). When set, opaque handlers' application-table reads and
  // writes are refused at the runtime seam unless declared; without it,
  // declarations stay evidence (LLP 0127 decision 6).
  let strictDeclarations;
  if (options.strictDeclarations !== undefined) {
    assert(
      typeof options.strictDeclarations === 'boolean',
      'defineSchema option "strictDeclarations" must be a boolean',
    );
    strictDeclarations = options.strictDeclarations;
  }
  let pushSeam;
  if (options.pushSeam !== undefined) {
    assert(
      options.pushSeam && options.pushSeam[PUSH_SEAM] === true,
      'defineSchema option "pushSeam" must be definePushSeam(...)',
    );
    assert(auth?.mode === 'sessions', 'defineSchema pushSeam requires auth.mode sessions');
    pushSeam = {
      appScope: { ...options.pushSeam.appScope },
      registry: { ...options.pushSeam.registry },
      ...(options.pushSeam.ledger === null ? {} : {
        ledger: { ...options.pushSeam.ledger },
        uses: [...options.pushSeam.uses],
        audiences: Object.fromEntries(Object.entries(options.pushSeam.audienceSpecs).map(([name, audience]) => [name, {
          resolve: serializePushMembershipClause(audience.resolve, tables, `definePushSeam audiences.${name}.resolve`),
          authorize: serializePushMembershipClause(audience.authorize, tables, `definePushSeam audiences.${name}.authorize`),
        }])),
      }),
    };
  }
  return {
    __schema: true,
    tables,
    ephemeral: ephemeralDef,
    ...(auth ? { auth } : {}),
    ...(authProgram ? { authProgram } : {}),
    ...(api ? { api } : {}),
    ...(assets ? { assets } : {}),
    ...(pushSeam ? { pushSeam } : {}),
    ...(strictDeclarations === true ? { strictDeclarations: true } : {}),
    ...(options.requiredCapabilities !== undefined
      ? { requiredCapabilities: [...new Set(options.requiredCapabilities)] }
      : {}),
  };
}

const SEARCH_QUERY_SPEC_FIELDS = new Set(['table', 'index', 'auth', 'resourceArg']);
const LIVE_SEARCH_QUERY_SPEC_FIELDS = new Set(['table', 'index', 'auth']);
const VECTOR_QUERY_SPEC_FIELDS = new Set(['table', 'index', 'auth']);

// @ref LLP 0131#the-argument-contract-descriptor — PlatformSchemaRef is
// deliberately not an app-authorable spelling in v1: no `v.*` builder emits
// it, and defineSearchQuery constructs it internally against the closed
// platform registry. Codegen re-validates the reference id against the same
// registry. The explicit `authority` member is a closed enum with exactly
// one admitted value in v1.
const searchQueryAstRef = () => ({
  __validator: true,
  fieldType: {
    PlatformSchemaRef: { authority: 'platform', schema: 'snapback:search-query-ast:v1' },
  },
  primitive: 'platformSchemaRef',
  optional: false,
});

/**
 * Define an ordinary, non-live query carried by SearchQueryPlanV1.
 *
 * @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — the wire stays
 * QueryOutput while client.search projects rows/cursor to SearchPageV1.
 */
export function defineSearchQuery(spec) {
  assertKnownSpecFields(spec, 'SearchQuery', SEARCH_QUERY_SPEC_FIELDS);
  const table = spec.table?.__table === true ? spec.table : null;
  assert(table && typeof table.__tableName === 'string', 'defineSearchQuery table must be a defineTable(...) installed in defineSchema(...)');
  assert(typeof spec.index === 'string' && spec.index.length > 0, 'defineSearchQuery index is required');
  assert(table.searchIndexes.some((candidate) => candidate.name === spec.index), `defineSearchQuery names unknown search index ${table.__tableName}.${spec.index}`);
  const visibility = table.searchIndexes.find((candidate) => candidate.name === spec.index).visibility;
  const membershipVisibility = visibility.kind === 'membership';
  if (membershipVisibility) {
    assert(
      typeof spec.resourceArg === 'string' && spec.resourceArg.length > 0,
      'membership search requires resourceArg: every invocation must address one singular membership partition',
    );
    assert(
      !['query', 'limit', 'after'].includes(spec.resourceArg),
      'membership search resourceArg must name one additional argument beside query, limit, and after',
    );
  } else {
    assert(
      spec.resourceArg === undefined,
      `${visibility.kind} search must not declare resourceArg; only membership visibility has a singular resource partition argument`,
    );
  }
  const auth = spec.auth ?? (visibility.kind === 'owner' || membershipVisibility ? 'authenticated' : 'public');
  assert(AUTH_REQUIREMENTS.has(auth), 'SearchQuery auth must be public, optional-user, or authenticated');
  if (visibility.kind === 'owner') assert(auth === 'authenticated', 'owner search requires authenticated auth');
  if (membershipVisibility) assert(auth === 'authenticated', 'membership search requires authenticated auth');
  let resourceValidator;
  if (membershipVisibility) {
    const source = table.fields[visibility.resourceField];
    const idTable = source?.fieldType?.Id?.table;
    if (typeof idTable === 'string' && idTable.length > 0) resourceValidator = v.id(idTable);
    else if (source?.fieldType === 'Principal') resourceValidator = v.principal();
    else if (source?.fieldType === 'String') resourceValidator = v.string(source.resultOptions ?? {});
    else if (source?.fieldType?.Enum) resourceValidator = { ...source, optional: false };
    else {
      assert(
        false,
        `membership search resourceField ${table.__tableName}.${visibility.resourceField} must be a required string, principal, or id field`,
      );
    }
    assert(
      source.optional !== true,
      `membership search resourceField ${table.__tableName}.${visibility.resourceField} must be required`,
    );
  }
  return {
    [FN]: true,
    __kind: 'Query',
    auth,
    // @ref LLP 0131#the-search-fixture-cv-5 — the query argument is a
    // reference to the one exported Rust-owned search request schema, not an
    // authored v.json() respelling; a generation-time gate checks this
    // complete three-argument contract against that schema's top level.
    args: {
      query: searchQueryAstRef(),
      limit: v.optional(v.integer({ min: 1, max: 50 })),
      after: v.optional(v.string({ maxBytes: 2_048 })),
      ...(membershipVisibility ? { [spec.resourceArg]: resourceValidator } : {}),
    },
    // Runtime result validation sees the ordinary QueryOutput rows. Codegen
    // derives their exact stored-field contract from this index declaration;
    // the generated FunctionReference projects those rows plus the transport
    // cursor to the operation-specific SearchPageV1 for client.search().
    searchPlan: {
      table: table.__tableName,
      index: spec.index,
      parser: 'snapback-search-parser-v1',
      resultProjection: 'search-page-v1',
      requiredCapability: 'full_text_search_v1',
      ...(membershipVisibility ? { resourceArg: spec.resourceArg } : {}),
    },
  };
}

/** Define one non-live exact vector query. The transport remains the ordinary
 * QueryOutput envelope; generated clients project its rows to `{ items }`.
 * @ref LLP 0132#query-surface */
export function defineVectorQuery(spec) {
  assertKnownSpecFields(spec, 'VectorQuery', VECTOR_QUERY_SPEC_FIELDS);
  const table = spec.table?.__table === true ? spec.table : null;
  assert(table && typeof table.__tableName === 'string', 'defineVectorQuery table must be installed in defineSchema()');
  assert(typeof spec.index === 'string' && spec.index.length > 0, 'defineVectorQuery index is required');
  const index = table.vectorIndexes.find((candidate) => candidate.name === spec.index);
  assert(index, `defineVectorQuery names unknown vector index ${table.__tableName}.${spec.index}`);
  const auth = spec.auth ?? (index.visibility.kind === 'owner' ? 'authenticated' : 'public');
  assert(AUTH_REQUIREMENTS.has(auth), 'VectorQuery auth must be public, optional-user, or authenticated');
  if (index.visibility.kind === 'owner') assert(auth === 'authenticated', 'owner vector search requires authenticated auth');
  const filterField = index.equalityFilters.length === 0
    ? null
    : index.equalityFilters.length === 1
      ? v.literal(index.equalityFilters[0])
      : v.union(index.equalityFilters.map((name) => v.literal(name)));
  return {
    [FN]: true,
    __kind: 'Query',
    auth,
    args: {
      vector: v.vector(index.dimensions),
      k: v.optional(v.integer({ min: 1, max: 64 })),
      ...(index.equalityFilters.length === 0 ? {} : {
        filters: v.optional(v.array(v.object({
          field: filterField,
          op: v.literal('eq'),
          value: v.union([v.string(), v.finiteReal(), v.boolean()]),
        }), { maxItems: 8 })),
      }),
    },
    vectorPlan: {
      table: table.__tableName,
      index: spec.index,
      distanceProfile: 'snapback-vector-distance-v1',
      resultProjection: 'vector-page-v1',
      requiredCapability: 'vector_search_v1',
    },
  };
}

/**
 * Define a first-page-only live query carried by SearchQueryPlanV1.
 * Runtime/wire publication remains gated by live_full_text_search_v1.
 *
 * @ref LLP 0136#authoring-surface — a live search is a distinct LiveQuery
 * over the unchanged closed search plan, with no authored `after` member.
 */
export function defineLiveSearchQuery(spec) {
  assertKnownSpecFields(spec, 'LiveSearchQuery', LIVE_SEARCH_QUERY_SPEC_FIELDS);
  const table = spec.table?.__table === true ? spec.table : null;
  assert(
    table && typeof table.__tableName === 'string',
    'defineLiveSearchQuery table must be a defineTable(...) installed in defineSchema(...)',
  );
  assert(
    typeof spec.index === 'string' && spec.index.length > 0,
    'defineLiveSearchQuery index is required',
  );
  const index = table.searchIndexes.find((candidate) => candidate.name === spec.index);
  assert(
    index,
    `defineLiveSearchQuery names unknown search index ${table.__tableName}.${spec.index}`,
  );
  assert(
    index.visibility.kind !== 'membership',
    'defineLiveSearchQuery does not admit membership-visible indexes in v1',
  );
  const publicRead = index.visibility.kind === 'public-read';
  const auth = spec.auth ?? (publicRead ? 'public' : 'authenticated');
  assert(
    AUTH_REQUIREMENTS.has(auth),
    'LiveSearchQuery auth must be public, optional-user, or authenticated',
  );
  if (publicRead) {
    assert(auth === 'public', 'public-read live search requires public auth');
  } else {
    assert(auth === 'authenticated', 'owner live search requires authenticated auth');
  }
  return {
    [FN]: true,
    __kind: 'LiveQuery',
    auth,
    ...(publicRead ? { authorityIndependent: true } : {}),
    args: {
      query: searchQueryAstRef(),
      limit: v.optional(v.integer({ min: 1, max: 50 })),
    },
    searchPlan: {
      table: table.__tableName,
      index: spec.index,
      parser: 'snapback-search-parser-v1',
      resultProjection: 'search-page-v1',
      requiredCapability: 'full_text_search_v1',
    },
  };
}

// ---------------------------------------------------------------------------
// Ephemeral realtime collections
// ---------------------------------------------------------------------------
// @ref LLP 0013#proposal — source-authored ephemeral collections are typed,
// scoped, TTL-bounded latest-state maps rather than ad hoc realtime routes.

export const allow = {
  all: () => ({ __accessPolicy: true, kind: 'AllowAll' }),
  roomPermission: (prefix) => {
    assert(typeof prefix === 'string' && prefix.length > 0, 'allow.roomPermission() expects a prefix');
    return { __accessPolicy: true, kind: 'RequireRoomPermission', prefix };
  },
};

export const ephemeral = {
  collection(spec) {
    assert(spec && typeof spec === 'object', 'ephemeral.collection() expects a spec object');
    assert(spec.scope && typeof spec.scope === 'object', 'ephemeral.collection() requires scope');
    for (const [name, val] of Object.entries(spec.scope)) {
      assert(val && val.__validator, `ephemeral scope ${name} must be a validator`);
    }
    assert(spec.value && spec.value.__validator, 'ephemeral.collection() requires a value validator');
    return {
      [EPHEMERAL_COLLECTION]: true,
      scope: spec.scope,
      routing: spec.routing ?? Object.keys(spec.scope),
      key: spec.key ?? 'connection',
      ...(spec.ttlMs !== undefined ? { ttlMs: spec.ttlMs } : {}),
      maxTtlMs: spec.maxTtlMs ?? 30_000,
      withdrawalVisibilityDeadlineMs: spec.withdrawalVisibilityDeadlineMs
        ?? Math.min(Math.floor((spec.ttlMs ?? spec.maxTtlMs ?? 30_000) / 2), 10_000),
      maxValueBytes: spec.maxValueBytes ?? 1_024,
      hardMaxValueBytes: spec.hardMaxValueBytes ?? 4_096,
      publishRate: spec.publishRate ?? { sustainedHz: 20, burst: 60 },
      delivery: spec.delivery ?? { mode: 'latest', dispatchMs: 33 },
      ...(spec.publish !== undefined ? { publish: spec.publish } : {}),
      ...(spec.subscribe !== undefined ? { subscribe: spec.subscribe } : {}),
      value: spec.value,
      targets: spec.targets ?? ['local-dev-sqlite-ibex'],
      maxPendingEphemeralKeys: spec.maxPendingEphemeralKeys ?? 1_024,
    };
  },
};

export function defineEphemeral(collections) {
  assert(collections && typeof collections === 'object', 'defineEphemeral expects a collections object');
  for (const [name, collection] of Object.entries(collections)) {
    assert(collection && collection[EPHEMERAL_COLLECTION], `ephemeral collection ${name} must be ephemeral.collection(...)`);
  }
  return { [EPHEMERAL]: true, collections };
}

// ---------------------------------------------------------------------------
// Asset-bearing commands
// ---------------------------------------------------------------------------
// @ref LLP 0180#declaration — a v1 command is closed data: exactly one
// ordinary mutation plus zero or one declared asset input. It carries no
// callback, transaction, authority, or generic workflow vocabulary.
export function defineCommand(spec) {
  exactObject(spec, 'defineCommand()', new Set(['mutation', 'assets']));
  const assets = spec.assets ?? {};
  assert(assets && typeof assets === 'object' && !Array.isArray(assets), 'defineCommand() assets must be an object');
  for (const [inputName, asset] of Object.entries(assets)) {
    assert(isUserIdentifier(inputName), `defineCommand() asset input ${inputName} is not a portable identifier`);
    exactObject(asset, `defineCommand() asset ${inputName}`, new Set(['intent', 'mutationArg', 'optional']));
    assert(asset.intent?.[ASSET_UPLOAD] === true, `defineCommand() asset ${inputName}.intent must be a defineAssetUpload export`);
    assert(isUserIdentifier(asset.mutationArg), `defineCommand() asset ${inputName}.mutationArg must be a portable identifier`);
    assert(typeof asset.optional === 'boolean', `defineCommand() asset ${inputName}.optional must be boolean`);
  }
  return {
    [COMMAND]: true,
    __kind: 'AssetBearingCommand',
    // Preserve invalid zero/many declarations as closed data so the
    // generation validation lane can return a stable command refusal.
    mutation: spec.mutation ?? null,
    assets: { ...assets },
  };
}

// ---------------------------------------------------------------------------
// Generated application surfaces
// ---------------------------------------------------------------------------
// @ref LLP 0179#closed-grammar — surface declarations are bounded data. The
// only dynamic-looking leaves are named parameter/input substitutions; there
// are no callbacks, conditionals, inheritance, or nested surfaces.

const SURFACE_FIELDS = new Set([
  'params', 'reads', 'mutations', 'commands', 'assets', 'presence',
]);
const SURFACE_NAMESPACES = ['reads', 'mutations', 'commands', 'assets', 'presence'];

export function param(name) {
  assert(isUserIdentifier(name), 'param() expects a portable parameter name');
  return Object.freeze({ __surfaceValue: true, kind: 'param', name });
}

export function input(name) {
  assert(isUserIdentifier(name), 'input() expects a portable member-input name');
  return Object.freeze({ __surfaceValue: true, kind: 'input', name });
}

const portableSurfaceLiteral = (value) => (
  value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
);

export function bind(reference, bindings = {}) {
  assert(reference && typeof reference === 'object', 'bind() expects a generated-reference definition');
  exactObject(bindings, 'bind() bindings', new Set(Object.keys(bindings ?? {})));
  for (const [name, value] of Object.entries(bindings)) {
    if (value?.__surfaceValue === true || portableSurfaceLiteral(value)) continue;
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      `bind() ${name} is outside the closed surface grammar`,
    );
    for (const child of Object.values(value)) {
      assert(
        child?.__surfaceValue === true || portableSurfaceLiteral(child),
        `bind() ${name} must be a flat scope record of param(), input(), or portable literals`,
      );
    }
  }
  return {
    [SURFACE_BINDING]: true,
    __surfaceBinding: true,
    reference,
    bindings: { ...bindings },
  };
}

export function defineSurface(spec) {
  exactObject(spec, 'defineSurface()', SURFACE_FIELDS);
  const params = spec.params ?? {};
  assert(params && typeof params === 'object' && !Array.isArray(params), 'defineSurface() params must be an object');
  for (const [name, validator] of Object.entries(params)) {
    assert(isUserIdentifier(name), `surface parameter ${name} must be a portable identifier`);
    assert(validator?.__validator === true, `surface parameter ${name} must be a validator`);
  }
  const namespaces = {};
  for (const namespace of SURFACE_NAMESPACES) {
    const members = spec[namespace] ?? {};
    assert(members && typeof members === 'object' && !Array.isArray(members), `surface ${namespace} must be an object`);
    namespaces[namespace] = {};
    for (const [name, member] of Object.entries(members)) {
      assert(isUserIdentifier(name), `surface ${namespace} member ${name} must be a portable identifier`);
      assert(member?.[SURFACE_BINDING] === true, `surface ${namespace}.${name} must use bind(...)`);
      namespaces[namespace][name] = member;
    }
  }
  return { [SURFACE]: true, params: { ...params }, ...namespaces };
}

// ---------------------------------------------------------------------------
// Value expressions (map onto the server's ValueExpr enum).
//
// The typed builder is the FIRST-CLASS authoring surface for the data-tier
// IR (LLP 0051 D2): TS metaprogramming is load-bearing (constant-driven
// unrolls are a `.map()` here), and the expression set below is the closed
// v1 profile — no arrows, no closures, no free calls. Typings live in
// define.d.ts beside this file.
//
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   builder-first authoring; the Contract grammar is Exact LLP 0329's
//   evidence-gated option.
// ---------------------------------------------------------------------------

function expectExpr(value, where) {
  assert(value && value.__expr, `${where} expects a value expression`);
  return value;
}

export const arg = (path) => ({ __expr: true, Arg: path });
export const authUserId = () => ({ __expr: true, kind: 'AuthUserId' });
export const authKind = () => ({ __expr: true, kind: 'AuthKind' });
export const authActorKind = () => ({ __expr: true, kind: 'AuthActorKind' });
export const authIsDelegated = () => ({ __expr: true, kind: 'AuthIsDelegated' });
export const lit = (value) => ({ __expr: true, Literal: value });
export const literal = lit;
export const bindingRef = (name) => ({ __expr: true, Binding: name });
export const binding = bindingRef;
export const runtimeId = () => ({ __expr: true, kind: 'RuntimeId' });
export const runtimeNow = () => ({ __expr: true, kind: 'RuntimeNow' });
export const authActualActor = () => ({ __expr: true, kind: 'AuthActorUserId' });
export const authActivityActorKind = () => ({ __expr: true, kind: 'AuthActivityActorKind' });
export const authGrantId = () => ({ __expr: true, kind: 'AuthGrantId' });
export const clientMutationDigest = () => ({ __expr: true, kind: 'ClientMutationDigest' });

/** The whole args object — the null-safe base for optional-arg access. */
export const argsRoot = () => ({ __expr: true, kind: 'Args' });

/** Null-propagating access by arbitrary string key (hyphenated keys are
 * first-class): field(bindingRef('row'), 'delays', 'sb-local'). */
export const field = (base, ...keys) => {
  assert(keys.length > 0 && keys.every((k) => typeof k === 'string'), 'field() expects string keys');
  let current = expectExpr(base, 'field()');
  for (const key of keys) current = { __expr: true, Field: { base: current, key } };
  return current;
};

/** Optional arg access: missing keys yield null (strict `arg()` fails). */
export const argOpt = (path) => {
  assert(typeof path === 'string' && path.length > 0, 'argOpt() expects a path');
  return field(argsRoot(), ...path.split('.'));
};

const binary = (op) => (left, right) => ({
  __expr: true,
  Binary: { op, left: expectExpr(left, op), right: expectExpr(right, op) },
});

export const add = binary('Add');
export const sub = binary('Sub');
export const mul = binary('Mul');
export const div = binary('Div');
export const mod = binary('Mod');
export const eqv = binary('Eq');
export const ne = binary('Ne');
export const lt = binary('Lt');
export const lte = binary('Lte');
export const gt = binary('Gt');
export const gte = binary('Gte');
export const and = binary('And');
export const or = binary('Or');

export const not = (expr) => ({ __expr: true, Unary: { op: 'Not', expr: expectExpr(expr, 'not()') } });
export const neg = (expr) => ({ __expr: true, Unary: { op: 'Neg', expr: expectExpr(expr, 'neg()') } });

/** Ternary: cond(test, whenTruthy, otherwise). */
export const cond = (test, then, otherwise) => ({
  __expr: true,
  If: { cond: expectExpr(test, 'cond()'), then: expectExpr(then, 'cond()'), else: expectExpr(otherwise, 'cond()') },
});

/** String-template lowering: parts are expressions or plain strings. */
export const concat = (...parts) => ({
  __expr: true,
  Concat: parts.map((part) => (typeof part === 'string' ? lit(part) : expectExpr(part, 'concat()'))),
});

/** The pinned v1 expression function library. JS mirror of the authority in
 * `src/value_expr.rs` (`PINNED_FUNCTIONS`); the data-tier corpus pins the
 * behavior of every entry, so drift between the two lists fails tests, not
 * users. Growing it is a profile-version event. */
export const PINNED_FUNCTIONS = Object.freeze([
  'len', 'trim', 'lower', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'coalesce',
]);

/** Call into the pinned v1 function library; codegen fails closed on
 * anything outside it. */
export const call = (func, ...fnArgs) => {
  assert(typeof func === 'string' && func.length > 0, 'call() expects a function name');
  return { __expr: true, Call: { func, args: fnArgs.map((a) => expectExpr(a, `call(${func})`)) } };
};

export const coalesce = (...exprs) => call('coalesce', ...exprs);

/** Closed record constructor — the computed-summary return shape. */
export const record = (fields) => {
  assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'record() expects a fields object');
  // JSON records have own data properties only. A normal object would route
  // the legal key "__proto__" through Object.prototype's legacy setter.
  const out = Object.create(null);
  for (const [key, value] of Object.entries(fields)) out[key] = expectExpr(value, `record().${key}`);
  return { __expr: true, Record: { fields: out } };
};

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export const eq = (field, value) => ({ field, op: 'Eq', value });
export const ltFilter = (field, value) => ({ field, op: 'Lt', value });
export const lteFilter = (field, value) => ({ field, op: 'Lte', value });
export const gtFilter = (field, value) => ({ field, op: 'Gt', value });
export const gteFilter = (field, value) => ({ field, op: 'Gte', value });
function order(field, direction, options = {}) {
  assert(typeof field === 'string' && field.length > 0, 'order field must be a non-empty string');
  assertKnownSpecFields(options, 'order options', new Set(['maxEncodedBytes']));
  if (options.maxEncodedBytes !== undefined) {
    assert(
      Number.isSafeInteger(options.maxEncodedBytes) && options.maxEncodedBytes > 0,
      'order maxEncodedBytes must be a positive safe integer',
    );
  }
  // @ref LLP 0135#4-fold-on-acceptance-amendments-applied-2026-08-02 — a
  // string order use can declare the schema-level UTF-8 write ceiling.
  return {
    field,
    direction,
    ...(options.maxEncodedBytes !== undefined
      ? { maxEncodedBytes: options.maxEncodedBytes }
      : {}),
  };
}

export const asc = (field, options) => order(field, 'Asc', options);
export const desc = (field, options) => order(field, 'Desc', options);

function queryDef(kind, spec) {
  assertKnownSpecFields(spec, kind, QUERY_SPEC_FIELDS, 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN');
  assert(spec.table, `${kind} requires a table`);
  if (spec.authScopeField !== undefined) {
    assert(
      typeof spec.authScopeField === 'string' && spec.authScopeField.length > 0,
      `${kind} authScopeField must be a non-empty string`,
    );
  }
  if (spec.membership !== undefined) {
    assert(Array.isArray(spec.membership), `${kind} membership must be an array`);
    for (const predicate of spec.membership) {
      assert(predicate?.__membershipPredicate === true, `${kind} membership entries must come from a declaration-bound memberOf()/hasRole()`);
    }
  }
  return {
    [FN]: true,
    __kind: kind, // 'Query' | 'LiveQuery'
    ...authoredFunctionAuth(spec, kind),
    args: spec.args ?? {},
    // LLP 0034 D3 (Exact LLP 0284 §2.4): a chatty/expensive LiveQuery may opt
    // out of binding live by default; livePush capability is unaffected.
    ...(kind === 'LiveQuery' && spec.defaultLive === false ? { defaultLive: false } : {}),
    ...(spec.authScopeField !== undefined ? { authScopeField: spec.authScopeField } : {}),
    ...normalizeStandardPattern(spec, kind),
    plan: {
      table: spec.table,
      filters: spec.filter ?? [],
      order: spec.order ?? [],
      limit: spec.limit ?? null,
      index: spec.index ?? null,
      membershipFilters: spec.membership ?? [],
    },
  };
}

/** @ref LLP 0004#first-slice-api-decisions — defineLiveQuery is the restricted
 *  syncable-live subset; ordinary defineQuery is a callable server read only. */
export const defineLiveQuery = (spec) => queryDef('LiveQuery', spec);
export const defineQuery = (spec) => queryDef('Query', spec);

/**
 * The generated declared job-status query (LLP 0070 first slice; LLP 0121
 * option 3): an ordinary live query over one job's privacy-bounded lifecycle
 * projection — never an ambient system table. Args are fixed (`jobId`), the
 * projection shape is server-owned, and observability scope is the declared
 * auth requirement. Declaring it is the whole authoring step: codegen itself
 * emits both the experimental `jobs_one_off_v1` capability requirement and
 * the artifact-level acknowledgment (LLP 0070 is Draft). Never add
 * `jobs_one_off_v1` to `defineSchema(..., { requiredCapabilities })` — that
 * option admits schema-level target capabilities only and refuses this id.
 */
export function defineJobStatusQuery(spec = {}) {
  assertKnownSpecFields(spec, 'JobStatusQuery', new Set(['auth']));
  return {
    [FN]: true,
    __kind: 'LiveQuery',
    ...authoredFunctionAuth(spec, 'JobStatusQuery'),
    args: { jobId: v.string() },
    jobStatusPlan: true,
  };
}

/**
 * The LLP 0143 handoff-ledger projection. The platform fixes the `intentId`
 * argument and complete privacy-bounded row shape, then re-evaluates the
 * stored audience's current authorization before releasing any rows.
 */
export function definePushLedgerQuery(spec = {}) {
  assertKnownSpecFields(spec, 'PushLedgerQuery', new Set(['auth']));
  assert(
    spec.auth === 'authenticated',
    'definePushLedgerQuery requires auth: authenticated',
  );
  return {
    [FN]: true,
    __kind: 'Query',
    ...authoredFunctionAuth(spec, 'Query'),
    args: { intentId: v.string() },
    pushLedgerPlan: true,
  };
}

export const owner = (field) => {
  assert(typeof field === 'string' && field.length > 0, 'owner() expects a field');
  return Object.freeze({ kind: 'owner', field });
};
export const anyOf = (arms) => {
  assert(
    Array.isArray(arms) && arms.length >= 2 && arms.length <= 8,
    'anyOf() expects 2..8 owner or membership arms',
    'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID',
  );
  return Object.freeze({ kind: 'any-of', arms: Object.freeze([...arms]) });
};
export const throughParent = () => Object.freeze({ kind: 'through-parent.v1' });
export const throughScope = ({ scopeField, scopeIncarnationField } = {}) => {
  assert(typeof scopeField === 'string' && typeof scopeIncarnationField === 'string', 'throughScope() expects scope fields');
  return Object.freeze({ kind: 'through-scope.v1', scopeField, scopeIncarnationField });
};

function selectedFields(select, where) {
  assert(select && typeof select === 'object' && !Array.isArray(select), `${where} select is required`);
  return Object.entries(select).map(([name, field]) => {
    assert(name.length > 0, `${where} select output names must be non-empty`);
    assert(typeof field === 'string' && field.length > 0, `${where} select.${name} must name a field`);
    return { name, field };
  });
}

function boundedProjectionValidator(facts, leaf, where) {
  if (leaf.field === '_id') return v.id(facts.name);
  const field = facts.fields[leaf.field];
  assert(field, `${where} projection names unknown field ${facts.name}.${leaf.field}`);
  const portable = (
    ['String', 'Boolean', 'Integer', 'Real', 'Principal'].includes(field.fieldType)
    || field.fieldType?.Enum
    || field.fieldType?.Id
  );
  assert(
    portable,
    `${where} projection ${facts.name}.${leaf.field} must be an LLP 0110 portable scalar (JSON, relation-incarnation, object, and array leaves are not admitted)`,
  );
  const stored = { ...field, optional: false };
  // Persisted projections materialize optional storage as a present JSON null;
  // unlike computed-record optionals, the key is never absent.
  return field.optional ? v.union([v.null(), stored]) : stored;
}

/** One visible parent plus one index-bounded child page.
 * @ref LLP 0110#1-bounded-parentchild-query-profile */
export function defineBoundedChildrenQuery(spec) {
  assertKnownSpecFields(spec, 'BoundedChildrenQuery', new Set(['parent', 'children', 'take', 'parentDeletion']));
  const parent = spec.parent;
  const children = spec.children;
  const parentFacts = relationalTable(parent?.table, 'parent.table');
  const childFacts = relationalTable(children?.table, 'children.table');
  assert(parentFacts.name !== childFacts.name, 'bounded children parent and child tables must differ');
  assert(
    !parentFacts.permissionBacking && !childFacts.permissionBacking,
    'bounded children requires ordinary non-permission-backing parent and child tables',
  );
  assert(typeof parent.idArg === 'string' && parent.idArg.length > 0, 'parent.idArg is required');
  const visibility = relationalVisibility(parentFacts, parent.visibility, 'parent');
  assert(children.visibility?.kind === 'through-parent.v1', 'children visibility must be throughParent()');
  const foreignKey = childFacts.fields[children.foreignKey];
  assert(
    !foreignKey?.optional && foreignKey.fieldType?.Id?.table === parentFacts.name,
    'children.foreignKey must be a required id of the parent table',
  );
  const incarnationField = childFacts.fields[children.parentIncarnation];
  assert(
    !incarnationField?.optional
      && incarnationField.fieldType?.RelationIncarnation?.foreignKeyField === children.foreignKey
      && incarnationField.fieldType?.RelationIncarnation?.parentTable === parentFacts.name,
    'children.parentIncarnation must be the matching required relationIncarnationOf field',
  );
  assert(Array.isArray(children.order) && children.order.length > 0 && children.order.every((entry) => entry.direction === 'Asc'), 'children.order must be non-empty ascending order');
  assert(
    new Set(children.order.map((entry) => entry.field)).size === children.order.length,
    'children.order fields must not contain duplicates',
  );
  for (const entry of children.order) {
    const validator = childFacts.fields[entry.field];
    assert(
      validator && !validator.optional
        && (['String', 'Integer', 'Boolean'].includes(validator.fieldType)
          || validator.fieldType?.Enum)
          || (!validator?.optional && validator?.fieldType?.Id),
      `children order field ${entry.field} must be required string, integer, boolean, or id`,
    );
  }
  assert(Number.isSafeInteger(spec.take) && spec.take >= 0 && spec.take <= 1_024, 'take must be 0..1024');
  const index = childFacts.indexes.find((candidate) => candidate.name === children.index);
  const exact = [children.foreignKey, children.parentIncarnation, ...children.order.map((entry) => entry.field)];
  assert(index && index.unique !== true && index.fields.length === exact.length && index.fields.every((field, i) => field === exact[i]), `children.index must be exactly [${exact.join(', ')}]`);
  assert(spec.parentDeletion === 'hide-orphans.v1', 'parentDeletion must be hide-orphans.v1');
  const parentProjection = selectedFields(parent.select, 'parent');
  const childProjection = selectedFields(children.select, 'children');
  for (const leaf of parentProjection) boundedProjectionValidator(parentFacts, leaf, 'parent');
  for (const leaf of childProjection) boundedProjectionValidator(childFacts, leaf, 'children');
  assert(childProjection.some((leaf) => leaf.field === '_id'), 'children projection must include _id');
  for (const entry of children.order) {
    assert(
      childProjection.some((leaf) => leaf.field === entry.field),
      `children projection must include order field ${entry.field}`,
    );
  }
  const projectedValidator = (facts, projection) => v.object(Object.fromEntries(
    projection.map((leaf) => [
      leaf.name,
      boundedProjectionValidator(facts, leaf, facts === parentFacts ? 'parent' : 'children'),
    ]),
  ));
  const parentResult = projectedValidator(parentFacts, parentProjection);
  const childResult = projectedValidator(childFacts, childProjection);
  return {
    [FN]: true,
    __kind: 'LiveQuery',
    auth: visibility.kind === 'owner' ? 'authenticated' : 'public',
    resultContract: results.records(v.union([
      v.object({
        kind: v.literal('absent'),
        parent: v.null(),
        children: v.array(childResult, { maxItems: 0 }),
        continuation: v.null(),
      }),
      v.object({
        kind: v.literal('visible'),
        parent: parentResult,
        children: v.array(childResult, { maxItems: spec.take }),
        continuation: v.union([v.null(), v.string({ maxBytes: 1_024 })]),
      }),
    ]), { minItems: 1, maxItems: 1 }),
    args: {
      [parent.idArg]: v.id(parentFacts.name),
      cursor: v.optional(v.string({ maxBytes: 1_024 })),
    },
    boundedChildrenPlan: {
      profile: 'bounded-children.v1',
      requiredCapability: 'bounded_children_v1',
      parentTable: parentFacts.name,
      parentIdArg: parent.idArg,
      parentVisibility: visibility.kind === 'public-read' ? 'publicRead' : { owner: { field: visibility.field } },
      parentProjection,
      childTable: childFacts.name,
      childForeignKey: children.foreignKey,
      childRelationIncarnation: children.parentIncarnation,
      childIndex: children.index,
      order: children.order,
      take: spec.take,
      childProjection,
      parentDeletion: spec.parentDeletion,
    },
  };
}

/** One declaration-ordered tuple of bounded child pages under a single
 * authoritative snapshot and one LLP 0157 `sbsb1` continuation.
 * @ref LLP 0135#21-composite-plan-shape */
export function defineSnapshotBatchQuery(spec) {
  assertKnownSpecFields(spec, 'SnapshotBatchQuery', new Set(['nodes']));
  assert(
    Array.isArray(spec.nodes) && spec.nodes.length >= 2 && spec.nodes.length <= 8,
    'defineSnapshotBatchQuery nodes must contain 2–8 bounded-children or relational definitions',
  );
  let totalTake = 0;
  const args = {};
  const pages = [];
  const nodes = [];
  let authenticated = false;
  let relational = false;
  for (const [position, node] of spec.nodes.entries()) {
    const bounded = node?.[FN] === true
      && node.boundedChildrenPlan
      && node.__kind === 'LiveQuery';
    const relationalNode = node?.[FN] === true
      && node.relationalPlan
      && RELATIONAL_PAGES.has(node)
      && node.__kind === 'LiveQuery';
    assert(
      bounded || relationalNode,
      `snapshot batch node ${position} must be a defineBoundedChildrenQuery(...) or defineRelationalQuery(...) result`,
    );
    const plan = bounded ? node.boundedChildrenPlan : node.relationalPlan;
    totalTake += plan.take;
    assert(totalTake <= 1_024, 'snapshot batch summed take must not exceed 1024');
    for (const [name, argument] of Object.entries(node.args ?? {})) {
      if (name === 'cursor') continue;
      if (args[name] !== undefined) {
        assert(
          JSON.stringify(args[name].fieldType) === JSON.stringify(argument.fieldType),
          `snapshot batch argument ${name} has incompatible node types`,
        );
      } else {
        args[name] = argument;
      }
    }
    if (bounded) {
      const visible = node.resultContract?.validator?.variants?.[1];
      assert(visible?.primitive === 'object', `snapshot batch node ${position} lacks the bounded visible contract`);
      pages.push(v.object({ parent: visible.fields.parent, children: visible.fields.children }));
      nodes.push({ classId: 'bounded_children_v1', plan });
    } else {
      relational = true;
      pages.push(RELATIONAL_PAGES.get(node));
      nodes.push({ classId: 'relational_query_v1', plan });
    }
    authenticated ||= node.auth === 'authenticated';
  }
  args.cursor = v.optional(v.string({ maxBytes: 8_192 }));
  return {
    [FN]: true,
    __kind: 'LiveQuery',
    auth: authenticated ? 'authenticated' : 'public',
    args,
    resultContract: results.records(v.union([
      v.object({ kind: v.literal('absent'), nodes: v.null(), continuation: v.null() }),
      v.object({
        kind: v.literal('visible'),
        nodes: v.tuple(pages),
        continuation: v.union([v.null(), v.string({ maxBytes: 8_192 })]),
      }),
    ]), { minItems: 1, maxItems: 1 }),
    snapshotBatchPlan: relational
      ? { profile: 'snapshot-batch.v2', nodes }
      : { profile: 'snapshot-batch.v1', nodes: nodes.map((node) => node.plan) },
  };
}

// ---------------------------------------------------------------------------
// Relational queries (LLP 0080 §1 — the closed first relational profile)
// ---------------------------------------------------------------------------

const RELATIONAL_SPEC_FIELDS = new Set([
  'root', 'rootAlias', 'joined', 'joinedAlias', 'join', 'kind', 'visibility',
  'projection', 'take', 'rootIndex', 'joinedIndex', 'defaultLive', 'retention',
]);
// The closed retention vocabulary (LLP 0080 §4; LLP 0166 §D3):
// default-deny, with result-transform admission available only as an explicit
// owner reclassification. Shape never upgrades a plan into that class.
const RELATIONAL_RETENTION_CLASSES = new Set([
  'none',
  'opaque-authorized-snapshot-v1',
  'result-transform-snapshot-v1',
]);
const RELATIONAL_VISIBILITY_FIELDS = new Set(['root', 'joined', 'output']);
const RELATIONAL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function relationalTable(table, where) {
  assert(
    table?.__table === true && typeof table.__tableName === 'string' && table.__tableName.length > 0,
    `defineRelationalQuery ${where} must be a defineTable(...) installed in defineSchema(...)`,
  );
  return {
    name: table.__tableName,
    fields: table.fields,
    indexes: table.indexes ?? [],
    permissionBacking: table.permissionBackingDeclared === true
      || table.membershipDeclaration != null,
  };
}

// The v1 join-key comparator classes (LLP 0080 §1): string, principal,
// reference id (same declared target domain), JavaScript-safe integer, or
// boolean. Float, Json, and cross-domain references are refused.
function relationalJoinKeyClass(validator, where) {
  const type = validator.fieldType;
  if (type === 'String' || type === 'Principal' || type === 'Integer' || type === 'Boolean') {
    return type;
  }
  if (type && typeof type === 'object' && type.Id && typeof type.Id.table === 'string') {
    return `Id<${type.Id.table}>`;
  }
  if (type && typeof type === 'object' && type.Enum) {
    return `Enum<${JSON.stringify(type.Enum.values)}>`;
  }
  assert(false, `${where} has non-portable join-key type ${JSON.stringify(type)}`);
  return undefined;
}

function relationalProjectionScalar(validator, where) {
  const type = validator?.fieldType;
  const scalar = (
    type === 'String'
    || type === 'Principal'
    || type === 'Boolean'
    || type === 'Integer'
    || type === 'Real'
    || (type && typeof type === 'object' && (type.Enum || type.Id || type.AssetRef))
  );
  assert(
    scalar,
    `${where} must be a portable scalar field (string, principal, id, asset reference, boolean, integer, or real)`,
  );
  return validator;
}

function relationalProjectionLiteral(value, where) {
  assert(
    value === null
      || typeof value === 'string'
      || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value)),
    `${where} must be a finite JSON scalar literal`,
  );
  return value;
}

function relationalVisibility(facts, visibility, where) {
  assert(
    visibility && typeof visibility === 'object' && !Array.isArray(visibility),
    `defineRelationalQuery visibility.${where} is required and explicit — never inferred`,
  );
  if (visibility.kind === 'public-read') {
    assert(
      Object.keys(visibility).length === 1,
      `visibility.${where} public-read admits no other fields`,
    );
    return { kind: 'public-read' };
  }
  assert(
    visibility.kind === 'owner' && typeof visibility.field === 'string'
      && Object.keys(visibility).length === 2,
    `visibility.${where} must be { kind: 'owner', field } or { kind: 'public-read' }`,
  );
  const validator = facts.fields[visibility.field];
  assert(
    validator && !validator.optional
      && (validator.fieldType === 'Principal' || validator.fieldType === 'String'),
    `visibility.${where} owner field must be a non-optional principal or string field`,
  );
  return { kind: 'owner', field: visibility.field };
}

/**
 * The closed first relational profile: one bounded two-source equi-join with
 * explicit visibility on both sources and the output, an index-served root
 * window, and a proven-unique joined side.
 *
 * @ref LLP 0080#1-closed-relational-plan — closed plan, no callbacks or SQL;
 *   the joined side's declared unique index is the cardinality proof; the
 *   root access index makes the bounded result a bounded scan.
 * @ref LLP 0080#3-visibility-and-authority — visibility is declared per
 *   source and output, never inferred; output visibility is provably no
 *   broader than every contributing source, and a `left` join cannot derive
 *   owner identity from the omissible side.
 */
export function defineRelationalQuery(spec) {
  assertKnownSpecFields(spec, 'RelationalQuery', RELATIONAL_SPEC_FIELDS);
  const rootFacts = relationalTable(spec.root, 'root');
  const joinedFacts = relationalTable(spec.joined, 'joined');
  assert(rootFacts.name !== joinedFacts.name, 'relational root and joined tables must differ in v1');
  const rootAlias = spec.rootAlias ?? rootFacts.name;
  const joinedAlias = spec.joinedAlias ?? joinedFacts.name;
  assert(
    RELATIONAL_IDENT.test(rootAlias) && RELATIONAL_IDENT.test(joinedAlias)
      && rootAlias !== joinedAlias,
    'relational aliases must be distinct identifiers',
  );
  const kind = spec.kind ?? 'inner';
  assert(kind === 'inner' || kind === 'left', "relational kind must be 'inner' or 'left'");

  assert(
    Array.isArray(spec.join) && spec.join.length >= 1 && spec.join.length <= 4,
    'relational join requires 1..=4 equality pairs',
  );
  const joinOn = spec.join.map((pair, index) => {
    assert(
      pair && typeof pair === 'object' && Object.keys(pair).length === 2
        && typeof pair.root === 'string' && typeof pair.joined === 'string',
      `join[${index}] must be { root, joined } field names`,
    );
    const rootValidator = rootFacts.fields[pair.root];
    const joinedValidator = joinedFacts.fields[pair.joined];
    assert(rootValidator, `join[${index}].root names unknown field ${rootFacts.name}.${pair.root}`);
    assert(joinedValidator, `join[${index}].joined names unknown field ${joinedFacts.name}.${pair.joined}`);
    assert(
      !joinedValidator.optional,
      `join[${index}].joined field must be non-optional so the unique key is total`,
    );
    const rootClass = relationalJoinKeyClass(rootValidator, `join[${index}].root`);
    const joinedClass = relationalJoinKeyClass(joinedValidator, `join[${index}].joined`);
    assert(
      rootClass === joinedClass,
      `join[${index}] compares ${rootClass} with ${joinedClass}; both operands must share one admitted type (reference ids must share their target domain)`,
    );
    return { rootField: pair.root, joinedField: pair.joined };
  });

  // Cardinality proof: the named joined index is unique and its complete
  // ordered key is exactly the joined-field sequence.
  assert(typeof spec.joinedIndex === 'string', 'relational joinedIndex is required');
  const joinedIndex = joinedFacts.indexes.find((candidate) => candidate.name === spec.joinedIndex);
  const joinedKey = joinOn.map((pair) => pair.joinedField);
  assert(
    joinedIndex && joinedIndex.unique === true
      && joinedIndex.fields.length === joinedKey.length
      && joinedIndex.fields.every((field, index) => field === joinedKey[index]),
    `joinedIndex ${spec.joinedIndex} must be a declared unique index whose complete ordered key is exactly [${joinedKey.join(', ')}]`,
  );

  exactRelationalVisibilityObject(spec.visibility);
  const rootVisibility = relationalVisibility(rootFacts, spec.visibility.root, 'root');
  const joinedVisibility = relationalVisibility(joinedFacts, spec.visibility.joined, 'joined');
  const anyOwner = rootVisibility.kind === 'owner' || joinedVisibility.kind === 'owner';
  const computedOutput = anyOwner ? 'owner' : 'public-read';
  assert(
    spec.visibility.output === computedOutput,
    `visibility.output must be explicitly '${computedOutput}' for these sources — output visibility is never broader than a contributing source and never silently narrower`,
  );
  // A left join cannot derive owner identity from the omissible side
  // (LLP 0080 §3): if the only owner source is the joined side, `left`
  // would emit rows whose owner evidence is null.
  assert(
    !(kind === 'left' && rootVisibility.kind !== 'owner' && joinedVisibility.kind === 'owner'),
    "a left join cannot derive owner visibility from the omissible joined side; use kind: 'inner' or an owner-visible root",
  );

  // Index-served root access: for an owner-visible root the index's leading
  // field is the owner field; v1 authoring admits no residual root filters,
  // and ordering is the index's field sequence (the storage `_id` suffix
  // totalizes it).
  assert(typeof spec.rootIndex === 'string', 'relational rootIndex is required');
  const rootIndex = rootFacts.indexes.find((candidate) => candidate.name === spec.rootIndex);
  assert(rootIndex, `rootIndex ${spec.rootIndex} must be a declared index on ${rootFacts.name}`);
  if (rootVisibility.kind === 'owner') {
    assert(
      rootIndex.fields[0] === rootVisibility.field,
      `rootIndex ${spec.rootIndex} must lead with owner field ${rootVisibility.field}`,
    );
  }
  const orderFields = rootVisibility.kind === 'owner'
    ? rootIndex.fields.slice(1)
    : rootIndex.fields.slice(0);

  assert(
    Number.isSafeInteger(spec.take) && spec.take >= 0 && spec.take <= 1_024,
    'relational take must be an integer from 0 through 1024',
  );

  assert(
    spec.projection && typeof spec.projection === 'object' && !Array.isArray(spec.projection)
      && Object.keys(spec.projection).length > 0,
    'relational projection must be a non-empty object',
  );
  const projectionFields = {};
  const projection = Object.entries(spec.projection).map(([leafName, source]) => {
    assert(RELATIONAL_IDENT.test(leafName), `projection field ${leafName} must be an identifier`);
    assert(
      source && typeof source === 'object' && Object.keys(source).length === 1,
      `projection.${leafName} must be exactly one of { root }, { joined }, { literal }`,
    );
    if (typeof source.root === 'string') {
      const field = rootFacts.fields[source.root];
      assert(field, `projection.${leafName} names unknown field ${rootFacts.name}.${source.root}`);
      relationalProjectionScalar(field, `projection.${leafName} source ${rootFacts.name}.${source.root}`);
      projectionFields[leafName] = boundedProjectionValidator(
        rootFacts,
        { field: source.root },
        `projection.${leafName}`,
      );
      return { name: leafName, source: { RootField: source.root } };
    }
    if (typeof source.joined === 'string') {
      const field = joinedFacts.fields[source.joined];
      assert(field, `projection.${leafName} names unknown field ${joinedFacts.name}.${source.joined}`);
      relationalProjectionScalar(field, `projection.${leafName} source ${joinedFacts.name}.${source.joined}`);
      const stored = boundedProjectionValidator(
        joinedFacts,
        { field: source.joined },
        `projection.${leafName}`,
      );
      projectionFields[leafName] = kind === 'left'
        && !(stored.resultKind === 'union'
          && stored.variants.some((variant) => variant.resultKind === 'null'))
        ? v.union([v.null(), stored])
        : stored;
      return { name: leafName, source: { JoinedField: source.joined } };
    }
    assert(
      Object.hasOwn(source, 'literal'),
      `projection.${leafName} must be exactly one of { root }, { joined }, { literal }`,
    );
    const literal = relationalProjectionLiteral(source.literal, `projection.${leafName}`);
    projectionFields[leafName] = v.literal(literal);
    return {
      name: leafName,
      source: { Literal: literal },
    };
  });

  const visibilityFilters = (visibility) => (
    visibility.kind === 'owner' ? [eq(visibility.field, authUserId())] : []
  );
  const retention = spec.retention ?? 'none';
  assert(
    RELATIONAL_RETENTION_CLASSES.has(retention),
    "relational retention must be 'none', 'opaque-authorized-snapshot-v1', or "
      + "'result-transform-snapshot-v1' — the vocabulary is closed",
  );
  // @ref LLP 0080#4-live-and-retained-capability — the authenticated lease
  // class requires a server-resolved authenticated principal; anonymous
  // results have no admissible v1 retention, so an all-public plan may not
  // declare it.
  assert(
    retention === 'none' || computedOutput === 'owner',
    "retention: 'opaque-authorized-snapshot-v1' requires an owner-visible output; "
      + 'anonymous results have no admissible v1 retention (SNAPBACK_AUTH_UNDECLARABLE_RETENTION)',
  );
  const definition = {
    [FN]: true,
    __kind: 'LiveQuery',
    auth: computedOutput === 'owner' ? 'authenticated' : 'public',
    ...(retention !== 'none'
      ? {
          retainable: true,
          ...(retention === 'result-transform-snapshot-v1' ? { retentionClass: retention } : {}),
          authorizationDependence: ['userId'],
        }
      : {}),
    // The one implicit argument every relational query accepts: the opaque
    // versioned continuation cursor from a previous full page (LLP 0080 §2).
    // Authors declare no arguments of their own in v1, so the name cannot
    // collide.
    args: { cursor: v.optional(v.string()) },
    ...(spec.defaultLive === false ? { defaultLive: false } : {}),
    relationalPlan: {
      root: rootFacts.name,
      rootAlias,
      joined: joinedFacts.name,
      joinedAlias,
      joinKind: kind === 'inner' ? 'Inner' : 'Left',
      joinOn,
      rootVisibility: visibilityFilters(rootVisibility),
      joinedVisibility: visibilityFilters(joinedVisibility),
      projection,
      order: orderFields.map((field) => asc(field)),
      take: spec.take,
      rootIndex: spec.rootIndex,
      joinedIndex: spec.joinedIndex,
      outputVisibility: computedOutput,
      leftJoin: kind === 'left',
    },
  };
  RELATIONAL_PAGES.set(
    definition,
    v.array(v.object(projectionFields), { maxItems: spec.take }),
  );
  return definition;
}

// ---------------------------------------------------------------------------
// Maintained projections (LLP 0080 §5 — MaintainedProjectionPlanV1)
// ---------------------------------------------------------------------------

const PROJECTION_SPEC_FIELDS = new Set([
  'id', 'root', 'rootAlias', 'joined', 'joinedAlias', 'join', 'kind',
  'visibility', 'projection', 'output', 'outputKey', 'rootReverseIndex',
  'fanOutLimit', 'sharedFanOutDisclosure',
]);
const PROJECTION_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function projectionVisibilityManifest(visibility) {
  return visibility.kind === 'owner'
    ? { owner: { field: visibility.field } }
    : 'public-read';
}

/**
 * A transactionally maintained projection: a relational core plus a stable
 * output key, whose output table the runtime maintains inside every source
 * mutation\'s own commit. Generation mirrors activation: everything the
 * server would refuse at load refuses here first, with the same rules.
 *
 * @ref LLP 0080#5-transactionally-maintained-projections — the closed plan:
 *   output key = root `_id` or an immutable unique root index tuple; the
 *   root reverse index is the bounded fan-out lookup; `fanOutLimit` counts
 *   every reverse-index entry.
 * @ref LLP 0080#3-visibility-and-authority — owner derivation from a
 *   guaranteed-present source, the same-subject static row relation, and
 *   the `sharedFanOutDisclosure` acknowledgment for a mutable shared
 *   joined source feeding an owner output.
 */
export function defineMaintainedProjection(spec) {
  assertKnownSpecFields(spec, 'MaintainedProjection', PROJECTION_SPEC_FIELDS);
  assert(
    typeof spec.id === 'string' && PROJECTION_ID.test(spec.id),
    'maintained projection id must be a stable identifier (letters, digits, _ or -)',
  );
  const rootFacts = relationalTable(spec.root, 'root');
  const joinedFacts = relationalTable(spec.joined, 'joined');
  const outputFacts = relationalTable(spec.output, 'output');
  assert(
    rootFacts.name !== joinedFacts.name
      && outputFacts.name !== rootFacts.name
      && outputFacts.name !== joinedFacts.name,
    'root, joined, and output must be three distinct tables',
  );
  const rootAlias = spec.rootAlias ?? rootFacts.name;
  const joinedAlias = spec.joinedAlias ?? joinedFacts.name;
  assert(
    RELATIONAL_IDENT.test(rootAlias) && RELATIONAL_IDENT.test(joinedAlias)
      && rootAlias !== joinedAlias,
    'projection aliases must be distinct identifiers',
  );
  const kind = spec.kind ?? 'inner';
  assert(kind === 'inner' || kind === 'left', "projection kind must be 'inner' or 'left'");

  assert(
    Array.isArray(spec.join) && spec.join.length >= 1 && spec.join.length <= 4,
    'projection join requires 1..=4 equality pairs',
  );
  const joinOn = spec.join.map((pair, index) => {
    assert(
      pair && typeof pair === 'object' && Object.keys(pair).length === 2
        && typeof pair.root === 'string' && typeof pair.joined === 'string',
      `join[${index}] must be { root, joined } field names`,
    );
    const rootValidator = rootFacts.fields[pair.root];
    const joinedValidator = joinedFacts.fields[pair.joined];
    assert(rootValidator, `join[${index}].root names unknown field ${rootFacts.name}.${pair.root}`);
    assert(joinedValidator, `join[${index}].joined names unknown field ${joinedFacts.name}.${pair.joined}`);
    assert(
      !joinedValidator.optional,
      `join[${index}].joined field must be non-optional so the unique key is total`,
    );
    const rootClass = relationalJoinKeyClass(rootValidator, `join[${index}].root`);
    const joinedClass = relationalJoinKeyClass(joinedValidator, `join[${index}].joined`);
    assert(
      rootClass === joinedClass,
      `join[${index}] compares ${rootClass} with ${joinedClass}; both operands must share one admitted type`,
    );
    return { rootField: pair.root, joinedField: pair.joined };
  });

  // Cardinality proof: some declared unique joined index whose complete
  // ordered key is exactly the joined-field sequence.
  const joinedKey = joinOn.map((pair) => pair.joinedField);
  assert(
    joinedFacts.indexes.some((candidate) => (
      candidate.unique === true
        && candidate.fields.length === joinedKey.length
        && candidate.fields.every((field, index) => field === joinedKey[index])
    )),
    `projection requires a declared unique index on ${joinedFacts.name} whose complete ordered key is exactly [${joinedKey.join(', ')}]`,
  );

  // The bounded fan-out lookup: a declared root index (not necessarily
  // unique) leading with exactly the root join-field sequence.
  assert(typeof spec.rootReverseIndex === 'string', 'projection rootReverseIndex is required');
  const rootKey = joinOn.map((pair) => pair.rootField);
  const reverse = rootFacts.indexes.find((candidate) => candidate.name === spec.rootReverseIndex);
  assert(
    reverse && reverse.fields.length >= rootKey.length
      && rootKey.every((field, index) => reverse.fields[index] === field),
    `rootReverseIndex ${spec.rootReverseIndex} must be a declared index on ${rootFacts.name} leading with [${rootKey.join(', ')}]`,
  );

  assert(
    Number.isSafeInteger(spec.fanOutLimit) && spec.fanOutLimit >= 1 && spec.fanOutLimit <= 1_023,
    'projection fanOutLimit must be an integer from 1 through 1023',
  );

  // Output key: the root _id (default), or an immutable declared unique
  // root index whose fields are restated into the plan.
  let outputKey = 'RootId';
  if (spec.outputKey !== undefined && spec.outputKey !== 'rootId') {
    assert(
      spec.outputKey && typeof spec.outputKey === 'object'
        && typeof spec.outputKey.index === 'string'
        && Object.keys(spec.outputKey).length === 1,
      "projection outputKey must be 'rootId' or { index: '<unique root index>' }",
    );
    const keyIndex = rootFacts.indexes.find((candidate) => candidate.name === spec.outputKey.index);
    assert(
      keyIndex && keyIndex.unique === true && keyIndex.fields.length > 0,
      `outputKey index ${spec.outputKey.index} must be a declared unique index on ${rootFacts.name}`,
    );
    outputKey = { RootUniqueIndex: { index: keyIndex.name, fields: [...keyIndex.fields] } };
  }

  assert(
    spec.visibility && typeof spec.visibility === 'object' && !Array.isArray(spec.visibility),
    'defineMaintainedProjection requires visibility: { root, joined, output }',
  );
  for (const key of Object.keys(spec.visibility)) {
    assert(RELATIONAL_VISIBILITY_FIELDS.has(key), `visibility has unknown field ${key}`);
  }
  const rootVisibility = relationalVisibility(rootFacts, spec.visibility.root, 'root');
  const joinedVisibility = relationalVisibility(joinedFacts, spec.visibility.joined, 'joined');
  const anyOwner = rootVisibility.kind === 'owner' || joinedVisibility.kind === 'owner';
  const output = spec.visibility.output;
  if (anyOwner) {
    assert(
      output && typeof output === 'object' && output.kind === 'owner'
        && typeof output.field === 'string',
      "an owner source forces visibility.output { kind: 'owner', field } — no widening",
    );
  } else {
    assert(
      output && typeof output === 'object' && output.kind === 'public-read',
      "all-public sources force visibility.output { kind: 'public-read' } — never silently narrower",
    );
  }

  assert(
    spec.projection && typeof spec.projection === 'object' && !Array.isArray(spec.projection)
      && Object.keys(spec.projection).length > 0,
    'projection leaves must be a non-empty object',
  );
  const projection = Object.entries(spec.projection).map(([leafName, source]) => {
    assert(RELATIONAL_IDENT.test(leafName), `projection field ${leafName} must be an identifier`);
    assert(
      outputFacts.fields[leafName],
      `projection field ${leafName} must exist on output table ${outputFacts.name}`,
    );
    assert(
      source && typeof source === 'object' && Object.keys(source).length === 1,
      `projection.${leafName} must be exactly one of { root }, { joined }, { literal }`,
    );
    if (typeof source.root === 'string') {
      assert(rootFacts.fields[source.root], `projection.${leafName} names unknown field ${rootFacts.name}.${source.root}`);
      return { name: leafName, source: { RootField: source.root } };
    }
    if (typeof source.joined === 'string') {
      assert(joinedFacts.fields[source.joined], `projection.${leafName} names unknown field ${joinedFacts.name}.${source.joined}`);
      return { name: leafName, source: { JoinedField: source.joined } };
    }
    assert(
      Object.hasOwn(source, 'literal'),
      `projection.${leafName} must be exactly one of { root }, { joined }, { literal }`,
    );
    return { name: leafName, source: { Literal: source.literal ?? null } };
  });

  if (output.kind === 'owner') {
    assert(
      outputFacts.fields[output.field],
      `visibility.output.field ${output.field} must exist on output table ${outputFacts.name}`,
    );
    const ownerLeaf = projection.find((leaf) => leaf.name === output.field);
    assert(ownerLeaf, `output owner field ${output.field} must be a projection leaf`);
    // Owner derivation from a guaranteed-present source: the root, or the
    // joined side only under an inner join (LLP 0080 §3).
    const derivationProven = (
      (ownerLeaf.source.RootField !== undefined
        && rootVisibility.kind === 'owner'
        && ownerLeaf.source.RootField === rootVisibility.field)
      || (ownerLeaf.source.JoinedField !== undefined
        && joinedVisibility.kind === 'owner'
        && ownerLeaf.source.JoinedField === joinedVisibility.field
        && kind === 'inner')
    );
    assert(
      derivationProven,
      'output owner must derive from a declared source owner field on a guaranteed-present source (the root, or the joined side under inner)',
    );
    // Same subject as a static row relation: two owner sources must connect
    // through the declared join equalities.
    if (rootVisibility.kind === 'owner' && joinedVisibility.kind === 'owner') {
      assert(
        joinOn.some((pair) => (
          pair.rootField === rootVisibility.field && pair.joinedField === joinedVisibility.field
        )),
        'both sources are owner-visible but their owner fields do not connect through the declared join equalities',
      );
    }
    // A mutable shared joined source couples callers through the shared
    // fanOutLimit; the coupling requires the explicit acknowledgment.
    if (joinedVisibility.kind !== 'owner') {
      assert(
        spec.sharedFanOutDisclosure === true,
        'SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED: a shared public joined source feeding an owner output requires sharedFanOutDisclosure: true to acknowledge the cross-authority capacity coupling',
      );
    }
  } else {
    assert(
      spec.sharedFanOutDisclosure === undefined || spec.sharedFanOutDisclosure === false,
      'sharedFanOutDisclosure applies only to an owner output over a shared joined source',
    );
  }

  return Object.freeze({
    [PROJECTION]: true,
    plan: {
      id: spec.id,
      root: rootFacts.name,
      rootAlias,
      joined: joinedFacts.name,
      joinedAlias,
      joinKind: kind === 'inner' ? 'Inner' : 'Left',
      joinOn,
      rootFilters: [],
      rootVisibility: projectionVisibilityManifest(rootVisibility),
      joinedVisibility: projectionVisibilityManifest(joinedVisibility),
      projection,
      outputTable: outputFacts.name,
      outputKey,
      outputVisibility: projectionVisibilityManifest(
        output.kind === 'owner' ? { kind: 'owner', field: output.field } : { kind: 'public-read' },
      ),
      rootReverseIndex: spec.rootReverseIndex,
      fanOutLimit: spec.fanOutLimit,
      sharedFanOutDisclosure: spec.sharedFanOutDisclosure === true,
      rebuildRecipe: 'rebuild-v1',
    },
  });
}

function exactRelationalVisibilityObject(visibility) {
  assert(
    visibility && typeof visibility === 'object' && !Array.isArray(visibility),
    'defineRelationalQuery requires visibility: { root, joined, output }',
  );
  for (const key of Object.keys(visibility)) {
    assert(RELATIONAL_VISIBILITY_FIELDS.has(key), `visibility has unknown field ${key}`);
  }
  assert(
    typeof visibility.output === 'string',
    "visibility.output is required and explicit ('owner' or 'public-read')",
  );
}

function jsQueryDef(kind, spec) {
  assertKnownSpecFields(spec, kind, JS_QUERY_SPEC_FIELDS);
  let fieldBoundary;
  if (spec.fieldBoundary !== undefined) {
    const where = `${kind} fieldBoundary`;
    exactObject(
      spec.fieldBoundary,
      where,
      new Set(['fields', 'condition']),
      'SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID',
    );
    assert(
      Array.isArray(spec.fieldBoundary.fields) && spec.fieldBoundary.fields.length > 0,
      `${where}.fields must be a non-empty array of field names`,
      'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
    );
    const fields = [];
    const seen = new Set();
    for (const field of spec.fieldBoundary.fields) {
      assert(
        typeof field === 'string' && field.length > 0 && field.trim() === field,
        `${where}.fields entries must be non-empty field names without surrounding whitespace`,
        'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
      );
      assert(
        !seen.has(field),
        `${where}.fields repeats ${field}`,
        'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
      );
      seen.add(field);
      fields.push(field);
    }
    assert(
      typeof spec.fieldBoundary.condition === 'string'
        && spec.fieldBoundary.condition.trim().length > 0,
      `${where}.condition must be a non-empty free-text disclosure claim`,
      'SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID',
    );
    fieldBoundary = Object.freeze({
      fields: Object.freeze(fields),
      condition: spec.fieldBoundary.condition.trim(),
    });
  }
  const inline = spec.handler !== undefined;
  const legacy = spec.source !== undefined || spec.exportName !== undefined;
  assert(inline !== legacy, `${kind} requires exactly one handler form: handler or source + exportName`);
  if (legacy) {
    assert(spec.source, `${kind} requires a handler source file`);
    assert(spec.exportName, `${kind} requires exportName`);
  }
  assert(spec.reads && Array.isArray(spec.reads) && spec.reads.length > 0, `${kind} requires declared reads`);
  if (spec.authScopeField !== undefined) {
    assert(
      typeof spec.authScopeField === 'string' && spec.authScopeField.length > 0,
      `${kind} authScopeField must be a non-empty string`,
    );
  }
  if (spec.result !== undefined) {
    assert(
      (
        spec.result?.__resultContract === true
        && (
          spec.result.kind === 'documents'
          || spec.result.kind === 'records'
          || spec.result.kind === 'document'
          || spec.result.kind === 'value'
        )
      )
        || (spec.result?.__validator === true && spec.result.primitive === 'object'),
      `${kind} result must use results.documents(...), results.records(...), results.document(...), results.value(...), or the legacy v.object(...) row validator`,
    );
  }
  return {
    [FN]: true,
    __kind: kind,
    ...authoredFunctionAuth(spec, kind),
    args: spec.args ?? {},
    ...(spec.result?.__resultContract === true
      ? { resultContract: spec.result }
      : (spec.result !== undefined ? { result: spec.result } : {})),
    ...(fieldBoundary === undefined ? {} : { fieldBoundary }),
    // LLP 0034 D3: per-definition defaultLive opt-out (see queryDef).
    ...(kind === 'LiveQuery' && spec.defaultLive === false ? { defaultLive: false } : {}),
    js: {
      ...(inline
        ? { inlineHandler: spec.handler }
        : { source: spec.source, exportName: spec.exportName }),
      reads: spec.reads,
      writes: [],
      authScopeField: spec.authScopeField ?? null,
      syncabilityClass: kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
    },
  };
}

/** JavaScript handler declarations bundle a source file into the function
 * manifest. They are the Phase 2 bridge toward real `ctx.db` authoring; HostPlan
 * stays available for deterministic fixture coverage. */
export const defineJsLiveQuery = (spec) => jsQueryDef('LiveQuery', spec);
export const defineJsQuery = (spec) => jsQueryDef('Query', spec);

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

export const insert = (table, values, opts = {}) => ({
  Insert: { table, values, bind_id_as: opts.bindIdAs ?? null },
});
export const patch = (table, id, values) => ({ Patch: { table, id, values } });
export const del = (table, id) => ({ Delete: { table, id } });

// The v1 extension steps (LLP 0051 D2): reads/guards plus the two closed
// set-oriented forms. General iteration and data-dependent cross-step
// control flow are permanently out of the profile — a mutation needing them
// outgrew the IR and belongs on the JS/WASM tier (see defineJsMutation's
// `outgrewIr` declaration).

/** Point read captured into the read-set. Missing binds null (compose with
 * coalesce) unless opts.elseError names a typed failure code. */
export const get = (table, id, bindAs, opts = {}) => {
  assert(typeof bindAs === 'string' && bindAs.length > 0, 'get() requires a bindAs name');
  return { Get: { table, id: expectExpr(id, 'get()'), bind_as: bindAs, else_error: opts.elseError ?? null } };
};

/** Truthiness guard; failure is the author-supplied typed error code. */
export const guard = (condExpr, elseError) => {
  assert(typeof elseError === 'string' && elseError.length > 0, 'guard() requires an error code');
  return { Guard: { cond: expectExpr(condExpr, 'guard()'), else_error: elseError } };
};

/** Bind a computed expression for later steps. */
export const letBind = (bindAs, expr) => {
  assert(typeof bindAs === 'string' && bindAs.length > 0, 'letBind() requires a name');
  return { Let: { bind_as: bindAs, expr: expectExpr(expr, 'letBind()') } };
};

/** Set-oriented delete; an explicitly authored empty filter clears the table.
 * @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation — clear-table remains
 * the empty-filter IR, but authors must opt into that destructive effect. */
export function deleteWhere(table, filter) {
  assert(
    arguments.length >= 2,
    'deleteWhere() requires an explicit filter array; pass [] to clear the table intentionally',
    'SNAPBACK_DELETE_WHERE_FILTER_REQUIRED',
  );
  assert(
    Array.isArray(filter),
    'deleteWhere() filter must be an array',
    'SNAPBACK_DELETE_WHERE_FILTER_INVALID',
  );
  return { DeleteWhere: { table, filter } };
}

/** One insert per element of an argument-supplied array — a bounded
 * comprehension. Values are expressions over the itemAs binding. */
export const insertEach = (table, source, itemAs, values) => {
  assert(typeof itemAs === 'string' && itemAs.length > 0, 'insertEach() requires an itemAs name');
  return { InsertEach: { table, source: expectExpr(source, 'insertEach()'), item_as: itemAs, values } };
};

export const assertSourceChanged = (table, id, operation) => {
  assert(['insert', 'patch', 'delete'].includes(operation), 'assertSourceChanged operation must be insert, patch, or delete');
  return { AssertSourceChanged: { table, id: expectExpr(id, 'assertSourceChanged()'), operation } };
};

/** Allocate one authoritative value from a declared scoped sequence.
 *
 * The helper is admitted only inside `defineWriteWithActivity`; the builder
 * places it after the generated scope-owner guard and before authored writes.
 * @ref LLP 0135#12-allocation-surfaces */
export const allocateSequence = (counter, scope, into) => {
  assert(
    isUserIdentifier(counter),
    'allocateSequence() counter must be a non-reserved user identifier',
  );
  assert(
    typeof into === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(into),
    'allocateSequence() into must be an identifier',
  );
  return {
    AllocateSequence: {
      counter,
      scope: expectExpr(scope, 'allocateSequence()'),
      into,
    },
  };
};

export const mutationPlan = (...steps) => Object.freeze({
  __mutationPlan: true,
  steps: steps.flat(),
});

export const existingOwner = ({ table, id, visibility } = {}) => {
  assert(table?.__table === true && id?.__expr === true, 'existingOwner() expects a table and id expression');
  assert(visibility?.kind === 'owner', 'existingOwner() visibility must be owner(field)');
  const ownerField = table.fields?.[visibility.field];
  assert(
    ownerField
      && !ownerField.optional
      && ['String', 'Principal'].includes(ownerField.fieldType),
    'existingOwner() visibility field must be a required string or principal',
  );
  return Object.freeze({ __activityScope: true, mode: 'existing-owner.v1', table, id, visibility });
};

export const clientMutation = () => Object.freeze({ kind: 'client-mutation.v1' });

function expressionUsesRuntimeId(expr) {
  if (!expr || typeof expr !== 'object' || expr.__expr !== true) return false;
  if (expr.kind === 'RuntimeId') return true;
  if (Object.hasOwn(expr, 'Field')) return expressionUsesRuntimeId(expr.Field.base);
  if (Object.hasOwn(expr, 'Binary')) {
    return expressionUsesRuntimeId(expr.Binary.left)
      || expressionUsesRuntimeId(expr.Binary.right);
  }
  if (Object.hasOwn(expr, 'Unary')) return expressionUsesRuntimeId(expr.Unary.expr);
  if (Object.hasOwn(expr, 'If')) {
    return expressionUsesRuntimeId(expr.If.cond)
      || expressionUsesRuntimeId(expr.If.then)
      || expressionUsesRuntimeId(expr.If.else);
  }
  if (Object.hasOwn(expr, 'Concat')) return expr.Concat.some(expressionUsesRuntimeId);
  if (Object.hasOwn(expr, 'Call')) return expr.Call.args.some(expressionUsesRuntimeId);
  if (Object.hasOwn(expr, 'Record')) {
    return Object.values(expr.Record.fields).some(expressionUsesRuntimeId);
  }
  // Literal JSON is inert even if its data happens to resemble an expression.
  return false;
}

function mutationStepUsesRuntimeId(step) {
  const [kind, payload] = Object.entries(step)[0];
  if (kind === 'Insert') return Object.values(payload.values).some(expressionUsesRuntimeId);
  if (kind === 'Patch') {
    return expressionUsesRuntimeId(payload.id)
      || Object.values(payload.values).some(expressionUsesRuntimeId);
  }
  if (kind === 'Delete' || kind === 'Get') return expressionUsesRuntimeId(payload.id);
  if (kind === 'Guard') return expressionUsesRuntimeId(payload.cond);
  if (kind === 'Let') return expressionUsesRuntimeId(payload.expr);
  if (kind === 'AllocateSequence') return expressionUsesRuntimeId(payload.scope);
  return false;
}

/** Closed source write plus one provenance-bearing activity append.
 * @ref LLP 0110#2-closed-write-plus-activity-profile */
export function defineWriteWithActivity(spec) {
  assertKnownSpecFields(spec, 'WriteWithActivity', new Set([
    'args', 'scope', 'primary', 'relations', 'source', 'activity', 'idempotency',
    'result', 'returns', 'auth',
  ]));
  assert(spec.scope?.__activityScope === true, 'scope must use existingOwner()');
  assert(spec.primary?.__mutationPlan === true, 'primary must use mutationPlan()');
  assert(spec.idempotency?.kind === 'client-mutation.v1', 'idempotency must use clientMutation()');
  assert(spec.result?.__resultContract === true && spec.result.kind === 'value', 'result must use results.value(...)');
  const scopeFacts = relationalTable(spec.scope?.table, 'scope.table');
  const sourceFacts = relationalTable(spec.source?.table, 'source.table');
  const activityFacts = relationalTable(spec.activity?.table, 'activity.table');
  const scopeTable = scopeFacts.name;
  const sourceTable = sourceFacts.name;
  const activityTable = activityFacts.name;
  assert(scopeTable && sourceTable && activityTable, 'scope/source/activity tables must be installed schema tables');
  assert(scopeTable !== sourceTable && sourceTable !== activityTable && scopeTable !== activityTable, 'scope, source, and activity tables must be distinct');
  assert(
    !scopeFacts.permissionBacking
      && !sourceFacts.permissionBacking
      && !activityFacts.permissionBacking,
    'write-with-activity requires ordinary non-permission-backing scope, source, and activity tables',
  );
  assert(Array.isArray(spec.relations) && spec.relations.length > 0, 'relations must declare every non-scope primary table');
  const relations = new Map();
  for (const [index, relation] of spec.relations.entries()) {
    const facts = relationalTable(relation?.table, `relations[${index}].table`);
    assert(facts.name !== scopeTable && facts.name !== activityTable, 'relations may name only non-scope primary tables');
    assert(
      !facts.permissionBacking,
      `write-with-activity relation ${facts.name} must be an ordinary non-permission-backing table`,
    );
    assert(!relations.has(facts.name), `relations repeats table ${facts.name}`);
    const foreignKey = facts.fields[relation.scopeForeignKey];
    const incarnation = facts.fields[relation.scopeIncarnation];
    assert(
      !foreignKey?.optional && foreignKey.fieldType?.Id?.table === scopeTable,
      `${facts.name}.${String(relation.scopeForeignKey)} must be a required id of ${scopeTable}`,
    );
    assert(
      !incarnation?.optional
        && incarnation.fieldType?.RelationIncarnation?.foreignKeyField === relation.scopeForeignKey
        && incarnation.fieldType?.RelationIncarnation?.parentTable === scopeTable,
      `${facts.name}.${String(relation.scopeIncarnation)} must be the matching required relationIncarnationOf field`,
    );
    relations.set(facts.name, {
      table: facts.name,
      scopeForeignKey: relation.scopeForeignKey,
      scopeIncarnation: relation.scopeIncarnation,
      facts,
    });
  }
  const admittedSteps = new Set([
    'Insert', 'Patch', 'Delete', 'Get', 'Guard', 'Let', 'AllocateSequence',
  ]);
  assert(
    spec.primary.steps.every((step) => admittedSteps.has(Object.keys(step)[0])),
    'primary contains a step outside the closed point-operation profile',
  );
  assert(
    !spec.primary.steps.some(mutationStepUsesRuntimeId)
      && !Object.values(spec.activity.values ?? {}).some(expressionUsesRuntimeId)
      && !expressionUsesRuntimeId(spec.returns)
      && !expressionUsesRuntimeId(spec.scope.id),
    'write-with-activity runtime ids are host-owned by the source/activity inserts; authored runtimeId() expressions are outside the closed effect formula',
  );
  const sourceSteps = spec.primary.steps.filter((step) => {
    const [kind] = Object.keys(step);
    return ['Insert', 'Patch', 'Delete'].includes(kind) && step[kind].table === sourceTable;
  });
  assert(sourceSteps.length === 1, 'primary must contain exactly one source write');
  const sourceStep = sourceSteps[0];
  assert(
    !sourceStep.Patch || Object.keys(sourceStep.Patch.values).length > 0,
    'write-with-activity source Patch values must be nonempty',
  );
  const authoredWrites = spec.primary.steps.filter((step) => (
    ['Insert', 'Patch', 'Delete'].includes(Object.keys(step)[0])
  ));
  assert(
    authoredWrites.every((step) => Object.values(step)[0].table !== activityTable),
    'primary may not write the activity table',
  );
  assert(
    authoredWrites.length <= 2,
    'primary admits one source write and at most one scope patch',
  );
  for (const step of authoredWrites) {
    const [kind, payload] = Object.entries(step)[0];
    if (payload.table !== sourceTable) {
      assert(
        kind === 'Patch' && payload.table === scopeTable,
        'the only non-source write admitted by primary is a scope patch',
      );
    }
  }
  const primaryRelationTables = new Set();
  for (const step of spec.primary.steps) {
    const [kind, payload] = Object.entries(step)[0];
    if (['Get', 'Insert', 'Patch', 'Delete'].includes(kind) && payload.table !== scopeTable) {
      primaryRelationTables.add(payload.table);
      assert(
        relations.has(payload.table),
        `primary ${kind} on ${payload.table} requires a relations declaration with scopeForeignKey and scopeIncarnation`,
      );
    }
  }
  assert(
    [...relations.keys()].every((table) => primaryRelationTables.has(table)),
    'relations may not contain a table unused by the primary plan',
  );
  const pointReads = spec.primary.steps.reduce((count, step) => {
    const [kind, payload] = Object.entries(step)[0];
    if (kind === 'Get' && payload.table !== scopeTable) return count + 1;
    if ((kind === 'Patch' || kind === 'Delete') && payload.table !== scopeTable) return count + 1;
    return count;
  }, 0);
  const guardsAndLets = spec.primary.steps.filter((step) => (
    Object.hasOwn(step, 'Guard') || Object.hasOwn(step, 'Let')
  )).length;
  const relationshipPointReads = pointReads * 2;
  assert(
    relationshipPointReads <= 8,
    'primary admits at most eight relationship point reads including generated current-relation assertions',
  );
  assert(guardsAndLets <= 16, 'primary admits at most sixteen Guard/Let steps');
  const allocations = spec.primary.steps.filter((step) => Object.hasOwn(step, 'AllocateSequence'));
  assert(allocations.length <= 1, 'write-with-activity admits at most one sequence allocation');
  if (allocations.length === 1) {
    assert(
      JSON.stringify(allocations[0].AllocateSequence.scope) === JSON.stringify(spec.scope.id),
      'write-with-activity sequence allocation must use the exact operation scope id',
    );
  }
  const sourceOperation = Object.keys(sourceStep)[0].toLowerCase();
  const scopeRefusal = allocations.length > 0
    ? 'SNAPBACK_RELATION_PARENT_UNAVAILABLE'
    : 'SNAPBACK_ROW_NOT_FOUND';
  const scopeBinding = '__activityScope';
  const activityIdBinding = '__activityId';
  const provenance = spec.activity.provenance;
  const visibility = spec.activity.visibility;
  assert(visibility?.kind === 'through-scope.v1', 'activity.visibility must use throughScope()');
  const requiredProvenance = [
    'scopeId', 'sourceTable', 'sourceId', 'operation', 'effectiveSubject',
    'actualActor', 'actorKind', 'grant', 'occurredAt', 'mutation',
  ];
  assert(requiredProvenance.every((slot) => typeof provenance?.[slot] === 'string'), 'activity.provenance must map every required slot');
  assert(
    new Set(Object.values(provenance)).size === Object.values(provenance).length,
    'activity.provenance field mappings must be distinct',
  );
  assert(
    provenance.scopeId === visibility.scopeField,
    'activity provenance scopeId must equal visibility.scopeField',
  );
  assert(
    visibility.scopeIncarnationField !== provenance.scopeId,
    'activity scope id and incarnation fields must differ',
  );
  assert(
    !Object.values(provenance).includes(visibility.scopeIncarnationField),
    'activity scope incarnation field is protected and may not alias a provenance mapping',
  );
  for (const [slot, fieldName] of Object.entries(provenance)) {
    const fieldValidator = activityFacts.fields[fieldName];
    assert(fieldValidator, `activity.provenance.${slot} names unknown field ${activityTable}.${fieldName}`);
    assert(
      slot === 'grant' || !fieldValidator.optional,
      `activity provenance field ${activityTable}.${fieldName} must be required`,
    );
  }
  const provenanceField = (slot) => activityFacts.fields[provenance[slot]];
  const isType = (slot, admitted) => admitted(provenanceField(slot)?.fieldType);
  assert(
    isType('scopeId', (type) => type?.Id?.table === scopeTable)
      && !provenanceField('scopeId').optional,
    `activity provenance scopeId must be a required id of ${scopeTable}`,
  );
  for (const slot of ['sourceTable', 'operation', 'actorKind', 'mutation']) {
    assert(
      isType(slot, (type) => type === 'String') && !provenanceField(slot).optional,
      `activity provenance ${slot} must be a required string`,
    );
  }
  assert(
    isType('sourceId', (type) => type === 'String' || type?.Id?.table === sourceTable)
      && !provenanceField('sourceId').optional,
    `activity provenance sourceId must be a required string or id of ${sourceTable}`,
  );
  for (const slot of ['effectiveSubject', 'actualActor']) {
    assert(
      isType(slot, (type) => type === 'String' || type === 'Principal')
        && !provenanceField(slot).optional,
      `activity provenance ${slot} must be a required string or principal`,
    );
  }
  assert(
    isType('grant', (type) => type === 'String') && provenanceField('grant').optional,
    'activity provenance grant must be an optional string field',
  );
  assert(
    isType('occurredAt', (type) => type === 'Integer')
      && !provenanceField('occurredAt').optional,
    'activity provenance occurredAt must be a required integer',
  );
  assert(
    activityFacts.fields[visibility.scopeIncarnationField]?.fieldType?.RelationIncarnation,
    'activity visibility scopeIncarnationField must be a relationIncarnationOf field',
  );
  const activityRelation = {
    table: activityTable,
    scopeForeignKey: visibility.scopeField,
    scopeIncarnation: visibility.scopeIncarnationField,
    facts: activityFacts,
  };
  for (const relation of [...relations.values(), activityRelation]) {
    const { facts } = relation;
    for (const index of facts.indexes.filter((candidate) => candidate.unique === true)) {
      assert(
        index.fields[0] === relation.scopeForeignKey
          && index.fields[1] === relation.scopeIncarnation,
        `${facts.name} unique index ${index.name} must be scoped by [${relation.scopeForeignKey}, ${relation.scopeIncarnation}]`,
      );
    }
  }
  assert(relations.has(sourceFacts.name), 'source table must have an explicit relations declaration');
  const authoredBindings = new Set();
  const allocationBinding = allocations[0]?.AllocateSequence.into ?? null;
  for (const step of spec.primary.steps) {
    const [kind, payload] = Object.entries(step)[0];
    let bindingName = null;
    if (kind === 'Get' || kind === 'Let') bindingName = payload.bind_as;
    if (kind === 'Insert' && payload.bind_id_as) bindingName = payload.bind_id_as;
    if (kind === 'AllocateSequence') bindingName = payload.into;
    if (bindingName !== null) {
      // Legacy Get/Let/Insert bindings historically allow shadowing. The new
      // allocation binding is the sole collision-sensitive name because a
      // shadow could substitute app data for host-owned authority.
      if (allocationBinding !== null && bindingName === allocationBinding) {
        assert(
          kind === 'AllocateSequence' && !authoredBindings.has(bindingName),
          `primary binding ${bindingName} is declared more than once`,
        );
      }
      authoredBindings.add(bindingName);
    }
  }
  assert(
    !authoredBindings.has(scopeBinding)
      && !authoredBindings.has(activityIdBinding)
      && [...authoredBindings].every((name) => !name.startsWith('__activityRelation')),
    'primary binding names may not use the write-with-activity reserved namespace',
  );
  const guardedPrimary = [];
  for (const step of spec.primary.steps) {
    const [kind, payload] = Object.entries(step)[0];
    // Allocation has one host-owned position: after scope reach is proved and
    // before any authored primary effect. Preserve author order for every
    // other step while moving only this authority-sensitive operation.
    if (kind === 'AllocateSequence') continue;
    if (!['Get', 'Insert', 'Patch', 'Delete'].includes(kind) || payload.table === scopeTable) {
      guardedPrimary.push(step);
      continue;
    }
    const relation = relations.get(payload.table);
    if (kind === 'Insert') {
      assert(
        !Object.hasOwn(payload.values, relation.scopeForeignKey)
          && !Object.hasOwn(payload.values, relation.scopeIncarnation),
        `primary insert into ${payload.table} may not author protected relation fields`,
      );
      guardedPrimary.push({
        Insert: {
          ...payload,
          values: {
            ...payload.values,
            [relation.scopeForeignKey]: spec.scope.id,
          },
        },
      });
      continue;
    }
    // @ref LLP 0110#protected-relation-incarnation-and-stamping — the
    // transaction-local host assertion compares both row axes with the
    // registry's current active parent incarnation. A non-null historical
    // stamp alone is insufficient after delete/recreate with an id reuse.
    guardedPrimary.push({
      AssertCurrentRelation: {
        table: payload.table,
        id: payload.id,
        scope_table: scopeTable,
        scope_id: spec.scope.id,
        foreign_key_field: relation.scopeForeignKey,
        incarnation_field: relation.scopeIncarnation,
        else_error: 'SNAPBACK_ROW_NOT_FOUND',
      },
    });
    guardedPrimary.push(kind === 'Get'
      ? {
          Get: {
            ...payload,
            else_error: payload.else_error ?? 'SNAPBACK_ROW_NOT_FOUND',
          },
        }
      : step);
  }
  assert(
    !Object.hasOwn(spec.activity.values ?? {}, visibility.scopeField)
      && !Object.hasOwn(spec.activity.values ?? {}, visibility.scopeIncarnationField),
    'activity values may not author protected relation fields',
  );
  const values = {
    ...(spec.activity.values ?? {}),
    [provenance.scopeId]: spec.scope.id,
    [provenance.sourceTable]: lit(sourceTable),
    [provenance.sourceId]: spec.source.id,
    [provenance.operation]: lit(sourceOperation),
    [provenance.effectiveSubject]: authUserId(),
    [provenance.actualActor]: authActualActor(),
    [provenance.actorKind]: authActivityActorKind(),
    [provenance.grant]: authGrantId(),
    [provenance.occurredAt]: runtimeNow(),
    [provenance.mutation]: clientMutationDigest(),
  };
  const steps = [
    get(scopeTable, spec.scope.id, scopeBinding, { elseError: scopeRefusal }),
    guard(eqv(field(bindingRef(scopeBinding), spec.scope.visibility.field), authUserId()), scopeRefusal),
    ...allocations,
    ...guardedPrimary,
    assertSourceChanged(sourceTable, spec.source.id, sourceOperation),
    insert(activityTable, values, { bindIdAs: activityIdBinding }),
  ];
  return {
    [FN]: true,
    __kind: 'Mutation',
    ...authoredFunctionAuth({ auth: spec.auth ?? 'authenticated' }, 'Mutation'),
    args: spec.args ?? {},
    resultContract: spec.result,
    // Preserve the handler-tier detailed descriptor grammar. Generated WWA
    // uses a closed access profile whose authority is the exact owner guard
    // embedded in the same normalized plan; no schema-level alternate
    // declaration source is introduced.
    sequences: allocations.map((step) => ({
      name: step.AllocateSequence.counter,
      scopeTable,
      scopeAccess: {
        kind: 'existing-owner.v1',
        ownerField: spec.scope.visibility.field,
      },
    })),
    plan: { steps, return_value: { Expr: expectExpr(spec.returns, 'WriteWithActivity returns') } },
    writeWithActivityPlan: {
      profile: 'write-with-activity.v1',
      mode: 'existing-owner-v1',
      scopeTable,
      scopeId: spec.scope.id,
      scopeOwnerField: spec.scope.visibility.field,
      sourceTable,
      sourceId: spec.source.id,
      sourceOperation,
      activityTable,
      activityScopeForeignKey: visibility.scopeField,
      activityScopeIncarnation: visibility.scopeIncarnationField,
      requiredCapability: 'write_activity_v1',
      relations: [...relations.values()].map((relation) => ({
        table: relation.table,
        scopeForeignKey: relation.scopeForeignKey,
        scopeIncarnation: relation.scopeIncarnation,
      })),
      provenanceFields: provenance,
      effectFormula: {
        scopeReads: 1,
        scopePatches: authoredWrites.some((step) => step.Patch?.table === scopeTable) ? 1 : 0,
        auxiliaryPointReads: relationshipPointReads,
        sourceWrites: 1,
        activityInserts: 1,
        runtimeIds: sourceOperation === 'insert' ? 2 : 1,
        runtimeNow: 1,
        settlementLookups: 1,
        settlementWrites: 1,
        sequenceAllocations: allocations.length,
        maximumApplicationWrites: 2 + (authoredWrites.some((step) => step.Patch?.table === scopeTable) ? 1 : 0),
      },
    },
  };
}

export const returnBinding = (name) => ({ Binding: name });
export const returnChangedCount = () => ({ kind: 'ChangedCount' });
export const returnDocument = (table, id) => ({ Document: { table, id } });
export const returnLiteral = (value) => ({ Literal: value });
/** Expression-valued return — with record() this covers computed summaries. */
export const returnExpr = (expr) => ({ Expr: expectExpr(expr, 'returnExpr()') });

export const SETTLEMENT_BOUNDED_SKEW_MAX_MS = 86_400_000;

function normalizeBoundedSkew(declaration, steps) {
  if (declaration === undefined) return {};
  assert(
    declaration && typeof declaration === 'object' && !Array.isArray(declaration)
      && Object.keys(declaration).length === 2
      && Object.hasOwn(declaration, 'field')
      && Object.hasOwn(declaration, 'maxSkewMs'),
    'defineMutation boundedSkew must be exactly { field, maxSkewMs }',
  );
  assert(
    typeof declaration.field === 'string' && declaration.field.length > 0,
    'defineMutation boundedSkew.field must be a non-empty declared field name',
  );
  assert(
    Number.isSafeInteger(declaration.maxSkewMs)
      && declaration.maxSkewMs >= 1
      && declaration.maxSkewMs <= SETTLEMENT_BOUNDED_SKEW_MAX_MS,
    `defineMutation boundedSkew.maxSkewMs must be an integer in 1..=${SETTLEMENT_BOUNDED_SKEW_MAX_MS}`,
  );
  const assignments = [];
  for (const step of steps) {
    const [kind, payload] = Object.entries(step)[0] ?? [];
    if (['Insert', 'Patch', 'InsertEach'].includes(kind)
      && Object.hasOwn(payload?.values ?? {}, declaration.field)) {
      assignments.push(payload.values[declaration.field]);
    }
  }
  // @ref LLP 0133#the-bounded-skew-opt-in — the authoring grammar admits
  //   one direct RuntimeNow leaf only; transformed/nested flows are outside
  //   the vocabulary instead of being trusted through dataflow inference.
  assert(
    assignments.length === 1
      && assignments[0]?.__expr === true
      && assignments[0]?.kind === 'RuntimeNow'
      && Object.keys(assignments[0]).length === 2,
    `defineMutation boundedSkew.field ${declaration.field} must name exactly one direct runtimeNow() write`,
  );
  return {
    boundedSkew: {
      field: declaration.field,
      maxSkewMs: declaration.maxSkewMs,
    },
  };
}

export function defineMutation(spec) {
  // @ref LLP 0010#generated-artifacts — function declarations are closed:
  // a typo or not-yet-implemented proposal must refuse, never disappear from
  // the generated function manifest.
  assertKnownSpecFields(spec, 'Mutation', MUTATION_SPEC_FIELDS, 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN');
  assert(spec.stream !== true, 'stream: true is available only on defineAction');
  const steps = Array.isArray(spec.plan) ? spec.plan : [spec.plan];
  assert(steps.length > 0, 'defineMutation requires at least one plan step');
  if (spec.result !== undefined) {
    assert(
      spec.result?.__resultContract === true
        && (spec.result.kind === 'document' || spec.result.kind === 'value'),
      'defineMutation result must use results.document(...) or results.value(...)',
    );
  }
  return {
    [FN]: true,
    __kind: 'Mutation',
    ...authoredFunctionAuth(spec, 'Mutation'),
    args: spec.args ?? {},
    ...(spec.result !== undefined ? { resultContract: spec.result } : {}),
    ...normalizeBoundedSkew(spec.boundedSkew, steps),
    ...normalizeStandardPattern(spec, 'Mutation'),
    plan: { steps, return_value: spec.returns ?? null },
  };
}

/** The named out-of-profile classes (LLP 0051 D2): why a mutation is
 * JS/WASM-tier rather than IR. Declaring one on defineJsMutation makes
 * codegen emit the class-specific "outgrew the IR" info diagnostic into the
 * generated manifest — the tier ladder stays explicit, never vibes. */
export const OUTGREW_IR_CLASSES = Object.freeze({
  'conditional-writes': 'data-dependent step skipping',
  'filtered-read-guards': 'uniqueness/quota/membership guards over non-id keys',
  'type-coercion': 'sanitizing untyped inputs with coercion the pinned library lacks',
  'general-iteration': 'general iteration or data-dependent cross-step control flow',
});

function normalizeSequences(sequences) {
  if (sequences === undefined) return [];
  assert(Array.isArray(sequences) && sequences.length > 0, 'defineJsMutation sequences must be a non-empty array when present');
  const names = new Set();
  return sequences.map((sequence, index) => {
    assert(
      sequence && typeof sequence === 'object' && !Array.isArray(sequence)
        && Object.keys(sequence).length === 3,
      `defineJsMutation sequences[${index}] must be exactly { name, scopeTable, scopeAccess }`,
    );
    assert(
      isUserIdentifier(sequence.name),
      `sequences[${index}].name must be a non-reserved user identifier`,
    );
    assert(!names.has(sequence.name), `sequence ${sequence.name} is declared more than once`);
    names.add(sequence.name);
    assert(
      isUserIdentifier(sequence.scopeTable),
      `sequence ${sequence.name} scopeTable must be a non-reserved user identifier`,
    );
    let scopeAccess;
    if (sequence.scopeAccess === 'public.v1') {
      scopeAccess = 'public.v1';
    } else {
      const access = sequence.scopeAccess;
      assert(
        access && typeof access === 'object' && !Array.isArray(access)
          && Object.keys(access).length === 2
          && typeof access.declaration === 'string' && access.declaration.length > 0
          && Array.isArray(access.roles) && access.roles.length > 0
          && access.roles.every((role) => typeof role === 'string' && role.length > 0)
          && new Set(access.roles).size === access.roles.length,
        `sequence ${sequence.name} scopeAccess must be "public.v1" or { declaration, roles }`,
      );
      scopeAccess = { declaration: access.declaration, roles: [...access.roles] };
    }
    return { name: sequence.name, scopeTable: sequence.scopeTable, scopeAccess };
  });
}

export function defineJsMutation(spec) {
  assert(spec.stream !== true, 'stream: true is available only on defineAction');
  const inline = spec.handler !== undefined;
  const legacy = spec.source !== undefined || spec.exportName !== undefined;
  assert(inline !== legacy, 'defineJsMutation requires exactly one handler form: handler or source + exportName');
  if (legacy) {
    assert(spec.source, 'defineJsMutation requires a handler source file');
    assert(spec.exportName, 'defineJsMutation requires exportName');
  }
  const sequences = normalizeSequences(spec.sequences);
  assert(Array.isArray(spec.writes), 'defineJsMutation requires declared writes');
  // @ref LLP 0135#12-allocation-surfaces — a counter advance is itself a
  // mutation effect, so a sequence-only migration/bridge need not pretend to
  // write an application table. Ordinary JS mutations still require a
  // non-empty write set.
  assert(
    spec.writes.length > 0 || sequences.length > 0,
    'defineJsMutation requires declared writes or sequences',
  );
  if (spec.result !== undefined) {
    assert(
      spec.result?.__resultContract === true
        && (spec.result.kind === 'document' || spec.result.kind === 'value'),
      'defineJsMutation result must use results.document(...) or results.value(...)',
    );
  }
  if (spec.outgrewIr !== undefined) {
    assert(
      typeof spec.outgrewIr === 'string' && OUTGREW_IR_CLASSES[spec.outgrewIr],
      `defineJsMutation outgrewIr must be one of: ${Object.keys(OUTGREW_IR_CLASSES).join(', ')}`,
    );
  }
  return {
    [FN]: true,
    __kind: 'Mutation',
    ...authoredFunctionAuth(spec, 'Mutation'),
    args: spec.args ?? {},
    ...(spec.result !== undefined ? { resultContract: spec.result } : {}),
    ...(spec.outgrewIr !== undefined ? { outgrewIr: spec.outgrewIr } : {}),
    // @ref LLP 0135#12-allocation-surfaces — admission-visible declaration;
    // imperative calls remain runtime checked because generation cannot see
    // through handler control flow.
    sequences,
    js: {
      ...(inline
        ? { inlineHandler: spec.handler }
        : { source: spec.source, exportName: spec.exportName }),
      reads: spec.reads ?? [],
      writes: spec.writes,
      syncabilityClass: 'mutation',
    },
  };
}

// ---------------------------------------------------------------------------
// Actions and cron
// ---------------------------------------------------------------------------

export const runMutation = (name, args = {}, opts = {}) => ({
  RunMutation: { name, args, bind_result_as: opts.bindResultAs ?? null },
});

export function defineAction(spec) {
  // @ref LLP 0249#d1-an-explicit-action-only-runtime-profile — until the
  // accepted isolated-node declaration has a real authoring implementation,
  // its proposed runtime/effects fields must fail loudly instead of compiling
  // into an ordinary portable action with those properties silently dropped.
  assertKnownSpecFields(spec, 'Action', ACTION_SPEC_FIELDS, 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN');
  assert(spec.stream === undefined || typeof spec.stream === 'boolean', 'defineAction stream must be a boolean');
  const stream = spec.stream === true;
  if (spec.result !== undefined) {
    assert(
      spec.result?.__resultContract === true
        && (spec.result.kind === 'document' || spec.result.kind === 'value'),
      'defineAction result must use results.document(...) or results.value(...)',
    );
  }
  if (spec.handler !== undefined) {
    assert(spec.js === undefined && spec.plan === undefined, 'defineAction handler cannot be mixed with js or plan');
    return {
      [FN]: true,
      __kind: 'Action',
      ...authoredFunctionAuth(spec, 'Action'),
      args: spec.args ?? {},
      ...(spec.result !== undefined ? { resultContract: spec.result } : {}),
      ...(stream ? { stream: true } : {}),
      uses: spec.uses ?? [],
      js: {
        inlineHandler: spec.handler,
        reads: [],
        writes: spec.writes ?? [],
        syncabilityClass: 'action',
      },
    };
  }
  if (spec.js) {
    assert(spec.js.source, 'defineAction js.source is required');
    assert(spec.js.exportName, 'defineAction js.exportName is required');
    return {
      [FN]: true,
      __kind: 'Action',
      ...authoredFunctionAuth(spec, 'Action'),
      args: spec.args ?? {},
      ...(spec.result !== undefined ? { resultContract: spec.result } : {}),
      ...(stream ? { stream: true } : {}),
      // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the config
      // entries this action may receive via ctx.secrets.
      uses: spec.uses ?? [],
      js: {
        source: spec.js.source,
        exportName: spec.js.exportName,
        reads: [],
        writes: spec.writes ?? [],
        syncabilityClass: 'action',
      },
    };
  }
  const steps = Array.isArray(spec.plan) ? spec.plan : [spec.plan];
  assert(!stream, 'stream: true requires a JavaScript action handler');
  assert(steps.length > 0, 'defineAction requires a plan or js handler');
  return {
    [FN]: true,
    __kind: 'Action',
    ...authoredFunctionAuth(spec, 'Action'),
    args: spec.args ?? {},
    ...(spec.result !== undefined ? { resultContract: spec.result } : {}),
    uses: spec.uses ?? [],
    plan: { steps, return_value: spec.returns ?? null },
    writes: spec.writes ?? [],
  };
}

export function defineCron(jobs) {
  assert(jobs && typeof jobs === 'object', 'defineCron expects a jobs object');
  return { [CRON]: true, jobs };
}

/**
 * A `params-v1` route-param reference for `defineRoutes` args mappings: the
 * `{"$param": name}` grammar of LLP 0092 §0E.6, usable only at a top-level
 * arg position.
 */
export const routeParam = (name) => {
  assert(typeof name === 'string' && name.length > 0, 'routeParam expects a param name');
  return { $param: name };
};

/**
 * Declare the app's route→query manifest (LLP 0092 §0C.1): which
 * `(function, args)` pairs each route needs before app JS runs. Compiled by
 * codegen into `generated/routes.manifest.json` and admitted beside the
 * functions manifest; its canonical hash is the `routeManifestHash`
 * generation component (LLP 0091 §0A.6). Authors select queries for preload
 * only — inline disclosure is the function-level `publicInline` fact, never
 * a route-manifest field.
 *
 * @ref LLP 0092#0c1-routequery-manifest-artifact — pattern grammar,
 *   `params-v1` mapping rules, and the admission obligations.
 */
export function defineRoutes(routes) {
  assert(Array.isArray(routes), 'defineRoutes expects an array of route entries');
  const out = [];
  for (const entry of routes) {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'defineRoutes entries must be objects');
    for (const key of Object.keys(entry)) {
      assert(key === 'route' || key === 'queries' || key === 'persist', `defineRoutes entry has unknown field ${key}`);
    }
    assert(typeof entry.route === 'string' && entry.route.startsWith('/'), 'defineRoutes entries require a route pattern string');
    assert(Array.isArray(entry.queries) && entry.queries.length > 0, `route ${entry.route} requires at least one query`);
    const queries = entry.queries.map((spec) => {
      assert(spec && typeof spec === 'object' && !Array.isArray(spec), `route ${entry.route} query specs must be objects`);
      for (const key of Object.keys(spec)) {
        assert(key === 'function' || key === 'args', `route ${entry.route} query spec has unknown field ${key}`);
      }
      assert(typeof spec.function === 'string' && spec.function.length > 0, `route ${entry.route} query specs require a function name`);
      return { function: spec.function, args: spec.args ?? {} };
    });
    if (entry.persist !== undefined) {
      assert(typeof entry.persist === 'boolean', `route ${entry.route} persist must be boolean`);
    }
    out.push({
      route: entry.route,
      queries,
      ...(entry.persist === false ? { persist: false } : {}),
    });
  }
  return { [ROUTES]: true, routes: out };
}

/**
 * Declare the app's config entries (API keys and deployment settings).
 * Names, purposes, and acquisition metadata are app source — public by
 * construction; values live only in the deployment's config store.
 *
 * @ref LLP 0036#declared-configuration-in-the-manifest — entries ride the
 * generated function manifest the way cron jobs do.
 */
export function defineConfig(entries) {
  assert(entries && typeof entries === 'object', 'defineConfig expects an entries object');
  return { [CONFIG]: true, entries };
}

// ---------------------------------------------------------------------------

/**
 * Declare one generated upload intent (LLP 0044 §Generated upload intents).
 * The declaration fixes accepted types, byte bounds, delivery profile,
 * read-access policy, and processing recipe; the client cannot supply or
 * widen any of those facts, and one upload task carries exactly one file.
 * The authorizer runs server-side under LLP 0039 authority with the same
 * closed inline-handler rules as LLP 0108: inline `authorize` or
 * `source` + `exportName`, never both.
 */
export function defineAssetUpload(spec) {
  assertKnownSpecFields(spec, 'AssetUpload', ASSET_UPLOAD_FIELDS);
  const inline = spec.authorize !== undefined;
  const legacy = spec.source !== undefined || spec.exportName !== undefined;
  assert(inline !== legacy, 'AssetUpload requires exactly one authorizer form: authorize or source + exportName');
  if (legacy) {
    assert(spec.source, 'AssetUpload requires an authorizer source file');
    assert(spec.exportName, 'AssetUpload requires exportName');
  }
  if (spec.auth !== undefined) {
    assert(AUTH_REQUIREMENTS.has(spec.auth), 'AssetUpload auth must be public, optional-user, or authenticated');
  }
  const reads = spec.reads === undefined ? [] : stringArray(spec.reads, 'AssetUpload reads', { allowEmpty: true });
  assert(spec.accept && typeof spec.accept === 'object' && !Array.isArray(spec.accept), 'AssetUpload requires accept');
  exactObject(spec.accept, 'AssetUpload accept', ASSET_ACCEPT_FIELDS);
  const mediaTypes = stringArray(spec.accept.mediaTypes, 'AssetUpload accept.mediaTypes');
  for (const mediaType of mediaTypes) {
    assert(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+$/i.test(mediaType), `AssetUpload accept.mediaTypes entry ${mediaType} is not a media type`);
    // Trusted finalization detects the type from bytes; an accept entry the
    // detector can never produce admits an intent no upload can ever satisfy
    // (0137 A1-f10: text/plain detects as application/octet-stream and every
    // upload refuses at finalize). Mirror src/assets.rs detect_content_type.
    assert(
      acceptEntryDetectable(mediaType),
      `AssetUpload accept.mediaTypes entry ${mediaType} can never finalize: trusted `
      + 'detection identifies only image/jpeg, image/png, image/gif, image/webp, '
      + 'application/pdf, video/mp4, video/quicktime, application/gzip, '
      + 'application/zip, and application/octet-stream (the fallback for '
      + 'everything else, including plain text). Accept application/octet-stream '
      + 'for opaque files, or a detectable concrete type.',
    );
  }
  assert(
    Number.isSafeInteger(spec.accept.maxBytes) && spec.accept.maxBytes > 0,
    'AssetUpload accept.maxBytes must be a positive safe integer',
  );
  let delivery = { kind: 'private-strict' };
  if (spec.delivery !== undefined) {
    exactObject(spec.delivery, 'AssetUpload delivery', new Set(['kind']));
    assert(ASSET_DELIVERY_KINDS.has(spec.delivery.kind), 'AssetUpload delivery.kind must be public-immutable, private-signed, or private-strict');
    delivery = { kind: spec.delivery.kind };
  }
  let access = { read: 'owner-only' };
  if (spec.access !== undefined) {
    exactObject(spec.access, 'AssetUpload access', new Set(['read']));
    assert(ASSET_READ_ACCESS.has(spec.access.read), 'AssetUpload access.read must be owner-only or via-references');
    access = { read: spec.access.read };
  }
  assert(
    spec.grants === undefined || spec.grants === true,
    'AssetUpload grants must be true when present',
  );
  let image;
  if (spec.image !== undefined) {
    exactObject(spec.image, 'AssetUpload image', ASSET_IMAGE_FIELDS);
    assert(ASSET_LOCATION_POLICIES.has(spec.image.location), "AssetUpload image.location must be 'strip' or 'retain' — there is no implicit fallback");
    const variants = (spec.image.variants ?? []).map((variant, index) => {
      exactObject(variant, `AssetUpload image.variants[${index}]`, ASSET_VARIANT_FIELDS);
      assert(typeof variant.key === 'string' && variant.key.length > 0, `AssetUpload image.variants[${index}].key is required`);
      assert(Number.isSafeInteger(variant.width) && variant.width > 0, `AssetUpload image.variants[${index}].width must be a positive integer`);
      assert(variant.required === undefined || typeof variant.required === 'boolean', `AssetUpload image.variants[${index}].required must be a boolean when present`);
      // Absence stays canonical: an omitted `required` adds nothing to the
      // policy identity, so pre-existing intent hashes are unchanged.
      return { key: variant.key, width: variant.width, ...(variant.required === true ? { required: true } : {}) };
    });
    assert(variants.length <= 8, 'AssetUpload image.variants is bounded to 8');
    image = { location: spec.image.location, ...(variants.length > 0 ? { variants } : {}) };
  }
  // @ref LLP 0044#video-location-policy-the-video--location--sibling-block-dated-decision-2026-08-03 —
  //   video location policy is a distinct sibling declaration; it is not an
  //   alias for image policy, whose frozen authoring/hash spelling is intact.
  let video;
  if (spec.video !== undefined) {
    exactObject(spec.video, 'AssetUpload video', ASSET_VIDEO_FIELDS);
    assert(ASSET_LOCATION_POLICIES.has(spec.video.location), "AssetUpload video.location must be 'strip' or 'retain' — there is no implicit fallback");
    video = { location: spec.video.location };
  }
  let on;
  if (spec.on !== undefined) {
    exactObject(spec.on, 'AssetUpload on', new Set(ASSET_CALLBACK_EVENTS));
    const entries = {};
    for (const event of ASSET_CALLBACK_EVENTS) {
      if (spec.on[event] === undefined) continue;
      assert(
        typeof spec.on[event] === 'string' && spec.on[event].length > 0,
        `AssetUpload on.${event} must name a declared mutation export`,
      );
      entries[event] = spec.on[event];
    }
    assert(Object.keys(entries).length > 0, 'AssetUpload on must declare at least one callback');
    on = entries;
  }
  return {
    [ASSET_UPLOAD]: true,
    __kind: 'AssetUploadIntent',
    args: spec.args ?? {},
    auth: spec.auth ?? 'authenticated',
    reads,
    accept: { mediaTypes, maxBytes: spec.accept.maxBytes },
    delivery,
    access,
    ...(spec.grants === true ? { grants: true } : {}),
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
    ...(on ? { on } : {}),
    ...(inline
      ? { authorize: spec.authorize }
      : { source: spec.source, exportName: spec.exportName }),
  };
}

export function isAssetUploadDef(value) {
  return !!(value && value[ASSET_UPLOAD]);
}

export function isCommandDef(value) {
  return !!(value && value[COMMAND]);
}

export function isSurfaceDef(value) {
  return !!(value && value[SURFACE]);
}

export function isSurfaceBinding(value) {
  return !!(value && value[SURFACE_BINDING]);
}

export function isFunctionDef(value) {
  return !!(value && value[FN]);
}

export function isCronDef(value) {
  return !!(value && value[CRON]);
}

export function isMaintainedProjectionDef(value) {
  return !!(value && value[PROJECTION]);
}

export function isRoutesDef(value) {
  return !!(value && value[ROUTES]);
}

export function isConfigDef(value) {
  return !!(value && value[CONFIG]);
}

export function isTableDef(value) {
  return !!(
    value
    && value[TABLE]
    && OBJECT_GET_PROTOTYPE_OF(value) === TableBuilder.prototype
  );
}

export function isEphemeralCollectionDef(value) {
  return !!(value && value[EPHEMERAL_COLLECTION]);
}

export function isEphemeralDef(value) {
  return !!(value && value[EPHEMERAL]);
}

export function assert(cond, message, code = undefined) {
  if (cond) return;
  const error = new Error(`[snapback-define] ${message}`);
  if (code !== undefined) error.code = code;
  throw error;
}
