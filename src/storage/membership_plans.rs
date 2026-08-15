use super::*;

/// The generated true-unique index makes concurrent same-pair inserts resolve to
/// one row; the referential-integrity and closed-vocabulary refusals are
/// enforced here on the live path for every writer, not only at activation.
impl LocalDatabase {
    /// Resolve only the effective principal's row inside one declaration. This
    /// is deliberately not an application-visible roster read: the returned id
    /// stays inside the host and immediately enters the same target-row planner
    /// used by the id-addressed helpers.
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   self/other is host-derived and the transition matrix remains the sole
    ///   authorizer for self-service writes.
    fn resolve_self_membership_id(
        &self,
        writer: &MembershipWriter,
        table: &str,
        resource: Option<&str>,
    ) -> SnapbackResult<String> {
        let effective = self.require_effective_principal(writer)?;
        let (table, membership) = resolve_membership_decl(&self.schema, table)?;
        let (sql, bound): (String, Vec<String>) = match (&membership.resource, resource) {
            (Some(resource_field), Some(resource)) => (
                format!(
                    "SELECT _id FROM {} WHERE {} = ?1 AND {} = ?2",
                    quote_ident(&table.name)?,
                    quote_ident(&membership.principal)?,
                    quote_ident(resource_field)?,
                ),
                vec![effective.to_owned(), resource.to_owned()],
            ),
            (Some(_), None) => {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                    "resource-scoped self membership operation requires a resource id",
                ));
            }
            (None, None) => (
                format!(
                    "SELECT _id FROM {} WHERE {} = ?1",
                    quote_ident(&table.name)?,
                    quote_ident(&membership.principal)?,
                ),
                vec![effective.to_owned()],
            ),
            (None, Some(_)) => {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_UNEXPECTED",
                    "app-scoped self membership operation does not accept a resource id",
                ));
            }
        };
        self.conn
            .query_row(&sql, params_from_iter(bound.iter()), |row| row.get(0))
            .optional()?
            .ok_or_else(|| {
                membership_refusal(
                    "SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND",
                    "the effective principal has no membership row for this declaration and resource",
                )
            })
    }

    pub(super) fn authorize_membership_commands(
        &self,
        commands: Vec<BufferedMembershipCommand>,
    ) -> SnapbackResult<Vec<AuthorizedMembershipPlan>> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            commands
                .into_iter()
                .map(|command| {
                let plan = match command.op {
                    BufferedMembershipOp::Bootstrap {
                        resource_id,
                        values,
                        initial_members,
                    } => {
                        let (_, membership) = resolve_membership_decl(&self.schema, &command.table)?;
                        let resource_table = membership.resource_table.as_deref().ok_or_else(|| {
                            membership_refusal(
                                "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
                                "bootstrap is available only for resource-scoped membership declarations",
                            )
                        })?;
                        self.plan_membership_bootstrap_with_id(
                            &command.writer,
                            resource_table,
                            resource_id,
                            values,
                            &command.table,
                            initial_members,
                        )?
                    }
                    BufferedMembershipOp::Insert(values) => {
                        self.plan_membership_insert(&command.writer, &command.table, values)?
                    }
                    BufferedMembershipOp::SetRole { member_id, role } => self
                        .plan_membership_set_role(
                            &command.writer,
                            &command.table,
                            &member_id,
                            &role,
                        )?,
                    BufferedMembershipOp::Remove { member_id } => {
                        self.plan_membership_remove(&command.writer, &command.table, &member_id)?
                    }
                    BufferedMembershipOp::Patch { member_id, values } => self
                        .plan_membership_patch(
                            &command.writer,
                            &command.table,
                            &member_id,
                            values,
                        )?,
                    BufferedMembershipOp::SetSelfRole { resource, role } => {
                        let member_id = self.resolve_self_membership_id(
                            &command.writer,
                            &command.table,
                            resource.as_deref(),
                        )?;
                        self.plan_membership_set_role(
                            &command.writer,
                            &command.table,
                            &member_id,
                            &role,
                        )?
                    }
                    BufferedMembershipOp::RemoveSelf { resource } => {
                        let member_id = self.resolve_self_membership_id(
                            &command.writer,
                            &command.table,
                            resource.as_deref(),
                        )?;
                        self.plan_membership_remove(
                            &command.writer,
                            &command.table,
                            &member_id,
                        )?
                    }
                    BufferedMembershipOp::PatchSelf { resource, values } => {
                        let member_id = self.resolve_self_membership_id(
                            &command.writer,
                            &command.table,
                            resource.as_deref(),
                        )?;
                        self.plan_membership_patch(
                            &command.writer,
                            &command.table,
                            &member_id,
                            values,
                        )?
                    }
                    BufferedMembershipOp::RemovePrincipal {
                        resource,
                        principal,
                    } => self.plan_membership_remove_principal(
                        &command.writer,
                        &command.table,
                        resource.as_deref(),
                        &principal,
                    )?,
                };
                Ok(AuthorizedMembershipPlan::user_transition(
                    command.writer,
                    plan,
                ))
                })
                .collect()
        })
    }

    /// Commit a pre-authorized membership effect under the `Sanctioned` gate:
    /// the engine has already derived and checked the transition, `lastHolder`,
    /// referential integrity, and the witnesses, so the raw-write refusal and
    /// resource-delete guard are waived for exactly these writes. The captured
    /// aggregates are validated at commit like every other read set.
    pub(super) fn commit_membership_plan(
        &mut self,
        writer: &MembershipWriter,
        plan: MembershipPlan,
    ) -> SnapbackResult<MutationCommit> {
        let input = writer.handler_input();
        self.apply_buffered_writes_with_lifecycle_gated(
            write_authority::LocalWriterLaneV1::MembershipTransition,
            &input,
            BufferedEffects {
                writes: plan.writes,
                sequence_allocations: Vec::new(),
                membership_plans: Vec::new(),
                read_dependencies: plan.read_dependencies,
                result: plan.result,
                job_enqueues: Vec::new(),
                job_producer: None,
                asset_admissions: Vec::new(),
                asset_grant_ops: Vec::new(),
                media_projection: None,
            },
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: true,
                identity: None,
                branch_operation: None,
            },
            MembershipCommitAuthority::sanctioned(writer),
            &|| Ok(()),
            || Ok(()),
        )
    }

    /// Build a privileged non-invocation insert. Seed, import, and admin data
    /// edit carry their own authority, so they bypass the transition matrix but
    /// still pass the closed vocabulary, resource, uniqueness, eligibility,
    /// provenance, and invalidation seams at commit.
    pub(super) fn plan_privileged_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            if !writer.is_privileged_noninvocation() {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED",
                    "privileged membership insertion requires seed, import, or admin data-edit authority",
                ));
            }
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            let principal = extract_axis(&values, &membership.principal, "principal")?;
            let role = extract_axis(&values, &membership.role, "role")?;
            require_in_vocabulary(membership, &role)?;
            if let (Some(resource_field), Some(resource_table)) =
                (&membership.resource, &membership.resource_table)
            {
                let resource = extract_axis(&values, resource_field, "resource")?;
                if read_resource_version(&self.conn, resource_table, &resource)?.is_none() {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                        format!(
                            "privileged membership insert names resource {resource:?}, which does not exist in {resource_table}"
                        ),
                    ));
                }
            }
            self.require_eligible_if_protected(membership, &role, &principal)?;
            Ok(MembershipPlan {
                writes: vec![BufferedWrite::Insert {
                    table: table_manifest.name.clone(),
                    id: crate::ids::mint_document(&table_manifest.name),
                    values,
                }],
                read_dependencies: Vec::new(),
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan an `insert` transition (open-join, invite, ...). Reads the resource
    /// row and captures it (referential integrity + insert-vs-teardown race),
    /// derives the caller class over that resource, and matches the declared
    /// matrix. Field-bound: a column outside the matched transition's `fields`
    /// (e.g. an open-join seating its own far-future `expiresAt`) is refused.
    pub(super) fn plan_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            // A userless authority matches no class, including `"none"`.
            let effective = self.require_effective_principal(writer)?;

            let inserted_principal = extract_axis(&values, &membership.principal, "principal")?;
            let inserted_role = extract_axis(&values, &membership.role, "role")?;
            require_in_vocabulary(membership, &inserted_role)?;
            let inserted_resource = match &membership.resource {
                Some(resource_field) => Some(extract_axis(&values, resource_field, "resource")?),
                None => None,
            };

            let mut read_dependencies = Vec::new();

            // Referential integrity: the resource row must exist, and we capture it
            // so a concurrent teardown/delete linearizes at commit.
            if let (Some(resource_id), Some(resource_table)) = (
                inserted_resource.as_deref(),
                membership.resource_table.as_deref(),
            ) {
                let version = read_resource_version(&self.conn, resource_table, resource_id)?
                    .ok_or_else(|| {
                        membership_refusal(
                            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                            format!(
                                "membership insert names resource {resource_id:?}, which does not \
                             exist in {resource_table}"
                            ),
                        )
                    })?;
                read_dependencies.push(resource_row_dependency(
                    resource_table,
                    resource_id,
                    version,
                ));
            }

            // Caller class over the inserted resource, and target self/other.
            let target = if inserted_principal == effective {
                MembershipTarget::Own
            } else {
                MembershipTarget::Other
            };
            let (caller_role, caller_dependency) = read_caller_role_with_dependency(
                &self.conn,
                table_manifest,
                membership,
                inserted_resource.as_deref(),
                effective,
            )?;
            let class = match caller_role {
                Some(role) => MembershipCallerClass::Role(role),
                None => MembershipCallerClass::None,
            };
            read_dependencies.push(caller_dependency);

            let matched = membership
                .transitions
                .iter()
                .find(|transition| {
                    transition.op == MembershipOp::Insert
                        && transition.target == target
                        && transition.by.iter().any(|by| by == class.token())
                        && matches_role_lists(transition, None, Some(&inserted_role))
                })
                .ok_or_else(|| transition_denied(MembershipOp::Insert, class.token(), target))?;

            // Field-bound insert: only the axes and the matched transition's `fields`
            // may be written.
            enforce_insert_fields(membership, matched, &values)?;

            // Seating into a protected role requires an eligible principal — the set
            // can never be kept full with corpses.
            self.require_eligible_if_protected(membership, &inserted_role, &inserted_principal)?;

            let id = crate::ids::mint_document(&table_manifest.name);
            Ok(MembershipPlan {
                writes: vec![BufferedWrite::Insert {
                    table: table_manifest.name.clone(),
                    id,
                    values,
                }],
                read_dependencies,
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan a `setRole` transition (accept-invite, promote, demote). Re-reads the
    /// **target row** and binds its own resource and principal (check-A/write-B
    /// is unspellable), then matches the matrix on `from`/`to`. Demoting the
    /// final eligible holder of a protected role is refused; promoting an
    /// ineligible principal into it is refused.
    pub(super) fn plan_membership_set_role(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        to_role: &str,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            let effective = self.require_effective_principal(writer)?;
            require_in_vocabulary(membership, to_role)?;

            let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
                .ok_or_else(|| target_row_missing(member_id))?;
            let (class, target, caller_dependency) = self.derive_class_and_target(
                table_manifest,
                membership,
                row.resource.as_deref(),
                &row.principal,
                effective,
            )?;

            let matched = membership
                .transitions
                .iter()
                .find(|transition| {
                    transition.op == MembershipOp::SetRole
                        && transition.target == target
                        && transition.by.iter().any(|by| by == class.token())
                        && matches_role_lists(transition, Some(&row.role), Some(to_role))
                })
                .ok_or_else(|| transition_denied(MembershipOp::SetRole, class.token(), target))?;
            let _ = matched;

            let mut read_dependencies = vec![target_row_dependency(&table_manifest.name, &row)];
            read_dependencies.extend(caller_dependency);

            // Demotion out of a protected role must leave an eligible holder; capture
            // the survivor so two concurrent demotions of the final two cannot both
            // commit.
            self.guard_protected_departure(
                table_manifest,
                membership,
                &row,
                to_role != protected_role(membership),
                &mut read_dependencies,
            )?;
            // Promotion into a protected role requires an eligible target principal.
            self.require_eligible_if_protected(membership, to_role, &row.principal)?;

            let mut patch = Map::new();
            patch.insert(membership.role.clone(), Value::String(to_role.to_owned()));
            Ok(MembershipPlan {
                writes: vec![BufferedWrite::Patch {
                    table: table_manifest.name.clone(),
                    id: row.id.clone(),
                    values: patch,
                }],
                read_dependencies,
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan a `remove` transition (leave, decline, kick). Binds the target row's
    /// resource and principal; refuses removing the final eligible holder of a
    /// protected role (the teardown witness is the only path that clears it).
    pub(super) fn plan_membership_remove(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            let effective = self.require_effective_principal(writer)?;

            let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
                .ok_or_else(|| target_row_missing(member_id))?;
            let (class, target, caller_dependency) = self.derive_class_and_target(
                table_manifest,
                membership,
                row.resource.as_deref(),
                &row.principal,
                effective,
            )?;

            membership
                .transitions
                .iter()
                .find(|transition| {
                    transition.op == MembershipOp::Remove
                        && transition.target == target
                        && transition.by.iter().any(|by| by == class.token())
                        && matches_role_lists(transition, Some(&row.role), None)
                })
                .ok_or_else(|| transition_denied(MembershipOp::Remove, class.token(), target))?;

            let mut read_dependencies = vec![target_row_dependency(&table_manifest.name, &row)];
            read_dependencies.extend(caller_dependency);
            self.guard_protected_departure(
                table_manifest,
                membership,
                &row,
                true,
                &mut read_dependencies,
            )?;

            Ok(MembershipPlan {
                writes: vec![BufferedWrite::Delete {
                    table: table_manifest.name.clone(),
                    id: row.id.clone(),
                }],
                read_dependencies,
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan the principal-addressed removal command (LLP 0100 §3). The host
    /// receives only `(declaration, resource?, targetPrincipal)`; row id,
    /// role, caller class, and writer authority stay host-derived. The
    /// refusal ordering is the RFC's disclosure calculus, exactly: option
    /// check, shape-only argument validation, caller-role admission against
    /// the TOTAL other-remove carriers (the invariant transition denial,
    /// before any target lookup), the self-target refusal, then host-side
    /// target resolution. A present target feeds the unchanged target-row
    /// removal planner; an absent target is an idempotent no-op that commits
    /// only its captured absence dependency — no membership write, no
    /// transition record, no authorization-version advance (the §1-scoped
    /// disclosure). Both branches return the identical `null`.
    ///
    /// @ref LLP 0100#3-host-resolution-and-linearization — refusal order,
    ///   captured present/absent lookups, and the exact no-op commit.
    pub(super) fn plan_membership_remove_principal(
        &self,
        writer: &MembershipWriter,
        table: &str,
        resource: Option<&str>,
        principal: &str,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            // Opt-in declaration (defense in depth behind codegen: a
            // hand-authored manifest without the option gets the same
            // refusal the typed surface's absence implies).
            if !membership
                .principal_addressed_writes
                .as_ref()
                .is_some_and(|paw| paw.remove)
            {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_PRINCIPAL_ADDRESSED_UNDECLARED",
                    "this declaration does not opt into principalAddressedWrites.remove; \
                     principal-addressed removal is closed by default",
                ));
            }
            // Step 1: shape-only argument validation. No user table is
            // consulted — a well-formed principal that names no user takes
            // the absent-pair no-op below, so this surface cannot become a
            // user-directory existence probe.
            if principal.is_empty() {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_PRINCIPAL_INVALID",
                    "removePrincipal requires a non-empty principal id",
                ));
            }
            match (&membership.resource, resource) {
                (Some(_), None) => {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                        "resource-scoped principal-addressed removal requires a resource id",
                    ));
                }
                (None, Some(_)) => {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_RESOURCE_UNEXPECTED",
                        "app-scoped principal-addressed removal does not accept a resource id",
                    ));
                }
                _ => {}
            }
            let effective = self.require_effective_principal(writer)?;
            // Steps 2–3: resolve the caller's role and refuse a caller whose
            // role matches no TOTAL other-principal removal transition, with
            // the invariant denial — before the self check and before any
            // target lookup, so an unauthorized caller never triggers a
            // membership probe and learns nothing target-shaped.
            let (caller_role, caller_dependency) = read_caller_role_with_dependency(
                &self.conn,
                table_manifest,
                membership,
                resource,
                effective,
            )?;
            let class = match caller_role {
                Some(role) => MembershipCallerClass::Role(role),
                None => MembershipCallerClass::None,
            };
            let admitted = membership.transitions.iter().any(|transition| {
                transition.op == MembershipOp::Remove
                    && transition.target == MembershipTarget::Other
                    && transition.from.is_none()
                    && transition.by.iter().any(|by| by == class.token())
            });
            if !admitted {
                return Err(transition_denied(
                    MembershipOp::Remove,
                    class.token(),
                    MembershipTarget::Other,
                ));
            }
            // Step 4: self-removal remains removeSelf. Typed misuse, refused
            // before target lookup (the caller already knows this fact).
            if principal == effective {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_TARGET_SELF",
                    "removePrincipal targets another principal; self-removal remains removeSelf",
                ));
            }
            // Step 5: host-side target resolution, captured in both branches.
            let (target, target_dependency) = read_membership_pair_with_dependency(
                &self.conn,
                table_manifest,
                membership,
                resource,
                principal,
            )?;
            match target {
                Some((member_id, _role)) => {
                    // Step 6a: the unchanged target-row removal planner owns
                    // the transition re-check, the target-row capture, and
                    // the lastHolder departure guard.
                    let mut plan = self.plan_membership_remove(writer, table, &member_id)?;
                    plan.read_dependencies.push(target_dependency);
                    Ok(plan)
                }
                None => Ok(MembershipPlan {
                    // Step 6b: the idempotent no-op. Zero membership writes:
                    // commit carries only the captured absence and caller
                    // dependencies (plus the mutation's ordinary companion
                    // writes, which ride the same commit outside this plan),
                    // records no transition, and advances no authorization
                    // version.
                    writes: Vec::new(),
                    read_dependencies: vec![caller_dependency, target_dependency],
                    result: Value::Null,
                    skipped_protected: Vec::new(),
                }),
            }
        })
    }

    /// Plan a `patch` transition over the declaration's non-axis, non-role
    /// columns. Field-bound: a column outside the matched transition's `fields`
    /// is refused — in particular a `by: ["self"]` preferences patch cannot
    /// extend the member's own `expiresAt` (the self-renewal hole).
    pub(super) fn plan_membership_patch(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            let effective = self.require_effective_principal(writer)?;

            let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
                .ok_or_else(|| target_row_missing(member_id))?;
            let (class, target, caller_dependency) = self.derive_class_and_target(
                table_manifest,
                membership,
                row.resource.as_deref(),
                &row.principal,
                effective,
            )?;

            // A patch never touches the axes or the role (immutability; role changes
            // go through setRole). Refuse before op matching so the error names the
            // real cause.
            for key in values.keys() {
                if key == &membership.principal
                    || key == &membership.role
                    || membership.resource.as_deref() == Some(key.as_str())
                {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_PATCH_AXIS",
                        format!("patch may not write membership axis/role column {key:?}"),
                    ));
                }
            }

            let matched = membership
                .transitions
                .iter()
                .find(|transition| {
                    transition.op == MembershipOp::Patch
                        && transition.target == target
                        && transition.by.iter().any(|by| by == class.token())
                        && matches_role_lists(transition, Some(&row.role), None)
                        && values
                            .keys()
                            .all(|key| transition.fields.iter().flatten().any(|field| field == key))
                })
                .ok_or_else(|| transition_denied(MembershipOp::Patch, class.token(), target))?;
            let _ = matched;

            Ok(MembershipPlan {
                writes: vec![BufferedWrite::Patch {
                    table: table_manifest.name.clone(),
                    id: row.id.clone(),
                    values,
                }],
                read_dependencies: std::iter::once(target_row_dependency(
                    &table_manifest.name,
                    &row,
                ))
                .chain(caller_dependency)
                .collect(),
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan the bootstrap of a fresh resource: insert the resource row and, in
    /// the SAME transaction, seat the server-derived effective principal in the
    /// declaration's `bootstrapRole`. The witness is bound to *this* creation —
    /// the resource id is host-minted and fresh, so a mutation that did not
    /// create the resource can never obtain it (an existing/emptied/imported
    /// resource has no fresh row to seat against). Single-use by construction:
    /// one resource insert, one creator seat, and at most one bounded initial
    /// roster authorized as inserts by the creator's bootstrap role.
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   bootstrap is bound to CREATION, not emptiness; the creator seat is
    ///   host-derived and every additional initial seat must match an ordinary
    ///   `insert` transition from the creator's `bootstrapRole`.
    pub(super) fn plan_membership_bootstrap(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_values: Map<String, Value>,
        membership_table: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.plan_membership_bootstrap_with_id(
            writer,
            resource_table,
            crate::ids::mint_document(resource_table),
            resource_values,
            membership_table,
            Vec::new(),
        )
    }

    /// Buffered handler twin of [`Self::plan_membership_bootstrap`]. The
    /// resource id is minted through the invocation's deterministic id ledger
    /// before the handler continues, then carried unchanged into this planner
    /// so `await ctx.membership.<decl>.bootstrap(values)` can return it.
    pub(super) fn plan_membership_bootstrap_with_id(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_id: String,
        resource_values: Map<String, Value>,
        membership_table: &str,
        initial_members: Vec<Map<String, Value>>,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            let (member_table_manifest, membership) =
                resolve_membership_decl(&schema, membership_table)?;
            // The bootstrap seat is the server-derived effective principal; a userless
            // authority cannot bootstrap.
            let effective = self.require_effective_principal(writer)?;
            let bootstrap_role = membership.bootstrap_role.as_deref().ok_or_else(|| {
                membership_refusal(
                    "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE",
                    format!(
                        "declaration {} has no bootstrapRole to seat",
                        membership.effective_id(&member_table_manifest.name)
                    ),
                )
            })?;
            if membership.resource_table.as_deref() != Some(resource_table) {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH",
                    format!(
                        "declaration {} does not bind resource table {resource_table}",
                        membership.effective_id(&member_table_manifest.name)
                    ),
                ));
            }
            // The bootstrap holder must be eligible (a deactivated principal cannot
            // invoke; this is defence in depth against a stale writer).
            self.require_eligible_if_protected(membership, bootstrap_role, effective)?;

            let resource_field = membership.resource.clone().ok_or_else(|| {
                membership_refusal(
                    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
                    "bootstrap is a resource-scoped operation",
                )
            })?;
            let mut member_values = Map::new();
            member_values.insert(
                membership.principal.clone(),
                Value::String(effective.to_owned()),
            );
            member_values.insert(resource_field.clone(), Value::String(resource_id.clone()));
            member_values.insert(
                membership.role.clone(),
                Value::String(bootstrap_role.to_owned()),
            );

            if initial_members.len() > MEMBERSHIP_BOOTSTRAP_MAX_INITIAL_MEMBERS {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_BOOTSTRAP_INITIAL_MEMBERS_INVALID",
                    format!(
                        "bootstrap accepts at most {MEMBERSHIP_BOOTSTRAP_MAX_INITIAL_MEMBERS} initial members"
                    ),
                ));
            }
            let mut principals = BTreeSet::from([effective.to_owned()]);
            let mut initial_writes = Vec::with_capacity(initial_members.len());
            for mut values in initial_members {
                if values.contains_key(&resource_field) {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_UNEXPECTED",
                        format!(
                            "bootstrap initial members omit host-bound resource field {resource_field:?}"
                        ),
                    ));
                }
                let principal = extract_axis(&values, &membership.principal, "principal")?;
                let role = extract_axis(&values, &membership.role, "role")?;
                require_in_vocabulary(membership, &role)?;
                if !principals.insert(principal.clone()) {
                    return Err(membership_refusal(
                        "SNAPBACK_MEMBERSHIP_BOOTSTRAP_DUPLICATE_PRINCIPAL",
                        "bootstrap initial roster repeats the creator or another principal",
                    )
                    .with_detail("principal", principal));
                }
                let transition = membership
                    .transitions
                    .iter()
                    .find(|transition| {
                        transition.op == MembershipOp::Insert
                            && transition.target == MembershipTarget::Other
                            && transition.by.iter().any(|by| by == bootstrap_role)
                            && matches_role_lists(transition, None, Some(&role))
                    })
                    .ok_or_else(|| {
                        transition_denied(
                            MembershipOp::Insert,
                            bootstrap_role,
                            MembershipTarget::Other,
                        )
                    })?;
                enforce_insert_fields(membership, transition, &values)?;
                self.require_eligible_if_protected(membership, &role, &principal)?;
                values.insert(resource_field.clone(), Value::String(resource_id.clone()));
                initial_writes.push(BufferedWrite::Insert {
                    table: member_table_manifest.name.clone(),
                    id: crate::ids::mint_document(&member_table_manifest.name),
                    values,
                });
            }

            let mut writes = vec![
                BufferedWrite::Insert {
                    table: resource_table.to_owned(),
                    id: resource_id.clone(),
                    values: resource_values,
                },
                BufferedWrite::Insert {
                    table: member_table_manifest.name.clone(),
                    id: crate::ids::mint_document(&member_table_manifest.name),
                    values: member_values,
                },
            ];
            writes.extend(initial_writes);
            Ok(MembershipPlan {
                writes,
                read_dependencies: Vec::new(),
                result: Value::String(resource_id),
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan the teardown of a resource: clear the whole roster of every
    /// declaration bound to `resource_table` AND delete the resource row, in one
    /// transaction. The deletion witness waives `lastHolder` — a resource that
    /// ceases to exist strands nobody — resolving the delete-refused-vs-lastHolder
    /// deadlock. Unspellable outside a mutation that deletes that resource row.
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   deletion witness -> teardown; `clearForResource` waives `lastHolder`.
    pub(super) fn plan_membership_teardown(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            let schema = self.schema.clone();
            // Teardown deletes the resource under app authority; a userless authority
            // has no standing to delete it.
            self.require_effective_principal(writer)?;
            if read_resource_version(&self.conn, resource_table, resource_id)?.is_none() {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING",
                    format!("teardown names resource {resource_id:?}, which does not exist"),
                ));
            }

            let mut writes = Vec::new();
            let mut read_dependencies = Vec::new();
            for table in &schema.tables {
                let Some(membership) = &table.membership else {
                    continue;
                };
                if membership.scope != MembershipScope::Resource {
                    continue;
                }
                if membership.resource_table.as_deref() != Some(resource_table) {
                    continue;
                }
                let Some(resource_column) = membership.resource.as_deref() else {
                    continue;
                };
                let sql = format!(
                    "SELECT _id FROM {} WHERE {} = ?1",
                    quote_ident(&table.name)?,
                    quote_ident(resource_column)?
                );
                let mut statement = self.conn.prepare(&sql)?;
                let ids = statement
                    .query_map(params![resource_id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                for id in ids {
                    writes.push(BufferedWrite::Delete {
                        table: table.name.clone(),
                        id,
                    });
                }
                // Capture the roster emptiness conservatively: a concurrent open-join
                // insert that fills this resource's range after the plan snapshot
                // bumps the table's change version and fails this dependency at
                // commit, so an insert-then-teardown ordering yields exactly one
                // winner (no orphan on a deleted resource). The reverse ordering is
                // caught by the insert's captured resource row.
                // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
                //   the roster-emptiness read is captured, the third aggregate.
                read_dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::Query,
                    table: Some(table.name.clone()),
                    id: None,
                    version: Some(table_change_version_from_connection(
                        &self.conn,
                        &table.name,
                    )?),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
            }
            writes.push(BufferedWrite::Delete {
                table: resource_table.to_owned(),
                id: resource_id.to_owned(),
            });

            Ok(MembershipPlan {
                writes,
                read_dependencies,
                result: Value::Null,
                skipped_protected: Vec::new(),
            })
        })
    }

    /// Plan the expiry sweep for one declaration. **System authority only** — the
    /// sole system-authority membership write. Acts only on rows of THIS
    /// declaration whose declared expiry field is past on `now_ms` (the
    /// rollback-checked clock the caller supplies), and performs only `remove`.
    /// `lastHolder` WINS over expiry: an expired final eligible holder of the
    /// protected role is skipped, left live, and named in `skipped_protected`
    /// (so `expiry` does not bound a protected role).
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   remove-only; `lastHolder` wins over expiry with a typed diagnostic.
    pub(super) fn plan_membership_sweep_expired(
        &self,
        writer: &MembershipWriter,
        table: &str,
        now_ms: u64,
    ) -> SnapbackResult<MembershipPlan> {
        with_pinned_read_snapshot(&self.conn, |_conn| {
            if !matches!(writer, MembershipWriter::System) {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY",
                    "sweepExpired is the only system-authority membership write and requires \
                 resolved system authority",
                ));
            }
            let schema = self.schema.clone();
            let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
            let snapshot_version = self.current_version()?;
            validate_managed_row_versions(&self.conn, table_manifest, snapshot_version)?;
            let expiry = membership.expiry.as_ref().ok_or_else(|| {
                membership_refusal(
                    "SNAPBACK_MEMBERSHIP_NO_EXPIRY",
                    format!(
                        "declaration {} declares no expiry field to sweep",
                        membership.effective_id(&table_manifest.name)
                    ),
                )
            })?;

            // Rows whose declared expiry field is strictly in the past. A null expiry
            // is never swept.
            let mut columns = vec![membership.principal.clone(), membership.role.clone()];
            if let Some(resource) = &membership.resource {
                columns.push(resource.clone());
            }
            let quoted = columns
                .iter()
                .map(|column| quote_ident(column))
                .collect::<SnapbackResult<Vec<_>>>()?
                .join(", ");
            let sql = format!(
                "SELECT _id, _version, {quoted} FROM {} WHERE {field} IS NOT NULL AND {field} < ?1 ORDER BY _id",
                quote_ident(&table_manifest.name)?,
                field = quote_ident(&expiry.field)?
            );
            let has_resource = membership.resource.is_some();
            let mut statement = self.conn.prepare(&sql)?;
            let now_ms = timestamp_to_sql_millis(now_ms)?;
            let expired = statement
                .query_map(params![now_ms], |row| {
                    let id: String = row.get(0)?;
                    let version: SqlValue = row.get(1)?;
                    let principal: String = row.get(2)?;
                    let role: String = row.get(3)?;
                    let resource: Option<String> = if has_resource { row.get(4)? } else { None };
                    Ok((id, version, principal, role, resource))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            let protect = membership
                .last_holder
                .as_ref()
                .map(|last| last.protect.clone());
            let mut writes = Vec::new();
            let mut read_dependencies = Vec::new();
            let mut skipped_protected = Vec::new();
            // Sequential accounting: a row already marked for removal is no longer a
            // surviving eligible holder, so two expired protected holders cannot both
            // be swept into a strand.
            let mut removed: BTreeSet<String> = BTreeSet::new();
            for (id, version, principal, role, resource) in expired {
                let version =
                    decode_required_committed_version(version, "expired membership row version")?;
                validate_storage_version_at_most(
                    version,
                    snapshot_version,
                    "expired membership row version",
                )?;
                // The sweep may delete this exact row only if its expiry/role/axes
                // are unchanged at commit. Renewal, promotion, or any other patch
                // bumps the row version and invalidates the stale plan.
                // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default
                read_dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::Row,
                    table: Some(table_manifest.name.clone()),
                    id: Some(id.clone()),
                    version: Some(version),
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
                let is_protected_final = match (&protect, &resource) {
                    (Some(protect), Some(resource)) if protect == &role => {
                        let survivors =
                            crate::storage::auth_agents::eligible_protected_holder_rows(
                                &self.conn,
                                &table_manifest.name,
                                &membership.principal,
                                membership.resource.as_deref().unwrap_or_default(),
                                &membership.role,
                                resource,
                                protect,
                                &principal,
                                schema.effective_auth_mode() == AuthMode::Sessions,
                                snapshot_version,
                            )?;
                        !survivors
                            .iter()
                            .any(|(member_id, _, _)| !removed.contains(member_id))
                    }
                    _ => false,
                };
                if is_protected_final {
                    skipped_protected.push(id);
                    continue;
                }
                removed.insert(id.clone());
                writes.push(BufferedWrite::Delete {
                    table: table_manifest.name.clone(),
                    id,
                });
            }

            Ok(MembershipPlan {
                writes,
                read_dependencies,
                result: Value::Null,
                skipped_protected,
            })
        })
    }

    fn require_effective_principal<'a>(
        &self,
        writer: &'a MembershipWriter,
    ) -> SnapbackResult<&'a str> {
        if writer.is_privileged_noninvocation() {
            // Privileged non-invocation writers do not run the transition matrix;
            // callers that reach the matrix must not pass one.
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX",
                "a seed/import/admin writer does not evaluate the transition matrix",
            ));
        }
        writer.effective_principal().ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
                "an authority with no effective principal (system, adminBypass, anonymous) matches \
                 no transition class",
            )
        })
    }

    /// Self wins over a role; a role applies only when the caller is not the
    /// target; else `"none"`.
    fn derive_class_and_target(
        &self,
        table: &TableManifest,
        membership: &MembershipManifest,
        resource: Option<&str>,
        target_principal: &str,
        effective: &str,
    ) -> SnapbackResult<(
        MembershipCallerClass,
        MembershipTarget,
        Option<CapturedReadDependency>,
    )> {
        if effective == target_principal {
            let (_, dependency) = read_caller_role_with_dependency(
                &self.conn, table, membership, resource, effective,
            )?;
            return Ok((
                MembershipCallerClass::Own,
                MembershipTarget::Own,
                Some(dependency),
            ));
        }
        let (caller_role, dependency) =
            read_caller_role_with_dependency(&self.conn, table, membership, resource, effective)?;
        let class = match caller_role {
            Some(role) => MembershipCallerClass::Role(role),
            None => MembershipCallerClass::None,
        };
        Ok((class, MembershipTarget::Other, Some(dependency)))
    }

    /// A departure (remove, or a demotion whose `to` leaves the protected role)
    /// of a protected-role holder must leave an eligible holder; capture the
    /// survivor row so concurrent finals linearize to one commit.
    fn guard_protected_departure(
        &self,
        table: &TableManifest,
        membership: &MembershipManifest,
        row: &MembershipTargetRow,
        departing: bool,
        read_dependencies: &mut Vec<CapturedReadDependency>,
    ) -> SnapbackResult<()> {
        let Some(last_holder) = &membership.last_holder else {
            return Ok(());
        };
        if !departing || row.role != last_holder.protect {
            return Ok(());
        }
        let Some(resource) = &row.resource else {
            return Ok(());
        };
        let maximum = self.current_version()?;
        let survivors = crate::storage::auth_agents::eligible_protected_holder_rows(
            &self.conn,
            &table.name,
            &membership.principal,
            membership.resource.as_deref().unwrap_or_default(),
            &membership.role,
            resource,
            &last_holder.protect,
            &row.principal,
            self.schema.effective_auth_mode() == AuthMode::Sessions,
            maximum,
        )?;
        let Some((survivor_id, survivor_version, _)) = survivors.into_iter().next() else {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
                format!(
                    "removing/demoting this holder would leave resource {resource:?} with no \
                     eligible holder of the protected role {:?}",
                    last_holder.protect
                ),
            )
            .with_detail("resource", resource.clone())
            .with_detail("role", last_holder.protect.clone()));
        };
        // Rely on THIS survivor remaining: a concurrent removal of it fails
        // commit-time read-set validation, so exactly one final removal commits.
        read_dependencies.push(CapturedReadDependency {
            kind: CapturedReadKind::Row,
            table: Some(table.name.clone()),
            id: Some(survivor_id),
            version: Some(survivor_version),
            predicate: None,
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
        Ok(())
    }

    /// Seating or promoting a principal into a protected role requires the
    /// shared durable-recoverability predicate: the eligible holder set cannot
    /// be kept full with absent, deactivated, or credential-stranded principals.
    fn require_eligible_if_protected(
        &self,
        membership: &MembershipManifest,
        role: &str,
        principal: &str,
    ) -> SnapbackResult<()> {
        let Some(last_holder) = &membership.last_holder else {
            return Ok(());
        };
        if role != last_holder.protect {
            return Ok(());
        }
        if !crate::storage::auth_agents::principal_is_eligible_on(
            &self.conn,
            principal,
            self.schema.effective_auth_mode() == AuthMode::Sessions,
        )? {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER",
                format!(
                    "principal {principal:?} has no durable recovery carrier and cannot hold the \
                     protected role {:?}",
                    last_holder.protect
                ),
            )
            .with_detail("principal", principal.to_owned())
            .with_detail("role", last_holder.protect.clone()));
        }
        Ok(())
    }
}

/// Narrow typed access to membership authorization, planning, and commit operations.
///
/// @ref LLP 0225#1-ownership-map — membership writes enter the storage
/// kernel through typed operations instead of the wide `LocalDatabase` surface.
pub struct MembershipPlansKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> MembershipPlansKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub(crate) fn authorize_membership_commands(
        &self,
        commands: Vec<BufferedMembershipCommand>,
    ) -> SnapbackResult<Vec<AuthorizedMembershipPlan>> {
        self.db.authorize_membership_commands(commands)
    }

    pub fn commit_membership_plan(
        &mut self,
        writer: &MembershipWriter,
        plan: MembershipPlan,
    ) -> SnapbackResult<MutationCommit> {
        self.db.commit_membership_plan(writer, plan)
    }

    pub fn plan_privileged_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_privileged_membership_insert(writer, table, values)
    }

    pub fn plan_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_insert(writer, table, values)
    }

    pub fn plan_membership_set_role(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        to_role: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_set_role(writer, table, member_id, to_role)
    }

    pub fn plan_membership_remove(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_remove(writer, table, member_id)
    }

    pub fn plan_membership_remove_principal(
        &self,
        writer: &MembershipWriter,
        table: &str,
        resource: Option<&str>,
        principal: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_remove_principal(writer, table, resource, principal)
    }

    pub fn plan_membership_patch(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_patch(writer, table, member_id, values)
    }

    pub fn plan_membership_bootstrap(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_values: Map<String, Value>,
        membership_table: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_bootstrap(writer, resource_table, resource_values, membership_table)
    }

    pub fn plan_membership_teardown(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_teardown(writer, resource_table, resource_id)
    }

    pub fn plan_membership_sweep_expired(
        &self,
        writer: &MembershipWriter,
        table: &str,
        now_ms: u64,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_sweep_expired(writer, table, now_ms)
    }
}

/// Shared-borrow membership planners for callers holding `&LocalDatabase`.
pub struct MembershipPlansReadKernel<'a> {
    db: &'a LocalDatabase,
}

impl<'a> MembershipPlansReadKernel<'a> {
    pub(super) fn new(db: &'a LocalDatabase) -> Self {
        Self { db }
    }

    pub fn plan_privileged_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_privileged_membership_insert(writer, table, values)
    }

    pub fn plan_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_insert(writer, table, values)
    }

    pub fn plan_membership_set_role(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        to_role: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_set_role(writer, table, member_id, to_role)
    }

    pub fn plan_membership_remove(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_remove(writer, table, member_id)
    }

    pub fn plan_membership_remove_principal(
        &self,
        writer: &MembershipWriter,
        table: &str,
        resource: Option<&str>,
        principal: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_remove_principal(writer, table, resource, principal)
    }

    pub fn plan_membership_patch(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_patch(writer, table, member_id, values)
    }

    pub fn plan_membership_bootstrap(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_values: Map<String, Value>,
        membership_table: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_bootstrap(writer, resource_table, resource_values, membership_table)
    }

    pub fn plan_membership_teardown(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        self.db
            .plan_membership_teardown(writer, resource_table, resource_id)
    }

    pub fn plan_membership_sweep_expired(
        &self,
        writer: &MembershipWriter,
        table: &str,
        now_ms: u64,
    ) -> SnapbackResult<MembershipPlan> {
        self.db.plan_membership_sweep_expired(writer, table, now_ms)
    }
}
