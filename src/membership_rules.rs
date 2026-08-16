//! LLP 0056 M3 — declaration-bound membership rule helpers, the membership
//! predicate IR's capture + SQL lowering, and the `ctx.permissions` membership
//! read primitive.
//!
//! # THE CAPTURE-REPRESENTATION TRAP — the reason this module is careful
//!
//! A membership lookup MUST record **ordinary** snapshot-bound row/query
//! dependencies through the unique `(principal, resource)` index — **never**
//! [`CapturedReadKind::Permission`]. `Permission` is legacy epoch-scope
//! machinery that **both** the live matcher (`src/live_matcher.rs`) **and**
//! commit-time read-set validation (`src/storage.rs::validate_captured_read_set`)
//! ignore (each has a `CapturedReadKind::Permission => {}` no-op arm). Reaching
//! for it — the obvious-looking kind — makes two pinned behaviours silently
//! false: the matcher never wakes on a membership change, and a role revoked
//! between check and commit *races* the commit instead of invalidating it. The
//! review loop caught exactly this; it "would have shipped silently."
//!
//! Every capture this module emits is therefore a [`CapturedReadKind::Query`]
//! dependency whose predicate is a synthetic single-table plan over the
//! membership table, so it flows through the exact machinery both paths already
//! honour — including the pinned **empty-result** form, so a membership insert
//! wakes a subscription that previously matched nothing.
//!
//! @ref LLP 0056#what-exists-what-this-adds
//!   — ordinary snapshot-bound deps, never `Permission`; empty lookups capture
//!   the empty-result query dependency; row-field resource refs capture a
//!   conservative table-level dependency in v1.
//! @ref LLP 0053#agent-auth-protected-query-inputs-amended-2026-07-14-eng-24906
//!   — the membership read is `DatabaseCaptured` on both outcomes; the denial is
//!   the already-classified `TerminalAuthorization` deny, so each primitive
//!   carries exactly one admission class.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    FieldType, FilterExpr, FilterOp, HandlerInput, MembershipManifest, MembershipPredicate,
    MembershipResourceRef, OrderDirection, OrderExpr, QUERY_MAX_LIMIT, QueryPlan, SchemaManifest,
    TableManifest, ValueExpr,
};
use crate::storage::{CapturedReadDependency, CapturedReadKind, DbRead, KeysetAfter};
use serde_json::{Value, json};

pub(crate) use crate::manifest::{
    effective_membership_roles as effective_roles, find_membership_declaration as find_declaration,
};

/// Validate dev-only `--as-role` inputs against app-global declarations. A
/// bare role is usable only when exactly one app-scoped declaration owns that
/// vocabulary entry; declaration-qualified roles bind explicitly. Scoped
/// declarations are intentionally absent from this resolver.
///
/// @ref LLP 0056#what-stays-out-of-the-session -- impersonated global roles
///   are declaration-safe and scoped memberships are never impersonated.
pub(crate) fn validate_impersonated_global_roles(
    schema: &SchemaManifest,
    roles: &[String],
) -> SnapbackResult<()> {
    for role in roles {
        if let Some((declaration, role)) = role.split_once(':') {
            let valid = find_declaration(schema, declaration).is_some_and(|(_, membership)| {
                membership.scope == crate::manifest::MembershipScope::App
                    && membership.roles.iter().any(|candidate| candidate == role)
            });
            if !valid {
                return Err(SnapbackError::error(
                    "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID",
                    "auth",
                    "qualified impersonated role does not name one app-global declaration role",
                ));
            }
            continue;
        }
        let owners = schema
            .tables
            .iter()
            .filter_map(|table| table.membership.as_ref())
            .filter(|membership| {
                membership.scope == crate::manifest::MembershipScope::App
                    && membership.roles.iter().any(|candidate| candidate == role)
            })
            .count();
        if owners > 1 {
            return Err(SnapbackError::error(
                "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS",
                "auth",
                "bare impersonated role belongs to more than one app-global membership declaration",
            ));
        }
        if owners == 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID",
                "auth",
                "bare impersonated role does not belong to an app-global membership declaration",
            ));
        }
    }
    Ok(())
}

pub(crate) fn impersonated_global_role_satisfies(
    membership: &MembershipManifest,
    declaration: &str,
    required_roles: &[String],
    impersonated_roles: &[String],
) -> bool {
    if membership.scope != crate::manifest::MembershipScope::App {
        return false;
    }
    required_roles.iter().any(|required| {
        impersonated_roles.iter().any(|presented| {
            presented == required || presented == &format!("{declaration}:{required}")
        })
    })
}

/// How a membership probe binds its `resource` axis, and therefore how finely
/// the capture can scope its dependency.
pub(crate) enum ResourceBinding {
    /// A resolved resource value (a query argument or the `ctx.permissions`
    /// call). The `(principal, resource)` range is exact, so the capture is
    /// fine-grained — including the empty-result form.
    Fixed(Value),
    /// The resource varies per outer row (the row-field helper). v1 captures a
    /// **conservative** dependency scoped to the effective principal only:
    /// coarse wake is a re-query cost; the reverse choice would be a
    /// correctness loss.
    PerRow,
    /// `scope: "app"` — the system-constant singleton resource. The principal
    /// is the whole key, so the capture is fine-grained.
    AppSingleton,
}

/// The synthetic single-table plan over the membership table that both (a) the
/// probe executes and (b) the capture's `Query` dependency serialises. It uses
/// `Literal` operands so the dependency is **self-contained**: the matcher and
/// the commit validator evaluate a changed membership row against it directly,
/// with no dependence on which `HandlerInput` they are handed.
pub(crate) fn membership_probe_plan(
    membership: &MembershipManifest,
    table_name: &str,
    principal: &str,
    resource: &ResourceBinding,
    roles: &[String],
) -> QueryPlan {
    let mut filters = vec![FilterExpr {
        field: membership.principal.clone(),
        op: FilterOp::Eq,
        value: ValueExpr::Literal(Value::String(principal.to_owned())),
    }];
    if let (ResourceBinding::Fixed(value), Some(resource_field)) =
        (resource, membership.resource.as_ref())
    {
        filters.push(FilterExpr {
            field: resource_field.clone(),
            op: FilterOp::Eq,
            value: ValueExpr::Literal(value.clone()),
        });
    }
    // Role filter: precise for the fine cases; deliberately omitted for the
    // conservative `PerRow` case so ANY of this principal's membership writes
    // wake the query (a role UPDATE out of the set must not be missed).
    if !matches!(resource, ResourceBinding::PerRow) {
        filters.push(FilterExpr {
            field: membership.role.clone(),
            op: FilterOp::In,
            value: ValueExpr::Literal(Value::Array(
                roles.iter().cloned().map(Value::String).collect(),
            )),
        });
    }
    QueryPlan {
        table_visibility: None,
        table: table_name.to_owned(),
        filters,
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        indexed_by: None,
    }
}

/// Build the **ordinary** `Query` capture dependency for a membership probe —
/// never `Permission` (see the module docs). `matching_ids` is empty for an
/// absent lookup, which yields the pinned **empty-result** query dependency
/// (`rows: [], result_count: 0`) so a later membership insert / role upgrade
/// wakes a subscription that previously matched nothing.
pub(crate) fn membership_capture_dependency(
    probe_plan: &QueryPlan,
    table_version: u64,
    matching_ids: Vec<String>,
) -> SnapbackResult<CapturedReadDependency> {
    let result_count = matching_ids.len();
    let predicate = serde_json::to_value(probe_plan).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_SERIALIZE_FAILED",
            "runtime",
            "membership dependency could not be serialized",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    Ok(CapturedReadDependency {
        // ORDINARY Query kind, NOT Permission — the whole point of this module.
        // @ref LLP 0056#what-exists-what-this-adds
        kind: CapturedReadKind::Query,
        table: Some(probe_plan.table.clone()),
        id: None,
        version: Some(table_version),
        predicate: Some(predicate),
        rows: matching_ids,
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: Some(result_count),
        boundary: None,
    })
}

/// The outcome of the internal membership read that backs `requireRole`.
pub(crate) struct MembershipReadOutcome {
    /// Whether a satisfying membership row exists.
    pub present: bool,
    /// The ordinary snapshot-bound capture (on **both** outcomes).
    pub dependency: CapturedReadDependency,
}

/// The one new host operation backing `requireRole`: the internal membership
/// read, class `DatabaseCaptured` on **both** outcomes. It runs the
/// declaration's probe as an ordinary single-table query over the membership
/// table and returns the presence bit together with the ordinary capture.
///
/// **Non-recursive by construction:** the query executor applies no
/// row-visibility rules, so the table's own visibility policy governs what
/// *rows* clients may read, never whether the evaluator may consult the facts —
/// a locked-down roster cannot break role evaluation for guests.
///
/// There is deliberately **no application-returning form** (no
/// `ctx.permissions.<decl>.get()`): handing a handler a membership fact obtained
/// through this visibility-bypassing read would re-open, as an API, the
/// existence oracle the invariant denial payload closes.
///
/// @ref LLP 0056#rule-helpers — the internal primitive with no
///   application-returning form; non-recursive evaluation.
pub(crate) fn membership_read(
    db: &DbRead<'_>,
    membership: &MembershipManifest,
    table_name: &str,
    principal: &str,
    resource: ResourceBinding,
    roles: &[String],
) -> SnapbackResult<MembershipReadOutcome> {
    let probe = membership_probe_plan(membership, table_name, principal, &resource, roles);
    let output = db.query_private_membership(&probe, &HandlerInput::default())?;
    let ids: Vec<String> = output
        .rows
        .iter()
        .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let present = !ids.is_empty();
    let dependency = membership_capture_dependency(&probe, output.version, ids)?;
    Ok(MembershipReadOutcome {
        present,
        dependency,
    })
}

/// The trusted, **invariant** role denial. It reuses the EXISTING trusted
/// `SNAPBACK_AUTH_PERMISSION_DENIED` producer
/// (`SnapbackError::trusted_permission_denied`) — **no new trusted code**, and
/// LLP 0053's producer enumeration stays closed. `requireRole` is generated
/// sugar over (membership read → this deny), not a third trusted operation.
///
/// The client-visible payload is exactly `{ kind: "role" }` — never the
/// caller's state, the required roles, the declaration id, or the resource.
/// Because the evaluator deliberately bypasses the table's row-visibility rules,
/// any finer distinction (`absent` vs `wrong-role`) would tell a prober "a
/// hidden membership row exists here with another role" — an existence oracle
/// under LLP 0053's never-echo rule. The full trace (required roles,
/// declaration, resource, caller state) lives only on the gated doctor/audit
/// surface.
///
/// @ref LLP 0056#rule-helpers — invariant `{ kind: "role" }`; no new trusted
///   code; the denial payload is not an oracle.
pub(crate) fn role_denial() -> SnapbackError {
    SnapbackError::trusted_permission_denied("role requirement not satisfied")
        .with_details(json!({ "kind": "role" }))
}

/// A host-private membership read whose dependencies must be registered before
/// its value or denial is surfaced. Keeping the result private makes the
/// ordering structural at every caller: [`Self::finish`] drains every capture
/// first and only then returns the result.
///
/// @ref LLP 0056#invalidation-the-llp-0053-mapping — empty membership results
///   remain captured matcher dependencies so a later grant wakes the read.
pub struct CapturedMembershipReadOutcome<T> {
    result: SnapbackResult<T>,
    dependencies: Vec<CapturedReadDependency>,
}

impl<T> CapturedMembershipReadOutcome<T> {
    fn allowed(value: T, dependencies: Vec<CapturedReadDependency>) -> Self {
        Self {
            result: Ok(value),
            dependencies,
        }
    }

    fn denied(denial: SnapbackError, dependencies: Vec<CapturedReadDependency>) -> Self {
        Self {
            result: Err(denial),
            dependencies,
        }
    }

    pub fn finish(self, mut register: impl FnMut(CapturedReadDependency)) -> SnapbackResult<T> {
        for dependency in self.dependencies {
            register(dependency);
        }
        self.result
    }
}

/// The `requireRole` composition: the membership read, then — on a failed check
/// — the trusted deny. The read's ordinary capture is returned on **both**
/// outcomes so terminalization can preserve it (the denial-witness minimum: a
/// stale deny cannot discharge an obligation floor newer than its witness).
///
/// @ref LLP 0056#rule-helpers — terminalization
///   preserves the membership lookup's snapshot-bound dependency.
pub(crate) fn require_role(
    db: &DbRead<'_>,
    membership: &MembershipManifest,
    table_name: &str,
    principal: &str,
    resource: ResourceBinding,
    roles: &[String],
) -> SnapbackResult<CapturedMembershipReadOutcome<()>> {
    let outcome = membership_read(db, membership, table_name, principal, resource, roles)?;
    if outcome.present {
        Ok(CapturedMembershipReadOutcome::allowed(
            (),
            vec![outcome.dependency],
        ))
    } else {
        Ok(CapturedMembershipReadOutcome::denied(
            role_denial(),
            vec![outcome.dependency],
        ))
    }
}

/// Host-private page request for the authority-profile roster. `after` is an
/// already-verified internal boundary; a public generated surface must keep it
/// inside the existing opaque cursor custody envelope.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthorityRosterPageRequestV1 {
    pub limit: usize,
    pub after: Option<KeysetAfter>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuthorityRosterPageV1 {
    pub rows: Vec<Value>,
    pub next: Option<KeysetAfter>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorityMyRoleV1 {
    pub role: String,
    pub status: crate::storage::AuthorityMembershipStatusV1,
}

fn authority_profile_declaration<'a>(
    schema: &'a SchemaManifest,
    declaration: &str,
) -> SnapbackResult<(
    &'a TableManifest,
    &'a MembershipManifest,
    &'a crate::manifest::AuthorityProfileV1,
)> {
    let Some((table, membership)) = find_declaration(schema, declaration) else {
        return Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
            "auth",
            "authority roster operation names an unknown membership declaration",
        )
        .with_details(json!({ "declaration": declaration })));
    };
    let Some(profile) = table.authority_profile.as_ref() else {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTHORITY_PROFILE_REQUIRED",
            "auth",
            "host-private roster reads require an authorityProfile declaration",
        )
        .with_details(json!({ "declaration": declaration })));
    };
    if profile.id != membership.effective_id(&table.name) {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTHORITY_PROFILE_INVALID",
            "auth",
            "authority profile identity does not match its membership declaration",
        )
        .with_details(json!({ "declaration": declaration })));
    }
    Ok((table, membership, profile))
}

fn authority_resource_binding(
    membership: &MembershipManifest,
    resource: Option<&str>,
) -> SnapbackResult<ResourceBinding> {
    match (&membership.resource, resource) {
        (Some(_), Some(resource)) if !resource.is_empty() => {
            Ok(ResourceBinding::Fixed(Value::String(resource.to_owned())))
        }
        (Some(_), _) => Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
            "auth",
            "resource-scoped authority roster read requires a resource id",
        )),
        (None, None) => Ok(ResourceBinding::AppSingleton),
        (None, Some(_)) => Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_RESOURCE_UNEXPECTED",
            "auth",
            "app-scoped authority roster read does not accept a resource id",
        )),
    }
}

fn authority_roster_plan(
    table: &TableManifest,
    membership: &MembershipManifest,
    resource: &ResourceBinding,
    limit: usize,
    role_visible: bool,
) -> QueryPlan {
    let mut filters = Vec::new();
    if let (ResourceBinding::Fixed(value), Some(resource_field)) =
        (resource, membership.resource.as_ref())
    {
        filters.push(FilterExpr {
            field: resource_field.clone(),
            op: FilterOp::Eq,
            value: ValueExpr::Literal(value.clone()),
        });
    }
    filters.push(FilterExpr {
        field: membership.role.clone(),
        op: FilterOp::In,
        value: ValueExpr::Literal(Value::Array(
            membership
                .roles
                .iter()
                .cloned()
                .map(Value::String)
                .collect(),
        )),
    });
    let mut order = Vec::new();
    if role_visible {
        order.push(OrderExpr {
            field: membership.role.clone(),
            direction: OrderDirection::Asc,
            max_encoded_bytes: None,
        });
    }
    order.push(OrderExpr {
        field: membership.principal.clone(),
        direction: OrderDirection::Asc,
        max_encoded_bytes: None,
    });
    QueryPlan {
        table_visibility: None,
        table: table.name.clone(),
        filters,
        membership_filters: Vec::new(),
        order,
        limit: Some(limit),
        // The generated `_membership_reverse` index is host-owned and is not
        // repeated in `TableManifest::indexes`; naming it through the public
        // `indexedBy` validator would therefore reject the otherwise valid
        // private plan. The profile activation contract qualifies that index,
        // while SQLite selects it for this exact scope/role/principal shape.
        indexed_by: None,
    }
}

/// Evaluate one roster page entirely inside the host. Admission first proves
/// that the caller has an active role in the exact scope; only then may the
/// visibility-bypassing roster query run. Missing scopes and non-members both
/// fail with the same invariant role denial because neither produces a caller
/// membership witness.
///
/// @ref LLP 0240#d3-generate-the-ordinary-roster-and-role-surface — profile
///   visible fields are the complete projection allowlist and refusals retain
///   LLP 0056 non-enumeration.
pub fn authority_roster_list(
    db: &DbRead<'_>,
    declaration: &str,
    caller: Option<&str>,
    resource: Option<&str>,
    page: AuthorityRosterPageRequestV1,
) -> SnapbackResult<CapturedMembershipReadOutcome<AuthorityRosterPageV1>> {
    if page.limit == 0 || page.limit > QUERY_MAX_LIMIT {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTHORITY_ROSTER_PAGE_INVALID",
            "auth",
            format!("authority roster page limit must be 1..={QUERY_MAX_LIMIT}"),
        ));
    }
    let declaration = declaration.to_owned();
    let caller = caller.map(str::to_owned);
    let resource = resource.map(str::to_owned);
    db.with_pinned_read_view(move |db| {
        let (table, membership, profile) =
            authority_profile_declaration(db.schema(), &declaration)?;
        let binding = authority_resource_binding(membership, resource.as_deref())?;
        let Some(caller) = caller.as_deref() else {
            return Ok(CapturedMembershipReadOutcome::denied(
                role_denial(),
                Vec::new(),
            ));
        };
        let caller_read = membership_read(
            &db,
            membership,
            &table.name,
            caller,
            match &binding {
                ResourceBinding::Fixed(value) => ResourceBinding::Fixed(value.clone()),
                ResourceBinding::AppSingleton => ResourceBinding::AppSingleton,
                ResourceBinding::PerRow => unreachable!("authority roster binds one scope"),
            },
            &membership.roles,
        )?;
        if !caller_read.present {
            return Ok(CapturedMembershipReadOutcome::denied(
                role_denial(),
                vec![caller_read.dependency],
            ));
        }

        for field in &profile.roster.visible_fields {
            if field.starts_with('_') || table.field(field).is_none() {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID",
                    "auth",
                    "authority profile roster projection names an unknown or system field",
                )
                .with_details(json!({
                    "declaration": declaration,
                    "field": field,
                })));
            }
        }

        let role_visible = profile
            .roster
            .visible_fields
            .iter()
            .any(|field| field == &membership.role);
        let plan = authority_roster_plan(table, membership, &binding, page.limit, role_visible);
        let mut output = db.query_private_membership_keyset(
            &plan,
            &HandlerInput::default(),
            page.after.as_ref(),
            page.limit + 1,
        )?;
        let has_more = output.rows.len() > page.limit;
        output.rows.truncate(page.limit);
        let next = if has_more {
            output.rows.last().map(|row| KeysetAfter {
                entries: plan
                    .order
                    .iter()
                    .map(|order| (order.field.clone(), row[&order.field].clone()))
                    .collect(),
                id: row["_id"].as_str().unwrap_or_default().to_owned(),
            })
        } else {
            None
        };
        let matching_ids = output
            .rows
            .iter()
            .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
            .collect();
        let roster_dependency = membership_capture_dependency(&plan, output.version, matching_ids)?;
        let rows = output
            .rows
            .into_iter()
            .map(|row| {
                let mut projected = serde_json::Map::new();
                for field in &profile.roster.visible_fields {
                    if let Some(value) = row.get(field) {
                        projected.insert(field.clone(), value.clone());
                    }
                }
                Value::Object(projected)
            })
            .collect();
        Ok(CapturedMembershipReadOutcome::allowed(
            AuthorityRosterPageV1 { rows, next },
            vec![caller_read.dependency, roster_dependency],
        ))
    })
}

/// Return only the caller's own role/status authority fact. Pending roles are
/// deliberately representable here while they remain excluded from `list`
/// admission and active roster rows.
pub fn authority_my_role(
    db: &DbRead<'_>,
    declaration: &str,
    caller: Option<&str>,
    resource: Option<&str>,
) -> SnapbackResult<CapturedMembershipReadOutcome<AuthorityMyRoleV1>> {
    let declaration = declaration.to_owned();
    let caller = caller.map(str::to_owned);
    let resource = resource.map(str::to_owned);
    db.with_pinned_read_view(move |db| {
        let (table, membership, _profile) =
            authority_profile_declaration(db.schema(), &declaration)?;
        let binding = authority_resource_binding(membership, resource.as_deref())?;
        let Some(caller) = caller.as_deref() else {
            return Ok(CapturedMembershipReadOutcome::denied(
                role_denial(),
                Vec::new(),
            ));
        };
        let roles = membership
            .vocabulary()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let plan = membership_probe_plan(membership, &table.name, caller, &binding, &roles);
        let output = db.query_private_membership(&plan, &HandlerInput::default())?;
        let ids = output
            .rows
            .iter()
            .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
            .collect();
        let dependency = membership_capture_dependency(&plan, output.version, ids)?;
        let Some(row) = output.rows.first() else {
            return Ok(CapturedMembershipReadOutcome::denied(
                role_denial(),
                vec![dependency],
            ));
        };
        let Some(role) = row.get(&membership.role).and_then(Value::as_str) else {
            return Ok(CapturedMembershipReadOutcome::denied(
                role_denial(),
                vec![dependency],
            ));
        };
        let role = role.to_owned();
        let status = if membership.roles.iter().any(|candidate| candidate == &role) {
            crate::storage::AuthorityMembershipStatusV1::Active
        } else {
            crate::storage::AuthorityMembershipStatusV1::Invited
        };
        Ok(CapturedMembershipReadOutcome::allowed(
            AuthorityMyRoleV1 { role, status },
            vec![dependency],
        ))
    })
}

/// Load-time validation of a membership predicate carried by a query over
/// `queried_table`. The declaration must exist; a `hasRole` role list must lie
/// within the declaration's write vocabulary; and a row-field resource
/// reference must be `_id` on the declared resource table or a nominal
/// `v.id(resourceTable)` field. A predicate that names a nonexistent
/// declaration, an unknown role, or a differently typed row field is a
/// **load-time error** (fail-closed). Query arguments remain dynamically typed
/// on this wire and are value-checked at execution; the authoring surface does
/// the corresponding nominal check while it still has argument validators.
///
/// @ref LLP 0056#rule-helpers — `resourceRef` is a row field of the queried
///   table or a query argument of the declared resource type; anything else is
///   a load-time error.
pub(crate) fn validate_membership_predicate(
    schema: &SchemaManifest,
    queried_table: &TableManifest,
    predicate: &MembershipPredicate,
) -> SnapbackResult<()> {
    let Some((_table, membership)) = find_declaration(schema, &predicate.declaration) else {
        return Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
            "manifest",
            format!(
                "membership predicate names declaration {:?}, which is not declared",
                predicate.declaration
            ),
        )
        .with_details(json!({ "declaration": predicate.declaration.clone() })));
    };

    if let Some(roles) = &predicate.roles {
        if roles.is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_MEMBERSHIP_EMPTY_ROLE_LIST",
                "manifest",
                format!(
                    "hasRole on declaration {:?} names no roles",
                    predicate.declaration
                ),
            ));
        }
        let vocabulary: Vec<&str> = membership.vocabulary().collect();
        for role in roles {
            if !vocabulary.contains(&role.as_str()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
                    "manifest",
                    format!(
                        "hasRole on declaration {:?} names role {role:?}, which is outside the closed vocabulary",
                        predicate.declaration
                    ),
                )
                .with_details(json!({ "role": role.clone() })));
            }
        }
    }

    match &predicate.resource {
        MembershipResourceRef::RowField(field) => {
            let valid = match membership.resource_table.as_deref() {
                // App-scoped declarations use the singleton regardless of the
                // syntactic resource placeholder.
                None if membership.resource.is_none() => true,
                Some(resource_table) if field == "_id" => queried_table.name == resource_table,
                Some(resource_table) => queried_table.field(field).is_some_and(|field| {
                    matches!(
                        &field.field_type,
                        FieldType::Id { table } if table == resource_table
                    )
                }),
                None => false,
            };
            if !valid {
                return Err(SnapbackError::error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID",
                    "manifest",
                    format!(
                        "membership predicate resource row field {field:?} is not nominally typed for resource table {:?}",
                        membership.resource_table
                    ),
                )
                .with_details(json!({
                    "field": field.clone(),
                    "resourceTable": membership.resource_table.clone(),
                })));
            }
        }
        MembershipResourceRef::Arg {
            path,
            resource_table,
        } => {
            let path_is_valid =
                !path.is_empty() && path.split('.').all(|segment| !segment.is_empty());
            let type_is_valid = match (
                membership.resource.as_deref(),
                membership.resource_table.as_deref(),
            ) {
                (Some(_), Some(expected_table)) => {
                    resource_table.as_deref() == Some(expected_table)
                }
                // App scope has no resource axis. Codegen still lowers the
                // helper through one closed synthetic argument reference so
                // it cannot be confused with a resource-scoped `Id<table>`.
                (None, None) => resource_table.is_none() && path == "__snapbackApp",
                _ => false,
            };
            if !path_is_valid || !type_is_valid {
                return Err(SnapbackError::error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_REF_INVALID",
                    "manifest",
                    format!(
                        "membership predicate resource argument {path:?} is not nominally typed for resource table {:?}",
                        membership.resource_table
                    ),
                )
                .with_details(json!({
                    "path": path.clone(),
                    "resourceTable": resource_table.clone(),
                    "expectedResourceTable": membership.resource_table.clone(),
                })));
            }
        }
    }
    Ok(())
}

/// Null-safe resolution of a dotted argument path against a query's args.
fn resolve_arg(args: &Value, path: &str) -> Value {
    let mut current = args;
    for segment in path.split('.') {
        match current.get(segment) {
            Some(value) => current = value,
            None => return Value::Null,
        }
    }
    current.clone()
}

/// The captured membership dependencies for one declarative helper predicate on
/// a live/HostPlan query. Emitted alongside the primary query's own capture in
/// `live_matcher::query_dependencies_from_plan`. Every dependency is an ordinary
/// `Query` kind over the membership table — the whole point of this module.
///
/// - a **query-argument** (or app-singleton) resource ref resolves to a fixed
///   `(principal, resource)` range, so the probe runs and the exact
///   present/empty-result dependency is recorded (a later matching insert wakes
///   a previously-empty subscription);
/// - a **row-field** resource ref varies per outer row, so v1 records a
///   conservative dependency scoped to the effective principal (any of this
///   principal's membership writes wakes the query).
pub(crate) fn query_membership_dependencies(
    schema: &SchemaManifest,
    input: &HandlerInput,
    predicate: &MembershipPredicate,
    db: &DbRead<'_>,
    outer_snapshot_version: u64,
) -> SnapbackResult<Vec<CapturedReadDependency>> {
    let Some((table, membership)) = find_declaration(schema, &predicate.declaration) else {
        return Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
            "runtime",
            format!(
                "membership predicate names declaration {:?}, which is not declared",
                predicate.declaration
            ),
        ));
    };
    // Unauthenticated: an auth-dependent query is rejected at the surface
    // (LLP 0011 typed rejection); a null principal matches no rows internally,
    // and there is no principal range to capture, so emit nothing.
    let Some(principal) = input.auth.user_id.as_deref() else {
        return Ok(Vec::new());
    };
    let roles = effective_roles(membership, predicate.roles.as_deref());
    let table_name = table.name.as_str();

    let binding = match &predicate.resource {
        MembershipResourceRef::RowField(_) => ResourceBinding::PerRow,
        MembershipResourceRef::Arg { path, .. } => {
            if membership.resource.is_none() {
                ResourceBinding::AppSingleton
            } else {
                ResourceBinding::Fixed(resolve_arg(&input.args, path))
            }
        }
    };

    match binding {
        ResourceBinding::PerRow => {
            let probe = membership_probe_plan(
                membership,
                table_name,
                principal,
                &ResourceBinding::PerRow,
                &roles,
            );
            Ok(vec![membership_capture_dependency(
                &probe,
                outer_snapshot_version,
                Vec::new(),
            )?])
        }
        fixed => {
            let probe = membership_probe_plan(membership, table_name, principal, &fixed, &roles);
            let output = db.query_private_membership(&probe, &HandlerInput::default())?;
            let ids: Vec<String> = output
                .rows
                .iter()
                .filter_map(|row| row.get("_id").and_then(Value::as_str).map(str::to_owned))
                .collect();
            Ok(vec![membership_capture_dependency(
                &probe,
                output.version,
                ids,
            )?])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_matcher::{
        live_subscription_may_be_affected, query_dependency_change_may_affect,
    };
    use crate::manifest::{
        FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionRuntime, IbexModule,
    };
    use crate::storage::{ChangeOp, ChangedRow};

    fn event_members() -> MembershipManifest {
        MembershipManifest {
            id: None,
            principal: "userId".to_owned(),
            resource: Some("eventId".to_owned()),
            role: "role".to_owned(),
            roles: vec!["host".to_owned(), "cohost".to_owned(), "guest".to_owned()],
            pending_roles: Some(vec!["invited".to_owned()]),
            bootstrap_role: None,
            last_holder: None,
            expiry: None,
            incidental: None,
            provenance: None,
            transitions: Vec::new(),
            scope: crate::manifest::MembershipScope::Resource,
            resource_table: Some("events".to_owned()),
            principal_addressed_writes: None,
        }
    }

    fn input() -> HandlerInput {
        HandlerInput::default()
    }

    fn ibex_live_query() -> FunctionDefinition {
        let mut definition = FunctionDefinition::new(
            "listEvents",
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: "unused".to_owned(),
                export: "listEvents".to_owned(),
            }),
        );
        definition.read_set_summary.tables = vec!["events".to_owned()];
        definition
    }

    /// A captured `Query` dependency on the primary `events` table so the
    /// matcher's fine-grained arm is engaged (it needs at least one query
    /// dependency present). This stands in for the role-gated query's own
    /// primary-table capture.
    fn primary_events_query_dependency() -> CapturedReadDependency {
        let plan = QueryPlan {
            table_visibility: None,
            table: "events".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        CapturedReadDependency {
            kind: CapturedReadKind::Query,
            table: Some("events".to_owned()),
            id: None,
            version: Some(1),
            predicate: Some(serde_json::to_value(&plan).expect("serialize")),
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: Some(0),
            boundary: None,
        }
    }

    fn membership_change(op: ChangeOp, id: &str, role: &str) -> ChangedRow {
        let changed_fields = if op == ChangeOp::Update {
            vec!["role".to_owned()]
        } else {
            Vec::new()
        };
        ChangedRow {
            table: "event_members".to_owned(),
            id: id.to_owned(),
            op,
            row: Some(json!({
                "_id": id,
                "userId": "u1",
                "eventId": "e1",
                "role": role,
            })),
            changed_fields,
        }
    }

    // === ACCEPTANCE #1: the matcher wakes in BOTH directions, proven at the
    // capture-matcher level where the global event-1 resnapshot does not exist.
    // `live_subscription_may_be_affected` is a pure function of (definition,
    // input, captured dependencies, changes) with no notion of the global
    // authorization version, so a wake proven here is proven INDEPENDENTLY of
    // the coarse event: a broken capture cannot hide behind the resnapshot. ===

    #[test]
    fn hidden_to_visible_membership_insert_wakes_via_capture() {
        // A subscription whose membership lookup was EMPTY (the empty-result
        // capture): u1 is not yet a member of e1.
        let membership = event_members();
        let probe = membership_probe_plan(
            &membership,
            "event_members",
            "u1",
            &ResourceBinding::Fixed(json!("e1")),
            &effective_roles(&membership, None),
        );
        let empty_dep = membership_capture_dependency(&probe, 1, Vec::new()).expect("dep");
        assert_eq!(empty_dep.kind, CapturedReadKind::Query, "NOT Permission");
        assert_eq!(empty_dep.result_count, Some(0), "empty-result form");

        let dependencies = vec![primary_events_query_dependency(), empty_dep];
        // u1 is INSERTED as a guest of e1 → the subscription that matched
        // nothing must wake.
        let changes = vec![membership_change(ChangeOp::Insert, "m1", "guest")];
        assert!(
            live_subscription_may_be_affected(
                &ibex_live_query(),
                &input(),
                &dependencies,
                &changes
            ),
            "an insert must wake a previously-empty membership subscription",
        );
    }

    #[test]
    fn visible_to_hidden_membership_delete_wakes_via_capture() {
        let membership = event_members();
        let probe = membership_probe_plan(
            &membership,
            "event_members",
            "u1",
            &ResourceBinding::Fixed(json!("e1")),
            &effective_roles(&membership, None),
        );
        // Present: u1 IS a guest of e1 (row m1 captured).
        let present_dep =
            membership_capture_dependency(&probe, 1, vec!["m1".to_owned()]).expect("dep");
        let dependencies = vec![primary_events_query_dependency(), present_dep];
        // The membership is DELETED (a kick) → the subscription must wake.
        let changes = vec![ChangedRow {
            table: "event_members".to_owned(),
            id: "m1".to_owned(),
            op: ChangeOp::Delete,
            row: None,
            changed_fields: Vec::new(),
        }];
        assert!(
            live_subscription_may_be_affected(
                &ibex_live_query(),
                &input(),
                &dependencies,
                &changes
            ),
            "a delete must wake a membership subscription that matched",
        );
    }

    #[test]
    fn role_downgrade_out_of_set_wakes_via_capture() {
        // memberOf: a guest→invited (active→pending) downgrade removes membership.
        let membership = event_members();
        let probe = membership_probe_plan(
            &membership,
            "event_members",
            "u1",
            &ResourceBinding::Fixed(json!("e1")),
            &effective_roles(&membership, None),
        );
        let present_dep =
            membership_capture_dependency(&probe, 1, vec!["m1".to_owned()]).expect("dep");
        let dependencies = vec![primary_events_query_dependency(), present_dep];
        let changes = vec![membership_change(ChangeOp::Update, "m1", "invited")];
        assert!(
            live_subscription_may_be_affected(
                &ibex_live_query(),
                &input(),
                &dependencies,
                &changes
            ),
            "a role downgrade out of the member set must wake the subscription",
        );
    }

    // The airtight half: the SAME membership change is IGNORED when the
    // dependency is the dead `Permission` kind — demonstrating exactly why the
    // trap is a trap, and that our `Query` representation is load-bearing.
    #[test]
    fn permission_kind_capture_is_dead_and_does_not_wake() {
        let mut permission_dep = primary_events_query_dependency();
        permission_dep.kind = CapturedReadKind::Permission;
        permission_dep.table = Some("event_members".to_owned());
        // Only the primary-events dependency plus the (dead) Permission dep. A
        // membership insert must NOT be detected through the Permission dep.
        let dependencies = vec![primary_events_query_dependency(), permission_dep];
        let changes = vec![membership_change(ChangeOp::Insert, "m1", "guest")];
        assert!(
            !live_subscription_may_be_affected(
                &ibex_live_query(),
                &input(),
                &dependencies,
                &changes
            ),
            "a Permission-kind capture is ignored by the matcher — the trap",
        );
    }

    // A membership write for a DIFFERENT principal must NOT wake — the skip
    // lever stays armed; the fine capture is not a blunt table-level wake.
    #[test]
    fn membership_write_for_other_principal_is_skipped() {
        let membership = event_members();
        let probe = membership_probe_plan(
            &membership,
            "event_members",
            "u1",
            &ResourceBinding::Fixed(json!("e1")),
            &effective_roles(&membership, None),
        );
        let empty_dep = membership_capture_dependency(&probe, 1, Vec::new()).expect("dep");
        let other = ChangedRow {
            table: "event_members".to_owned(),
            id: "m9".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "m9", "userId": "u2", "eventId": "e1", "role": "guest" })),
            changed_fields: Vec::new(),
        };
        assert!(
            !query_dependency_change_may_affect(&input(), &empty_dep, &other),
            "another principal's membership insert cannot change u1's result",
        );
    }

    #[test]
    fn conservative_row_field_dependency_wakes_on_any_own_membership_write() {
        let membership = event_members();
        let probe = membership_probe_plan(
            &membership,
            "event_members",
            "u1",
            &ResourceBinding::PerRow,
            &effective_roles(&membership, None),
        );
        // Conservative: principal-only predicate, no resource/role filter.
        assert_eq!(probe.filters.len(), 1, "PerRow is principal-only");
        let dep = membership_capture_dependency(&probe, 1, Vec::new()).expect("dep");
        // An insert for u1 into ANY event/role wakes.
        let change = ChangedRow {
            table: "event_members".to_owned(),
            id: "m2".to_owned(),
            op: ChangeOp::Insert,
            row: Some(json!({ "_id": "m2", "userId": "u1", "eventId": "e7", "role": "cohost" })),
            changed_fields: Vec::new(),
        };
        assert!(query_dependency_change_may_affect(&input(), &dep, &change));
    }

    // === ACCEPTANCE #2: the denial payload is byte-identical across a
    // hidden-resource probe and a non-public-policy probe (not an oracle). ===
    #[test]
    fn denial_payload_is_byte_identical_across_causes() {
        // Cause A: caller has NO membership row at all (hidden-resource probe).
        let hidden = role_denial();
        // Cause B: caller has a row with the WRONG role (non-public policy).
        let wrong_role = role_denial();
        let a = serde_json::to_string(&hidden).expect("serialize A");
        let b = serde_json::to_string(&wrong_role).expect("serialize B");
        assert_eq!(a, b, "denial must be byte-identical across causes");
        // And the payload is exactly { kind: "role" } — nothing more.
        assert_eq!(hidden.diagnostic.details, json!({ "kind": "role" }));
        assert_eq!(hidden.diagnostic.code, "SNAPBACK_AUTH_PERMISSION_DENIED");
    }

    // === ACCEPTANCE #3: a forged role-denial stays UNTYPED — only the real
    // TerminalAuthorization path yields the trusted brand. ===
    #[test]
    fn forged_role_denial_is_not_trusted() {
        let real = role_denial();
        assert!(
            real.is_trusted_permission_denial(),
            "the real requireRole denial is trusted",
        );
        // A handler forging the public code by hand is NOT trusted.
        let forged = SnapbackError::error(
            "SNAPBACK_AUTH_PERMISSION_DENIED",
            "auth",
            "application supplied the public code",
        )
        .with_details(json!({ "kind": "role" }));
        assert!(
            !forged.is_trusted_permission_denial(),
            "a forged role-denial throw stays untyped",
        );
        // The brand cannot survive a JSON round-trip either (the wire has no
        // field to carry it), so a replayed/echoed denial is untrusted.
        let encoded = serde_json::to_string(&real).expect("serialize");
        let decoded: SnapbackError = serde_json::from_str(&encoded).expect("deserialize");
        assert!(!decoded.is_trusted_permission_denial());
    }

    #[test]
    fn member_of_excludes_pending_roles() {
        let membership = event_members();
        let roles = effective_roles(&membership, None);
        assert!(roles.contains(&"guest".to_owned()));
        assert!(
            !roles.contains(&"invited".to_owned()),
            "memberOf excludes pendingRoles",
        );
    }

    #[test]
    fn validate_rejects_unknown_declaration_role_and_field() {
        let mut schema = SchemaManifest::default();
        let mut table = TableManifest {
            name: "event_members".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                },
                FieldManifest {
                    name: "eventId".to_owned(),
                    field_type: FieldType::Id {
                        table: "events".to_owned(),
                    },
                    optional: false,
                },
                FieldManifest {
                    name: "role".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: Some(event_members()),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };
        table.membership = Some(event_members());
        let events = TableManifest {
            name: "events".to_owned(),
            fields: vec![FieldManifest {
                name: "title".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };
        schema.tables = vec![table, events.clone()];

        // Unknown declaration.
        let bad_decl = MembershipPredicate {
            declaration: "nope".to_owned(),
            resource: MembershipResourceRef::Arg {
                path: "eventId".to_owned(),
                resource_table: Some("events".to_owned()),
            },
            roles: None,
        };
        assert!(validate_membership_predicate(&schema, &events, &bad_decl).is_err());

        // Unknown role.
        let bad_role = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::Arg {
                path: "eventId".to_owned(),
                resource_table: Some("events".to_owned()),
            },
            roles: Some(vec!["owner".to_owned()]),
        };
        assert!(validate_membership_predicate(&schema, &events, &bad_role).is_err());

        // Row field not on the queried table.
        let bad_field = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::RowField("missing".to_owned()),
            roles: None,
        };
        assert!(validate_membership_predicate(&schema, &events, &bad_field).is_err());

        // A present but plain-string field is still the wrong nominal resource
        // type, while `_id` on the bound resource table is valid.
        let wrong_type = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::RowField("title".to_owned()),
            roles: None,
        };
        assert!(validate_membership_predicate(&schema, &events, &wrong_type).is_err());

        // A direct/hand-written artifact cannot erase or lie about the
        // nominal query-argument resource table that codegen proved.
        let wrong_arg_type = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::Arg {
                path: "eventId".to_owned(),
                resource_table: Some("projects".to_owned()),
            },
            roles: None,
        };
        assert!(validate_membership_predicate(&schema, &events, &wrong_arg_type).is_err());

        let good_arg_type = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::Arg {
                path: "eventId".to_owned(),
                resource_table: Some("events".to_owned()),
            },
            roles: None,
        };
        assert!(validate_membership_predicate(&schema, &events, &good_arg_type).is_ok());

        // Valid: memberOf on the bound resource table's own id.
        let ok = MembershipPredicate {
            declaration: "event_members".to_owned(),
            resource: MembershipResourceRef::RowField("_id".to_owned()),
            roles: Some(vec!["host".to_owned(), "cohost".to_owned()]),
        };
        assert!(validate_membership_predicate(&schema, &events, &ok).is_ok());
    }

    fn role_table(
        table: &str,
        declaration: &str,
        scope: crate::manifest::MembershipScope,
    ) -> TableManifest {
        let resource_scoped = scope == crate::manifest::MembershipScope::Resource;
        let mut fields = vec![
            FieldManifest {
                name: "userId".to_owned(),
                field_type: FieldType::Principal,
                optional: false,
            },
            FieldManifest {
                name: "role".to_owned(),
                field_type: FieldType::String,
                optional: false,
            },
        ];
        if resource_scoped {
            fields.push(FieldManifest {
                name: "eventId".to_owned(),
                field_type: FieldType::Id {
                    table: "events".to_owned(),
                },
                optional: false,
            });
        }
        TableManifest {
            name: table.to_owned(),
            fields,
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: Some(MembershipManifest {
                id: Some(declaration.to_owned()),
                principal: "userId".to_owned(),
                resource: resource_scoped.then(|| "eventId".to_owned()),
                role: "role".to_owned(),
                roles: vec!["admin".to_owned()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: None,
                transitions: Vec::new(),
                scope,
                resource_table: resource_scoped.then(|| "events".to_owned()),
                principal_addressed_writes: None,
            }),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }
    }

    #[test]
    fn impersonated_roles_are_global_only_and_ambiguity_is_refused() {
        let schema = SchemaManifest {
            tables: vec![
                role_table(
                    "app_roles",
                    "appRoles",
                    crate::manifest::MembershipScope::App,
                ),
                role_table(
                    "billing_roles",
                    "billingRoles",
                    crate::manifest::MembershipScope::App,
                ),
                role_table(
                    "event_roles",
                    "eventRoles",
                    crate::manifest::MembershipScope::Resource,
                ),
            ],
            ..SchemaManifest::default()
        };
        let error = validate_impersonated_global_roles(&schema, &["admin".to_owned()])
            .expect_err("a bare role with two global owners is ambiguous");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_AMBIGUOUS"
        );
        let unknown = validate_impersonated_global_roles(&schema, &["unknown".to_owned()])
            .expect_err("an undeclared bare role is invalid");
        assert_eq!(
            unknown.diagnostic.code,
            "SNAPBACK_IMPERSONATED_GLOBAL_ROLE_INVALID"
        );
        validate_impersonated_global_roles(&schema, &["appRoles:admin".to_owned()])
            .expect("qualified role binds one declaration");
        assert!(impersonated_global_role_satisfies(
            schema.tables[0].membership.as_ref().unwrap(),
            "appRoles",
            &["admin".to_owned()],
            &["appRoles:admin".to_owned()]
        ));
        assert!(!impersonated_global_role_satisfies(
            schema.tables[2].membership.as_ref().unwrap(),
            "eventRoles",
            &["admin".to_owned()],
            &["admin".to_owned()]
        ));
    }
}
