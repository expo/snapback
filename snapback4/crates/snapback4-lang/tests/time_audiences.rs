use snapback4_lang::compile;

fn bound(source: &str) -> snapback4_lang::Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> snapback4_lang::Bound {
    let result = bound(source);
    assert!(result.diagnostics.is_empty(), "{:#?}", result.diagnostics);
    result
}

const ANNOUNCEMENTS: &str = "table announcements:\n  opensAt: time ?\n  closesAt: time ?\n  secret: text <=4000\n  by byOpening: opensAt\n  by byExpiry: closesAt\n  not before .opensAt\n  expire at .closesAt\n  public 'scheduled announcements'\n  sync public\n";

#[test]
fn not_before_binds_separately_from_expiry_and_requires_a_capability() {
    let result = clean(ANNOUNCEMENTS);
    let table = &result.schema.tables["announcements"];
    assert_eq!(table.not_before.as_deref(), Some("opensAt"));
    assert_eq!(table.expire.as_deref(), Some("closesAt"));
    assert_eq!(
        table.opening_index().map(|(name, _)| name),
        Some("byOpening")
    );
    assert!(
        result
            .schema
            .required_capabilities()
            .contains("time-audiences-v1")
    );
    let json = serde_json::to_value(&result.schema).unwrap();
    assert_eq!(json["tables"]["announcements"]["notBefore"], "opensAt");
}

#[test]
fn not_before_has_located_type_index_shape_and_duplicate_diagnostics() {
    for (source, message) in [
        (
            ANNOUNCEMENTS.replace("opensAt: time ?", "opensAt: int"),
            "read life starts at a time",
        ),
        (
            ANNOUNCEMENTS.replace("not before .opensAt", "not before .missing"),
            "has no column missing",
        ),
        (
            ANNOUNCEMENTS.replace(
                "  expire at .closesAt",
                "  not before .opensAt\n  expire at .closesAt",
            ),
            "more than one not before",
        ),
    ] {
        let result = bound(&source);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.message.contains(message)),
            "{message}: {:#?}",
            result.diagnostics
        );
    }
}

#[test]
fn admitted_group_audience_may_itself_open_later() {
    let source = "table members:\n  team: text <=20\n  principal: principal\n  opensAt: time ?\n  by byOpening: opensAt\n  unique team, principal\n  not before .opensAt\n  read <- .principal = viewer\n  insert <- exists members[.team, viewer]\n  sync\ntable notes:\n  team: text <=20\n  read <- exists members[.team, viewer]\n  insert <- allow\n  sync\n";
    clean(source);
}

#[test]
fn unsupported_derived_and_lifetime_compositions_are_refused() {
    let ephemeral = ANNOUNCEMENTS
        .replace(
            "table announcements:",
            "table announcements:\n  ephemeral 4s",
        )
        .replace("  expire at .closesAt\n", "")
        .replace("  sync public\n", "");
    let aggregate =
        format!("{ANNOUNCEMENTS}view counts: count announcements by .secret\n  read <- allow\n");
    for (source, message) in [
        (ephemeral, "not before cannot appear on an ephemeral table"),
        (aggregate,
            "cannot use `not before` on its source, target, or row-key member table",
        ),
    ] {
        let result = bound(&source);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.message.contains(message)),
            "{message}: {:#?}",
            result.diagnostics
        );
    }
}

#[test]
fn row_keyed_maintain_rejects_a_timed_member_table_only() {
    let fixture = include_str!("fixtures/row-keyed-view.q");
    let timed_members = fixture.replace(
        "  principal: principal\n  readUpTo: int default 0",
        "  principal: principal\n  opensAt: time ?\n  readUpTo: int default 0",
    ).replace(
        "  cap 100 by conversationId\n  read <- allow",
        "  cap 100 by conversationId\n  by byOpening: opensAt\n  not before .opensAt\n  read <- allow",
    );
    let result = bound(&timed_members);
    assert!(
        result.diagnostics.iter().any(|diagnostic| {
            diagnostic.message.contains("row-key member table")
                && diagnostic.site.file == "schema.q"
                && diagnostic.site.line > 0
        }),
        "{:#?}",
        result.diagnostics
    );

    // A timed table outside the maintained source/target/member dependency is
    // independent and must not disable an otherwise supported row-keyed view.
    clean(&fixture.replace("view unread:", &format!("{ANNOUNCEMENTS}\nview unread:")));
}

#[test]
fn union_audience_with_future_membership_is_refused_without_early_lanes() {
    let source = "table members:\n  team: text <=20\n  principal: principal\n  opensAt: time ?\n  by byOpening: opensAt\n  unique team, principal\n  not before .opensAt\n  read <- .principal = viewer\n  insert <- allow\n  sync\ntable notes:\n  team: text <=20\n  owner: principal\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- allow\n  sync\n";
    let result = bound(source);
    assert!(
        result.diagnostics.iter().any(|d| d.code == "E_SYNC"
            && d.message
                .contains("union audiences cannot use a time audience")),
        "{:#?}",
        result.diagnostics
    );
}
