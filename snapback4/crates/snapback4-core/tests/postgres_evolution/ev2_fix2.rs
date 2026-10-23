//! Second-review counterexamples; SQLite remains the oracle.
use super::*;

fn large_dormant_lifecycle(bytes: usize) {
    let literal = "x".repeat(bytes);
    let wide = format!(
        "table notes:\n  n: int\n  payload: text <=4000000 default \"{literal}\"\n  public\n  online only\n"
    );
    let mut p = Pair::new(&wide);
    p.put("notes", object([("id", id("r")), ("n", Value::Int(99))]));
    let narrow = wide.replace("n: int", "n: int 0..10");
    p.transition(&narrow, false).unwrap();
    p.count("notes", 0);
    let dormant = p.sql("SELECT data FROM _dormant_narrow_rows");
    assert!(dormant[0][0].len() > bytes);
    let unrelated = "table unrelated:\n  public\n  online only\n";
    p.transition(&format!("{narrow}{unrelated}"), false)
        .unwrap();
    p.count("notes", 0);
    assert_eq!(dormant, p.sql("SELECT data FROM _dormant_narrow_rows"));
    if bytes == 3 * 1024 * 1024 {
        // Once compatible, both active-row walkers retain their existing
        // 16 MiB admission ceiling. Refusal must roll back restoration too.
        let error = p
            .transition(&format!("{wide}{unrelated}"), false)
            .unwrap_err();
        assert!(error.starts_with("E_BOUND"), "{error}");
        assert_eq!(dormant, p.sql("SELECT data FROM _dormant_narrow_rows"));
        // Widen with a partial row image; preserve the entire large cell.
        let partial = wide
            .lines()
            .filter(|line| !line.contains("payload:"))
            .collect::<Vec<_>>()
            .join("\n");
        p.transition(&format!("{partial}\n{unrelated}"), false)
            .unwrap();
        p.count("notes", 1);
        assert_eq!(
            p.sql("SELECT data FROM _dormant_values WHERE column_name='payload'")[0][0],
            canonical_json(&Value::String(literal))
        );
        return;
    }
    p.transition(&format!("{wide}{unrelated}"), false).unwrap();
    p.count("notes", 1);
    assert_eq!(dormant, p.sql("SELECT data FROM r WHERE t='notes'"));
    assert_eq!(
        p.sqlite.store().rows("notes").unwrap()[0]
            .field("payload")
            .unwrap(),
        &Value::String(literal)
    );
}
dual!(
    large_dormant_image_skips_bound_until_compatible,
    large_dormant_lifecycle(3 * 1024 * 1024)
);
dual!(
    compatible_dormant_image_restores_identical_bytes,
    large_dormant_lifecycle(1024 * 1024)
);

fn dev_pair(source: &str) -> (Engine, Engine) {
    let (schema, programs) = bound(source);
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let namespace = format!("sb4_ev2_fix2_{:x}", snapback4_core::ids::seed());
    (
        Engine::new_at(
            AnyStore::memory().unwrap(),
            schema.clone(),
            programs.clone(),
            1000,
        )
        .unwrap(),
        Engine::new_at(
            AnyStore::create_postgres(&url, &namespace).unwrap(),
            schema,
            programs,
            1000,
        )
        .unwrap(),
    )
}

dual!(dev_column_step_precedes_unrelated_unique_index, {
    let before = "table notes:\n  a: int\n  b: int 0..10\n  public\n  online only\n";
    let (mut sqlite, mut pg) = dev_pair(before);
    for e in [&mut sqlite, &mut pg] {
        let table = e.schema().tables["notes"].clone();
        let tx = e.store_mut().transaction().unwrap();
        for key in ["r1", "r2"] {
            tx.put(
                "notes",
                &table,
                &object([("id", id(key)), ("a", Value::Int(1)), ("b", Value::Int(1))]),
                None,
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let original = sqlite.store().rows("notes").unwrap();
    let (schema, programs) = bound(
        &before
            .replace("b: int 0..10", "b: int")
            .replace("  public", "  unique byA: a\n  unique byB: b\n  public"),
    );
    let a = sqlite
        .adopt_at(schema.clone(), programs.clone(), 1000)
        .unwrap_err();
    let b = pg.adopt_at(schema, programs, 1000).unwrap_err();
    println!("SQLite {a:?}; PG {b:?}");
    for e in [&sqlite, &pg] {
        assert_eq!(e.generation(), 1);
        assert_eq!(e.store().rows("notes").unwrap(), original);
    }
    assert_eq!(a.code(), "E_ADOPT");
    assert!(a.to_string().contains("notes.byB"));
    assert!(a.to_string().contains("keep b's previous type"));
    assert_eq!(a.to_string(), b.to_string());
});

fn null_cap_tightening(retained: bool) {
    let before = "table parents:\n  public\n  online only\ntable notes:\n  parent: parents ? on delete set null\n  cap 2 by parent\n  public\n  online only\n";
    let (mut sqlite, mut pg) = if retained {
        let p = Pair::new(before);
        (p.sqlite, p.pg)
    } else {
        dev_pair(before)
    };
    for e in [&mut sqlite, &mut pg] {
        let schema = e.schema().clone();
        let tx = e.store_mut().transaction().unwrap();
        tx.put(
            "parents",
            &schema.tables["parents"],
            &object([("id", id("p"))]),
            None,
        )
        .unwrap();
        for (key, parent) in [
            ("a", id("p")),
            ("b", id("p")),
            ("c", Value::Null),
            ("d", Value::Null),
        ] {
            tx.put(
                "notes",
                &schema.tables["notes"],
                &object([("id", id(key)), ("parent", parent)]),
                None,
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let original = sqlite.store().rows("notes").unwrap();
    let after = before.replace("cap 2", "cap 1");
    let (schema, programs) = bound(&after);
    let adopt = |e: &mut Engine| {
        if retained {
            e.adopt_release_at(
                schema.clone(),
                programs.clone(),
                &ReleaseActivation::new(2, Some(1)),
                false,
                1000,
            )
        } else {
            e.adopt_at(schema.clone(), programs.clone(), 1000)
        }
    };
    let a = adopt(&mut sqlite).unwrap_err();
    let b = adopt(&mut pg).unwrap_err();
    println!("retained={retained}: SQLite {a:?}; PG {b:?}");
    for e in [&sqlite, &pg] {
        assert_eq!(e.generation(), 1);
        assert_eq!(e.store().rows("notes").unwrap(), original);
    }
    assert_eq!(a.code(), "E_ADOPT");
    assert!(a.to_string().contains(if retained {
        "2 affected rows"
    } else {
        "4 affected rows"
    }));
    assert_eq!(a.to_string(), b.to_string());
}
dual!(
    dev_set_null_cap_tightening_matches_samples,
    null_cap_tightening(false)
);
dual!(
    release_set_null_cap_tightening_matches_samples,
    null_cap_tightening(true)
);
