//! Real wave-19 schemas, with deterministic synthetic rows; originals remain read-only.
// @ref LLP 3000.036#226-required-evidence — copied applications compare audiences and rollback retention.
use serde_json::{Value as Json, json};
use snapback4_core::engine::release::ReleaseActivation;
use snapback4_core::{Context, Engine, Value, schema::ColumnType as C};
use snapback4_lang::{Bound, compile};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

const NOW: i64 = 1_800_000_000_000;
fn bound(dir: &Path, table: &str) -> Bound {
    let mut files = std::fs::read_dir(dir)
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "q"))
        .collect::<Vec<_>>();
    files.sort();
    let mut sources = files
        .iter()
        .map(|p| {
            (
                p.file_name().unwrap().to_str().unwrap().to_owned(),
                std::fs::read_to_string(p).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    sources
        .iter_mut()
        .find(|(name, _)| name == "schema.q")
        .unwrap()
        .1
        .push_str(&format!(
            "\nquery colrProbe(id: {table}):\n  return {table}[id]\n"
        ));
    if dir.ends_with("original-v2") {
        let side = match table {
            "reports" => "parentReports",
            "pickups" => "pickupSizes",
            "jobs" => "jobReviews",
            "boxes" => "rentalArrangements",
            _ => "depositReviews",
        };
        sources
            .iter_mut()
            .find(|(name, _)| name == "schema.q")
            .unwrap()
            .1
            .push_str(&format!(
                "\nquery colrSide(id: {side}):\n  return {side}[id]\n"
            ));
    }
    let b = compile(&sources);
    assert!(
        b.diagnostics.is_empty(),
        "{}: {:?}",
        dir.display(),
        b.diagnostics
    );
    b
}
fn sample(kind: &C) -> Json {
    match kind {
        C::Id | C::Principal | C::Ref { .. } => json!("alice"),
        C::Text { max } => json!(
            "sample text"
                .chars()
                .take(*max as usize)
                .collect::<String>()
        ),
        C::Enum { variants } => json!(variants[0]),
        C::IntRange { min, max } => json!(100i64.clamp(*min, *max)),
        C::Time => json!(NOW),
        C::Int | C::Decimal { .. } | C::Money { .. } => json!(100),
        C::Bool => json!(false),
        C::Optional(_) => Json::Null,
        C::Image { .. } | C::Video { .. } | C::File { .. } => json!({"id":"fixture-asset"}),
        C::Bytes { .. } => json!("00"),
        C::Json { .. } => json!({}),
        C::List { .. } => json!([]),
        C::ListRange { of, min, .. } => Json::Array((0..*min).map(|_| sample(of)).collect()),
    }
}
fn row(b: &Bound, table: &str, id: &str, overrides: Json) -> Value {
    let t = &b.schema.tables[table];
    let mut fields = t
        .columns
        .iter()
        .map(|(n, k)| (n.clone(), sample(k)))
        .collect::<serde_json::Map<_, _>>();
    fields.insert("id".into(), json!(id));
    fields.extend(overrides.as_object().unwrap().clone());
    snapback4_core::wire::row_from_json(t, &Json::Object(fields)).unwrap()
}
fn fixtures(b: &Bound, lane: &str, main: &str, side: Option<&str>) -> Vec<(String, Value)> {
    let roles = if lane == "037" {
        "members"
    } else if lane == "049" {
        "people"
    } else {
        "roles"
    };
    let (allow, deny) = match lane {
        "006" => ("monitor", "parent"),
        "037" => ("farmer", "intake"),
        "039" => ("designer", "homeowner"),
        "043" => ("manager", "attendant"),
        _ => ("supervisor", "renter"),
    };
    let mut rows = vec![
        (
            roles.into(),
            row(
                b,
                roles,
                "role-a",
                json!({"principal":"alice","role":allow}),
            ),
        ),
        (
            roles.into(),
            row(b, roles, "role-b", json!({"principal":"bob","role":deny})),
        ),
    ];
    let overrides = match lane {
        "006" => {
            rows.push((
                "children".into(),
                row(b, "children", "child", json!({"parent":"bob"})),
            ));
            json!({"author":"alice","child":"child"})
        }
        "037" => json!({"farmer":"alice","hauler":"hauler","size":"atLeast1000"}),
        "039" => {
            json!({"designer":"alice","customer":"bob","templater":"templater","installer":"installer","summary":"approval outstanding"})
        }
        "043" => json!({"arrangement":"shared"}),
        _ => json!({"renter":"bob","attendant":"attendant","description":"damage needs review"}),
    };
    let mut overrides = overrides;
    overrides
        .as_object_mut()
        .unwrap()
        .retain(|n, _| b.schema.tables[main].columns.contains_key(n));
    rows.push((main.into(), row(b, main, "record", overrides)));
    if let Some(side) = side {
        let extra = match lane {
            "006" => json!({"report":"record","child":"child","parent":"bob","author":"alice"}),
            "037" => {
                json!({"pickup":"record","farmer":"alice","hauler":"hauler","size":"atLeast1000"})
            }
            "039" => json!({"job":"record","designer":"alice","summary":"approval outstanding"}),
            "043" => json!({"box":"record","arrangement":"shared"}),
            _ => json!({"booking":"record","description":"damage needs review"}),
        };
        let extra = Json::Object(
            extra
                .as_object()
                .unwrap()
                .iter()
                .filter(|(n, _)| b.schema.tables[side].columns.contains_key(*n))
                .map(|(n, v)| (n.clone(), v.clone()))
                .collect(),
        );
        rows.push((side.into(), row(b, side, "separate", extra)));
    }
    rows
}
fn install(b: Bound) -> Engine {
    let mut e = Engine::memory(
        b.schema.clone(),
        b.programs.iter().map(|p| p.program.clone()),
    )
    .unwrap();
    e.adopt_release_at(
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        &ReleaseActivation::new(1, None),
        true,
        NOW,
    )
    .unwrap();
    e
}
fn read(e: &mut Engine, who: &str) -> Value {
    e.query(
        "colrProbe",
        Context::new(
            who,
            BTreeMap::from([("id".into(), Value::Id("record".into()))]),
        )
        .at(NOW),
    )
    .unwrap()
    .data
}
#[test]
fn five_copied_lanes_preserve_primary_rows_and_narrow_the_new_cells() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../reports/colr/lane-copies");
    let mut evidence = Vec::new();
    for (lane, main, field, side) in [
        ("006", "reports", "photo", "parentReports"),
        ("037", "pickups", "size", "pickupSizes"),
        ("039", "jobs", "summary", "jobReviews"),
        ("043", "boxes", "arrangement", "rentalArrangements"),
        ("049", "bookings", "description", "depositReviews"),
    ] {
        let dir = root.join(lane);
        let new = bound(&dir.join("snapback"), main);
        let rows = fixtures(&new, lane, main, None);
        let mut e = install(new);
        e.seed_at(rows, NOW).unwrap();
        let allowed = read(&mut e, "alice");
        assert!(allowed.field(field).is_ok(), "{lane}: {allowed:?}");
        let denied = read(&mut e, "bob");
        assert!(denied.field("id").is_ok(), "{lane}: {denied:?}");
        assert!(denied.field(field).is_err(), "{lane}: {denied:?}");
        let original = bound(&dir.join("original-v2"), main);
        let rows = fixtures(&original, lane, main, Some(side));
        let mut old = install(original);
        old.seed_at(rows, NOW).unwrap();
        let side_read = |engine: &mut Engine, viewer: &str| {
            engine
                .query(
                    "colrSide",
                    Context::new(
                        viewer,
                        BTreeMap::from([("id".into(), Value::Id("separate".into()))]),
                    )
                    .at(NOW),
                )
                .unwrap()
                .data
        };
        assert!(
            side_read(&mut old, if lane == "006" { "bob" } else { "alice" })
                .field("id")
                .is_ok(),
            "{lane}: original allowed probe"
        );
        if lane != "006" {
            assert_eq!(
                side_read(&mut old, "bob"),
                Value::Null,
                "{lane}: original denied probe"
            );
        }

        let v1 = bound(&dir.join("v1"), main);
        for engine in [&mut e, &mut old] {
            engine
                .adopt_release_at(
                    v1.schema.clone(),
                    v1.programs.iter().map(|p| p.program.clone()),
                    &ReleaseActivation::new(2, Some(1)),
                    true,
                    NOW,
                )
                .unwrap();
            assert!(
                read(engine, snapback4_core::SYSTEM_PRINCIPAL)
                    .field("id")
                    .is_ok(),
                "{lane}: primary disappeared"
            );
        }
        let new_dormant = e.store_mut().dormant_inventory(None, 128).unwrap();
        let old_dormant = old.store_mut().dormant_inventory(None, 128).unwrap();
        let old_json = serde_json::to_value(&old_dormant).unwrap();
        assert!(old_json.to_string().contains(side), "{lane}: {old_json}");
        assert!(
            !serde_json::to_value(&new_dormant)
                .unwrap()
                .to_string()
                .contains(side)
        );
        let forward = bound(&dir.join("snapback"), main);
        let mut opts = ReleaseActivation::new(3, Some(2));
        opts.restore_dormant = true;
        e.adopt_release_at(
            forward.schema,
            forward.programs.into_iter().map(|p| p.program),
            &opts,
            true,
            NOW,
        )
        .unwrap();
        assert_eq!(
            read(&mut e, "alice").field(field).unwrap(),
            allowed.field(field).unwrap(),
            "{lane}: restored cell"
        );
        assert!(read(&mut e, "bob").field(field).is_err());
        evidence.push(json!({"lane":lane,"primary":main,"field":field,"removedSideTable":side,"allowedProbe":"pass","deniedProbe":"pass","rollbackPrimary":"visible in v1 shape","originalDormant":old_json,"columnDormant":new_dormant,"forwardRestore":"pass"}));
    }
    if let Some(path) = std::env::var_os("COLR_LANE_REPORT") {
        std::fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    }
}
